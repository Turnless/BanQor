// Integration: SDK vault client against real Mezo contracts on a local anvil fork.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, erc20Abi, http, parseUnits } from "viem";
import { createVaultClient, type VaultClient } from "../src/vault.js";
import { createBanQorFetch } from "../src/fetch.js";
import { BanQorError } from "../src/errors.js";
import { RPC_TIMEOUT, startLocalMezo, type LocalMezo } from "./anvil.js";

let env: LocalMezo;
let agentVault: VaultClient;
const policy = (o: Partial<{ dailyCap: bigint; maxFloat: bigint; maxDrawPerTx: bigint }> = {}) => ({
  dailyCap: o.dailyCap ?? parseUnits("20", 18),
  maxFloat: o.maxFloat ?? parseUnits("2", 18),
  maxDrawPerTx: o.maxDrawPerTx ?? parseUnits("1", 18),
  expiry: 0n,
  active: true,
});

beforeAll(async () => {
  env = await startLocalMezo(18545);
  await env.ownerWrite("setAgent", [env.agent.address, policy()]);
  agentVault = createVaultClient({ vault: env.vault, network: env.network, rpcUrl: env.rpcUrl, rpcTimeoutMs: RPC_TIMEOUT, account: env.agent });
}, 300_000);

afterAll(() => env?.stop());

describe("vault client (anvil fork of Mezo testnet)", () => {
  it("reads line and agent status", async () => {
    const line = await agentVault.getLineStatus();
    expect(line.lineOpen).toBe(true);
    expect(line.troveStatus).toBe(1);
    expect(line.price).toBe(env.price);
    expect(line.icrBps).toBeGreaterThanOrEqual(29_000n);
    const a = await agentVault.getAgentStatus(env.agent.address);
    expect(a.policy.active).toBe(true);
    expect(a.drawableNow).toBe(parseUnits("1", 18));
  });

  it("draws and decodes the Drawn event", async () => {
    const r = await agentVault.draw(parseUnits("0.5", 18));
    expect(r.borrowed).toBe(0n); // vault still holds the initial MUSD
    expect(await agentVault.musdBalance(env.agent.address)).toBe(parseUnits("0.5", 18));
  });

  it("borrows from the trove when the vault is empty", async () => {
    const line = await agentVault.getLineStatus();
    await env.ownerWrite("sweep", [env.owner.address, line.vaultFloat]);
    const r = await agentVault.draw(parseUnits("0.5", 18));
    expect(r.borrowed).toBeGreaterThan(parseUnits("0.5", 18) - 1n);
    const after = await agentVault.getLineStatus();
    expect(after.debt).toBeGreaterThan(line.debt);
  });

  it("turns vault refusals into typed errors", async () => {
    await expect(agentVault.draw(parseUnits("1.5", 18))).rejects.toMatchObject({ code: "DrawTooLarge" });
    await env.ownerWrite("pause");
    await expect(agentVault.draw(parseUnits("0.1", 18))).rejects.toMatchObject({ code: "Paused" });
    await env.ownerWrite("unpause");
    const stranger = createVaultClient({ vault: env.vault, network: env.network, rpcUrl: env.rpcUrl, rpcTimeoutMs: RPC_TIMEOUT, account: env.payee });
    await expect(stranger.draw(1n)).rejects.toBeInstanceOf(BanQorError);
    await expect(stranger.draw(1n)).rejects.toMatchObject({ code: "NotAgent" });
  });

  it("ensureFloat tops up below minFloat, respects maxFloat, and is serialized", async () => {
    const f = createBanQorFetch({
      account: env.agent,
      vault: env.vault,
      network: env.network,
      rpcUrl: env.rpcUrl,
      rpcTimeoutMs: RPC_TIMEOUT,
      minFloat: "1.5",
      topUp: "1",
      maxPricePerCall: "0.1",
      balanceCacheMs: 0,
    });
    const before = await agentVault.musdBalance(env.agent.address); // 1.0 from earlier draws
    // two concurrent calls must not both draw
    const [a, b] = await Promise.all([f.ensureFloat(), f.ensureFloat()]);
    const after = await agentVault.musdBalance(env.agent.address);
    expect(after).toBeLessThanOrEqual(parseUnits("2", 18)); // never above maxFloat
    expect(after).toBeGreaterThanOrEqual(parseUnits("1.5", 18));
    expect(after - before).toBeLessThanOrEqual(parseUnits("1", 18));
    expect(a).toBe(b);
  });

  it("refuses with IcrTooLow when the price drops under the floor", async () => {
    // the agent is at its max float; spend it so the float check (which runs first) passes
    const w = createWalletClient({ account: env.agent, chain: env.publicClient.chain!, transport: http(env.rpcUrl, { timeout: RPC_TIMEOUT }) });
    const { address: musd } = await agentVault.musd();
    const bal = await agentVault.musdBalance(env.agent.address);
    await env.publicClient.waitForTransactionReceipt({
      hash: await w.writeContract({ address: musd, abi: erc20Abi, functionName: "transfer", args: [env.payee.address, bal], chain: env.publicClient.chain! }),
    });
    await env.setPrice((env.price * 19n) / 30n); // ~190%
    await expect(agentVault.draw(parseUnits("0.1", 18))).rejects.toMatchObject({ code: "IcrTooLow" });
    await env.setPrice(env.price);
  });
});
