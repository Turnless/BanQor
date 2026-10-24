import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  http,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { banqorVaultAbi } from "./abi.js";
import { chainFromRpc } from "./config.js";
import { BanQorError, toBanQorError } from "./errors.js";

export interface LineStatus {
  lineOpen: boolean;
  troveStatus: number;
  coll: bigint;
  debt: bigint;
  /** ICR in basis points; maxUint256 when there is no debt */
  icrBps: bigint;
  price: bigint;
  vaultFloat: bigint;
  paused: boolean;
  icrFloorBps: number;
}

export interface Policy {
  dailyCap: bigint;
  maxFloat: bigint;
  maxDrawPerTx: bigint;
  expiry: bigint;
  active: boolean;
}

export interface AgentStatus {
  policy: Policy;
  spentInWindow: bigint;
  windowResetsAt: bigint;
  agentBalance: bigint;
  drawableNow: bigint;
}

export interface VaultClientOptions {
  vault: Address;
  /** CAIP-2 network id, e.g. "eip155:31611" */
  network: string;
  rpcUrl: string;
  /** Required for draw() */
  account?: Account;
  chain?: Chain;
  publicClient?: PublicClient;
  /** HTTP timeout for RPC calls in ms (viem default 10s). Raise it for slow RPCs. */
  rpcTimeoutMs?: number;
  /** Gas limit for draw() as a multiple of the estimate, in bps. Default 15000 (1.5x). */
  drawGasBufferBps?: number;
  /** Simulate+estimate attempts before giving up on a flaky RPC. Default 3. */
  estimateAttempts?: number;
}

/** EIP-2028 intrinsic gas of a call transaction: 21000 + 16 per non-zero and 4 per zero calldata byte. */
export function intrinsicGas(data: Hex): bigint {
  let gas = 21_000n;
  for (let i = 2; i < data.length; i += 2) gas += data.slice(i, i + 2) === "00" ? 4n : 16n;
  return gas;
}

export interface DrawResult {
  hash: Hash;
  amount: bigint;
  /** MUSD the vault borrowed from its trove to serve this draw (0 if served from vault float) */
  borrowed: bigint;
}

export interface VaultClient {
  vault: Address;
  chain: Chain;
  publicClient: PublicClient;
  /** MUSD token address and decimals, read from the vault once */
  musd(): Promise<{ address: Address; decimals: number }>;
  getLineStatus(): Promise<LineStatus>;
  getAgentStatus(agent: Address): Promise<AgentStatus>;
  maxDrawable(agent: Address): Promise<bigint>;
  musdBalance(holder: Address): Promise<bigint>;
  draw(amount: bigint): Promise<DrawResult>;
}

