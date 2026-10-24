// End-to-end on a local fork of Mezo testnet:
// real BanQor contracts + real Mezo trove + real demo API (official x402 middleware) + SDK x402 signing.
// The facilitator is a stub that settles by moving MUSD on the fork, so the agent's float really drains.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createTestClient, createWalletClient, erc20Abi, http, maxUint256, parseUnits, type Address } from "viem";
import { createBanQorFetch, createVaultClient, type BanQorEvent } from "@banqor/sdk";
import { RPC_TIMEOUT, devAccount, startLocalMezo, type LocalMezo } from "../../../packages/sdk/test/anvil.js";
import { createApp } from "../../api/src/app.js";
import { createDataSources } from "../../api/src/data.js";
import { stubFacilitator, type StubFacilitator } from "../../api/test/stub-facilitator.js";

let env: LocalMezo;
let server: Server;
let base: string;
let facilitator: StubFacilitator;

const offline = (async () => {
  throw new Error("offline");
}) as typeof fetch;

beforeAll(async () => {
  env = await startLocalMezo(18546);
  await env.ownerWrite("setAgent", [
    env.agent.address,
    { dailyCap: parseUnits("20", 18), maxFloat: parseUnits("2", 18), maxDrawPerTx: parseUnits("1", 18), expiry: 0n, active: true },
  ]);

  const chain = env.publicClient.chain!;
  const musd = env.deployment.mezo.musd;
  // Stand-in for the facilitator's Permit2 settlement: a separate settler account pulls the MUSD with an
  // allowance, like the real facilitator does with the agent's signature, so it never uses the agent's
  // nonce (the agent is sending its own draw txs concurrently). Settlements run one at a time.
  const settler = devAccount(3);
  const settlerWallet = createWalletClient({ account: settler, chain, transport: http(env.rpcUrl, { timeout: RPC_TIMEOUT }) });
  const agentWallet = createWalletClient({ account: env.agent, chain, transport: http(env.rpcUrl, { timeout: RPC_TIMEOUT }) });
  await env.publicClient.waitForTransactionReceipt({
    hash: await agentWallet.writeContract({ address: musd, abi: erc20Abi, functionName: "approve", args: [settler.address, maxUint256], chain }),
  });
  let settling: Promise<unknown> = Promise.resolve();
  facilitator = stubFacilitator({
    network: env.network,
    musd,
    onSettle: (payer, payTo, amount) => {
      const run = settling.then(async () => {
        const hash = await settlerWallet.writeContract({
          address: musd,
          abi: erc20Abi,
          functionName: "transferFrom",
          args: [payer as Address, payTo as Address, amount],
          chain,
        });
        const r = await env.publicClient.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error("settlement transfer failed");
        return hash;
      });
      settling = run.catch(() => undefined);
      return run;
    },
  });

  const app = createApp({
    network: env.network,
    payTo: env.payee.address,
    prices: { price: "$0.01", funding: "$0.02", sentiment: "$0.05" },
    facilitator,
    data: createDataSources({ price: "http://x", funding: "http://x", sentiment: "http://x" }, 60, 300, offline),
  });
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 300_000);

afterAll(() => {
  server?.close();
  env?.stop();
});

const agentFetch = (o: { maxPricePerCall?: string; allowedPayees?: Address[]; events: BanQorEvent[] }) =>
  createBanQorFetch({
    account: env.agent,
    vault: env.vault,
    network: env.network,
    rpcUrl: env.rpcUrl,
    rpcTimeoutMs: RPC_TIMEOUT,
    minFloat: "0.20",
    topUp: "1.00",
    maxPricePerCall: o.maxPricePerCall ?? "0.10",
    allowedPayees: o.allowedPayees ?? [env.payee.address],
    onEvent: (e) => o.events.push(e),
  });

describe("agent pays x402 APIs from the trove-backed credit line", () => {
  it("makes paid calls with automatic draws and no manual top-up", async () => {
    const events: BanQorEvent[] = [];
    const f = agentFetch({ events });
    const vault = createVaultClient({ vault: env.vault, network: env.network, rpcUrl: env.rpcUrl, rpcTimeoutMs: RPC_TIMEOUT });
    // empty the vault so draws must borrow against the BTC collateral
    const line0 = await vault.getLineStatus();
    await env.ownerWrite("sweep", [env.owner.address, line0.vaultFloat]);

    // the payee is a well-known dev address that may already hold MUSD on public testnet: measure the change
    const payeeBefore = await env.publicClient.readContract({ address: env.deployment.mezo.musd, abi: erc20Abi, functionName: "balanceOf", args: [env.payee.address] });
    const paths = ["/price", "/funding", "/sentiment"];
    const N = 45;
    for (let i = 0; i < N; i++) {
      const res = await f(`${base}${paths[i % 3]}`);
      expect(res.status).toBe(200);
      expect((await res.json()).source).toBe("fallback");
    }

    const draws = events.filter((e) => e.type === "draw");
    const payments = events.filter((e) => e.type === "payment");
    expect(payments).toHaveLength(N);
    expect(facilitator.settled).toBe(N);
    expect(draws.length).toBeGreaterThanOrEqual(2);
    expect(draws.some((d) => d.type === "draw" && d.borrowed > 0n)).toBe(true);

    const paid = payments.reduce((s, p) => s + (p.type === "payment" ? p.amount : 0n), 0n);
    expect(paid).toBe(parseUnits("0.40", 18) * 3n); // 15 x (0.01 + 0.02 + 0.05)
    const payeeBal = await env.publicClient.readContract({ address: env.deployment.mezo.musd, abi: erc20Abi, functionName: "balanceOf", args: [env.payee.address] });
    expect(payeeBal - payeeBefore).toBe(paid);

    const line1 = await vault.getLineStatus();
    expect(line1.debt).toBeGreaterThan(line0.debt); // the agent's spending was borrowed from the trove
    expect(line1.icrBps).toBeGreaterThanOrEqual(BigInt(line1.icrFloorBps));
    const a = await vault.getAgentStatus(env.agent.address);
    expect(a.agentBalance).toBeLessThanOrEqual(a.policy.maxFloat);
  });

  it("refuses a price above maxPricePerCall before signing", async () => {
    const events: BanQorEvent[] = [];
    const before = facilitator.verified;
    await expect(agentFetch({ maxPricePerCall: "0.03", events })(`${base}/sentiment`)).rejects.toMatchObject({ code: "PriceTooHigh" });
    expect(facilitator.verified).toBe(before); // nothing was signed or sent
    expect(events.at(-1)).toMatchObject({ type: "refused", code: "PriceTooHigh" });
  });

  it("refuses a payee that is not on the allowlist", async () => {
    const events: BanQorEvent[] = [];
    const f = agentFetch({ allowedPayees: [env.owner.address], events });
    await expect(f(`${base}/price`)).rejects.toMatchObject({ code: "PayeeNotAllowed" });
  });

  it("surfaces vault refusals (pause) as typed errors", async () => {
    const events: BanQorEvent[] = [];
    const f = agentFetch({ events });
    // spend the float down below minFloat so the next call must draw
    const bal = await env.publicClient.readContract({ address: env.deployment.mezo.musd, abi: erc20Abi, functionName: "balanceOf", args: [env.agent.address] });
    const test = createTestClient({ chain: env.publicClient.chain!, mode: "anvil", transport: http(env.rpcUrl, { timeout: RPC_TIMEOUT }) });
    await test.impersonateAccount({ address: env.agent.address });
    const w = createWalletClient({ account: env.agent.address, chain: env.publicClient.chain!, transport: http(env.rpcUrl, { timeout: RPC_TIMEOUT }) });
    await env.publicClient.waitForTransactionReceipt({
      hash: await w.writeContract({ address: env.deployment.mezo.musd, abi: erc20Abi, functionName: "transfer", args: [env.payee.address, bal], chain: env.publicClient.chain! }),
    });
    await test.stopImpersonatingAccount({ address: env.agent.address });

    await env.ownerWrite("pause");
    await expect(f(`${base}/price`)).rejects.toMatchObject({ code: "Paused" });
    await env.ownerWrite("unpause");
    const res = await f(`${base}/price`);
    expect(res.status).toBe(200);
  });

  it("concurrent calls never sign more than the float holds", async () => {
    const events: BanQorEvent[] = [];
    const f = agentFetch({ events });
    // leave the agent 0.25 MUSD: enough for minFloat, not for six $0.05 calls at once
    const musd = env.deployment.mezo.musd;
    const chain = env.publicClient.chain!;
    const bal = await env.publicClient.readContract({ address: musd, abi: erc20Abi, functionName: "balanceOf", args: [env.agent.address] });
    const keep = parseUnits("0.25", 18);
    if (bal > keep) {
      const w = createWalletClient({ account: env.agent, chain, transport: http(env.rpcUrl, { timeout: RPC_TIMEOUT }) });
      await env.publicClient.waitForTransactionReceipt({
        hash: await w.writeContract({ address: musd, abi: erc20Abi, functionName: "transfer", args: [env.owner.address, bal - keep], chain }),
      });
    }
    const results = await Promise.all(Array.from({ length: 6 }, () => f(`${base}/sentiment`)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(events.some((e) => e.type === "draw")).toBe(true); // the reservation forced a top-up
  });

  it("free endpoint needs no payment", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });
});
