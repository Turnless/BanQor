import { createPublicClient, http, parseUnits, type Account, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment, type PaymentRequirements } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { chainFromRpc, chainIdFromNetwork } from "./config.js";
import { BanQorError, toBanQorError, type BanQorErrorCode } from "./errors.js";
import { createVaultClient } from "./vault.js";

export type BanQorEvent =
  | { type: "draw"; amount: bigint; borrowed: bigint; hash: Hex; balanceAfter: bigint }
  | { type: "payment"; url: string; amount: bigint; payTo: string; asset: string; status: number }
  | { type: "refused"; url: string; code: BanQorErrorCode; message: string };

export interface BanQorFetchOptions {
  /** Agent private key. Either this or `account`. */
  agentKey?: Hex;
  account?: Account;
  vault: Address;
  /** CAIP-2 network id of the x402 payments, e.g. "eip155:31611" */
  network: `eip155:${number}`;
  rpcUrl: string;
  /** Draw more MUSD when the agent's balance falls below this (decimal MUSD string, e.g. "0.20") */
  minFloat: string;
  /** MUSD per draw (must fit the agent's policy maxDrawPerTx) */
  topUp: string;
  /** Refuse any single payment above this (decimal MUSD string) */
  maxPricePerCall: string;
  /** If set, refuse payments to any other address */
  allowedPayees?: Address[];
  /** How long a balance read is reused, in ms. Default 3000. */
  balanceCacheMs?: number;
  onEvent?: (e: BanQorEvent) => void;
  /** Underlying fetch. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  publicClient?: PublicClient;
  /** HTTP timeout for RPC calls in ms (viem default 10s). */
  rpcTimeoutMs?: number;
  /** Gas limit for draw() as a multiple of the estimate, in bps. Default 15000 (1.5x). */
  drawGasBufferBps?: number;
}

export interface BanQorFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Tops the agent up to at least `minFloat` (or `need`, in MUSD wei) now. */
  ensureFloat(need?: bigint): Promise<bigint>;
  readonly agent: Address;
}

/**
 * Returns a fetch-compatible function that pays x402 requirements from the agent's MUSD float,
 * drawing more from the BanQor vault (and so from the owner's Mezo trove) when the float runs low.
 */