export function createVaultClient(opts: VaultClientOptions): VaultClient {
  const chain = opts.chain ?? chainFromRpc(opts.rpcUrl, opts.network);
  const publicClient: PublicClient =
    opts.publicClient ??
    (createPublicClient({ chain, transport: http(opts.rpcUrl, { timeout: opts.rpcTimeoutMs }) }) as PublicClient);
  const walletClient: WalletClient | undefined = opts.account
    ? createWalletClient({ account: opts.account, chain, transport: http(opts.rpcUrl, { timeout: opts.rpcTimeoutMs }) })
    : undefined;
  const vault = opts.vault;
  const gasBufferBps = opts.drawGasBufferBps ?? 15_000;
  const estimateAttempts = opts.estimateAttempts ?? 3;

  let musdCache: { address: Address; decimals: number } | undefined;

  async function musd() {
    if (!musdCache) {
      const address = await publicClient.readContract({ address: vault, abi: banqorVaultAbi, functionName: "musd" });
      const decimals = await publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" });
      musdCache = { address, decimals };
    }
    return musdCache;
  }

  async function getLineStatus(): Promise<LineStatus> {
    const s = await publicClient.readContract({ address: vault, abi: banqorVaultAbi, functionName: "lineStatus" });
    return { ...s, icrFloorBps: Number(s.icrFloorBps), troveStatus: Number(s.troveStatus) };
  }

  async function getAgentStatus(agent: Address): Promise<AgentStatus> {
    return publicClient.readContract({
      address: vault,
      abi: banqorVaultAbi,
      functionName: "agentStatus",
      args: [agent],
    });
  }

  async function maxDrawable(agent: Address): Promise<bigint> {
    return publicClient.readContract({ address: vault, abi: banqorVaultAbi, functionName: "maxDrawable", args: [agent] });
  }

  async function musdBalance(holder: Address): Promise<bigint> {
    const { address } = await musd();
    return publicClient.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [holder] });
  }

  /**
   * Simulates and estimates against the same block. Public RPCs load-balance across nodes; a node that is
   * behind can estimate against state where the vault has no code and return only the intrinsic gas, which
   * then runs out of gas on-chain. Pinning the block makes such a node error instead (and we retry), and an
   * estimate that covers no execution at all is rejected.
   */
  async function simulateAndEstimate(call: {
    account: Account;
    address: Address;
    abi: typeof banqorVaultAbi;
    functionName: "draw";
    args: readonly [bigint];
  }) {
    const intrinsic = intrinsicGas(encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }));
    let lastError: unknown;
    for (let attempt = 0; attempt < estimateAttempts; attempt++) {
      try {
        const blockNumber = await publicClient.getBlockNumber({ cacheTime: 0 });
        const { request } = await publicClient.simulateContract({ ...call, blockNumber });
        const gas = await publicClient.estimateContractGas({ ...call, blockNumber });
        if (gas > intrinsic) return { request, gas };
        lastError = new BanQorError("Unknown", `RPC returned a gas estimate (${gas}) that executes no code; retrying`);
      } catch (err) {
        // a contract refusal is final; RPC/node errors are retried
        const e = toBanQorError(err);
        if (e.code !== "Unknown") throw e;
        lastError = err;
      }
    }
    throw lastError;
  }

  /** Calls vault.draw(amount) as the agent and waits for confirmation. Throws BanQorError on refusal. */
  async function draw(amount: bigint): Promise<DrawResult> {
    if (!walletClient || !opts.account) throw new BanQorError("Unknown", "draw() needs an account");
    let hash: Hash;
    try {
      const call = { account: opts.account, address: vault, abi: banqorVaultAbi, functionName: "draw", args: [amount] } as const;
      const { request, gas } = await simulateAndEstimate(call);
      // Gas use of a borrowing draw can still shift slightly by the mined block, so send with headroom.
      hash = await walletClient.writeContract({ ...request, gas: (gas * BigInt(gasBufferBps)) / 10_000n });
    } catch (err) {
      throw toBanQorError(err);
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      // State changed between simulation and mining (price move, cap used, pause). Replay at the mined block
      // to recover the vault's reason so callers still get a typed refusal.
      const reason = await publicClient
        .simulateContract({ account: opts.account, address: vault, abi: banqorVaultAbi, functionName: "draw", args: [amount], blockNumber: receipt.blockNumber })
        .then(
          () => undefined,
          (e: unknown) => toBanQorError(e),
        );
      if (reason && reason.code !== "Unknown") throw new BanQorError(reason.code, `draw ${hash} reverted: ${reason.message}`, reason.cause);
      throw new BanQorError("Unknown", `draw transaction ${hash} reverted`);
    }

    let borrowed = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: banqorVaultAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Drawn") borrowed = ev.args.borrowed;
      } catch {
        // not a vault event we know
      }
    }
    return { hash, amount, borrowed };
  }

  return { vault, chain, publicClient, musd, getLineStatus, getAgentStatus, maxDrawable, musdBalance, draw };
}

/** Read-only helper shared by agent scripts and the dashboard (FR-S6). */
export async function getLineStatus(opts: Omit<VaultClientOptions, "account">): Promise<LineStatus> {
  return createVaultClient(opts).getLineStatus();
}