export function createBanQorFetch(opts: BanQorFetchOptions): BanQorFetch {
  const account = opts.account ?? (opts.agentKey ? privateKeyToAccount(opts.agentKey) : undefined);
  if (!account) throw new BanQorError("Unknown", "createBanQorFetch needs agentKey or account");
  const chain = chainFromRpc(opts.rpcUrl, opts.network);
  if (chainIdFromNetwork(opts.network) !== chain.id) throw new BanQorError("Unknown", "network/chain mismatch");
  const publicClient: PublicClient =
    opts.publicClient ??
    (createPublicClient({ chain, transport: http(opts.rpcUrl, { timeout: opts.rpcTimeoutMs }) }) as PublicClient);
  const vault = createVaultClient({
    vault: opts.vault,
    network: opts.network,
    rpcUrl: opts.rpcUrl,
    account,
    chain,
    publicClient,
    rpcTimeoutMs: opts.rpcTimeoutMs,
    drawGasBufferBps: opts.drawGasBufferBps,
  });
  const baseFetch = opts.fetch ?? globalThis.fetch;
  const cacheMs = opts.balanceCacheMs ?? 3000;
  const allowed = opts.allowedPayees?.map((a) => a.toLowerCase());
  const emit = (e: BanQorEvent) => opts.onEvent?.(e);
  const signer = toClientEvmSigner(account as Parameters<typeof toClientEvmSigner>[0], publicClient);

  let units: { minFloat: bigint; topUp: bigint; maxPrice: bigint; musd: Address } | undefined;
  async function amounts() {
    if (!units) {
      const { address, decimals } = await vault.musd();
      units = {
        minFloat: parseUnits(opts.minFloat, decimals),
        topUp: parseUnits(opts.topUp, decimals),
        maxPrice: parseUnits(opts.maxPricePerCall, decimals),
        musd: address,
      };
    }
    return units;
  }

  // ---- balance cache + serialized top-ups ----
  let cached: { value: bigint; at: number } | undefined;
  /** MUSD promised to payments that are signed but not yet settled, so concurrent calls can't spend it twice. */
  let inFlight = 0n;
  async function balance(): Promise<bigint> {
    if (cached && Date.now() - cached.at < cacheMs) return cached.value - inFlight;
    const value = await vault.musdBalance(account!.address);
    cached = { value, at: Date.now() };
    return value - inFlight;
  }

  async function topUpTo(threshold: bigint): Promise<bigint> {
    const u = await amounts();
    const bal = await balance();
    if (bal >= threshold) return bal;
    const wanted = u.topUp > threshold - bal ? u.topUp : threshold - bal;
    const cap = await vault.maxDrawable(account!.address);
    // If the policy/ICR room can't cover the need, call draw(wanted) anyway so the vault reports the exact reason.
    const amount = cap >= wanted ? wanted : bal + cap >= threshold ? cap : wanted;
    const res = await vault.draw(amount);
    const after = bal + amount;
    cached = { value: after + inFlight, at: Date.now() };
    emit({ type: "draw", amount, borrowed: res.borrowed, hash: res.hash, balanceAfter: after });
    return after;
  }

  let lock: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = lock.then(fn);
    lock = run.catch(() => undefined);
    return run;
  }

  function ensureFloat(need?: bigint): Promise<bigint> {
    return serialized(async () => {
      const u = await amounts();
      return topUpTo(need !== undefined && need > u.minFloat ? need : u.minFloat);
    });
  }

  /** Tops up so `amount` is covered, then holds it for this payment until it settles. */
  function reserve(amount: bigint): Promise<void> {
    return serialized(async () => {
      const u = await amounts();
      await topUpTo(amount > u.minFloat ? amount : u.minFloat);
      inFlight += amount;
    });
  }

  // ---- payment guard (runs before anything is signed) ----
  function refusal(r: PaymentRequirements, u: { maxPrice: bigint; musd: Address }): BanQorError | undefined {
    if (r.network !== opts.network) return new BanQorError("AssetNotAllowed", `network ${r.network} not allowed`);
    if (r.asset.toLowerCase() !== u.musd.toLowerCase())
      return new BanQorError("AssetNotAllowed", `asset ${r.asset} is not the vault's MUSD`);
    if (BigInt(r.amount) > u.maxPrice)
      return new BanQorError("PriceTooHigh", `price ${r.amount} > maxPricePerCall ${u.maxPrice}`);
    if (allowed && !allowed.includes(r.payTo.toLowerCase()))
      return new BanQorError("PayeeNotAllowed", `payee ${r.payTo} not in allowedPayees`);
    return undefined;
  }

  const paidFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const u = await amounts();
    try {
      await ensureFloat();
    } catch (err) {
      const e = toBanQorError(err);
      emit({ type: "refused", url, code: e.code, message: e.message });
      throw e;
    }

    // Per-call client so a refusal can be attributed to this request even when calls run concurrently.
    const state: { refused?: BanQorError; paid?: PaymentRequirements; reserved: bigint } = { reserved: 0n };
    const client = new x402Client()
      .register(opts.network, new ExactEvmScheme(signer, { rpcUrl: opts.rpcUrl }))
      .registerPolicy((_version, reqs) => {
        const ok = reqs.filter((r) => !refusal(r, u));
        if (ok.length === 0 && reqs[0]) state.refused = refusal(reqs[0], u);
        return ok;
      })
      .onBeforePaymentCreation(async ({ selectedRequirements }) => {
        try {
          const amount = BigInt(selectedRequirements.amount);
          await reserve(amount);
          state.reserved = amount;
        } catch (err) {
          state.refused = toBanQorError(err);
          return { abort: true, reason: state.refused.code };
        }
      })
      .onAfterPaymentCreation(async ({ selectedRequirements }) => {
        state.paid = selectedRequirements;
      });

    let res: Response;
    try {
      res = await wrapFetchWithPayment(baseFetch, client)(input, init);
    } catch (err) {
      release(false);
      if (state.refused) {
        emit({ type: "refused", url, code: state.refused.code, message: state.refused.message });
        throw state.refused;
      }
      throw err;
    }

    // The facilitator settles before the paid response returns: on success the MUSD has left the agent.
    release(res.ok && !!state.paid);
    if (state.paid) {
      emit({ type: "payment", url, amount: BigInt(state.paid.amount), payTo: state.paid.payTo, asset: state.paid.asset, status: res.status });
    }
    return res;

    function release(settled: boolean) {
      if (state.reserved === 0n) return;
      inFlight -= state.reserved;
      if (settled && cached) cached = { value: cached.value - state.reserved, at: cached.at };
      else cached = undefined; // outcome unknown: re-read next time
      state.reserved = 0n;
    }
  };

  return Object.assign(paidFetch, { ensureFloat, agent: account.address });
}
