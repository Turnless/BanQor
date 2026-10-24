// Owner setup (FR-A1): create a vault, open a line on Mezo, register the agent, fund agent gas.
import { createWalletClient, formatEther, formatUnits, http, parseEther, parseUnits, zeroAddress } from "viem";
import { banqorFactoryAbi, banqorVaultAbi, computeHints, previewOpenLine } from "@banqor/sdk";
import { agentAccount, context, explorerTx, need, ownerAccount, saveBanqor } from "./env.js";

const { deployment: d, chain, publicClient } = context();
const owner = ownerAccount();
const agent = agentAccount();
const wallet = createWalletClient({ account: owner, chain, transport: http(context().rpcUrl) });

async function send(label: string, p: Promise<`0x${string}`>) {
  const hash = await p;
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${explorerTx(d, hash)}`);
  console.log(`  ✓ ${label}  ${explorerTx(d, hash)}`);
  return r;
}

async function main() {
  if (!d.banqor.factory) throw new Error("deployments file has no factory: run the forge Deploy script first");
  const factory = d.banqor.factory;
  console.log(`owner ${owner.address}\nagent ${agent.address}\nfactory ${factory}`);

  // 1. vault
  let vault = await publicClient.readContract({ address: factory, abi: banqorFactoryAbi, functionName: "vaultOf", args: [owner.address] });
  if (vault === zeroAddress) {
    await send("createVault", wallet.writeContract({ address: factory, abi: banqorFactoryAbi, functionName: "createVault", chain }));
    vault = await publicClient.readContract({ address: factory, abi: banqorFactoryAbi, functionName: "vaultOf", args: [owner.address] });
  }
  console.log(`vault ${vault}`);
  saveBanqor("demoVault", vault);

  // 2. line
  const line = await publicClient.readContract({ address: vault, abi: banqorVaultAbi, functionName: "lineStatus" });
  if (!line.lineOpen) {
    const coll = parseEther(need("SETUP_COLLATERAL_BTC"));
    const debt = parseUnits(need("SETUP_DEBT_MUSD"), 18);
    const p = await previewOpenLine(publicClient, d.mezo, coll, debt, BigInt(line.icrFloorBps));
    console.log(
      `open line: ${formatEther(coll)} BTC, ${formatUnits(debt, 18)} MUSD (+fee ${formatUnits(p.fee, 18)}, ` +
        `+gas comp ${formatUnits(p.gasCompensation, 18)}) -> ICR ${Number(p.icrBps) / 100}%, ` +
        `liquidation at $${formatUnits(p.liquidationPrice, 18)}`,
    );
    if (!p.meetsMinDebt) throw new Error(`debt + fee is below Mezo's minimum net debt ${formatUnits(p.minNetDebt, 18)}`);
    if (p.icrBps < BigInt(line.icrFloorBps))
      throw new Error(`ICR ${Number(p.icrBps) / 100}% is below the vault floor ${line.icrFloorBps / 100}%: add collateral`);
    const bal = await publicClient.getBalance({ address: owner.address });
    if (bal < coll) throw new Error(`owner has ${formatEther(bal)} BTC, needs ${formatEther(coll)} + gas (faucet.test.mezo.org)`);
    const trials = await publicClient.readContract({ address: vault, abi: banqorVaultAbi, functionName: "hintTrials" });
    const [upper, lower] = await computeHints(publicClient, d.mezo, coll, p.compositeDebt, BigInt(trials));
    await send(
      "openLine",
      wallet.writeContract({ address: vault, abi: banqorVaultAbi, functionName: "openLine", args: [debt, upper, lower], value: coll, chain }),
    );
  } else {
    console.log("line already open");
  }

  // 3. agent policy
  const days = Number(need("SETUP_AGENT_EXPIRY_DAYS"));
  const policy = {
    dailyCap: parseUnits(need("SETUP_AGENT_DAILY_CAP"), 18),
    maxFloat: parseUnits(need("SETUP_AGENT_MAX_FLOAT"), 18),
    maxDrawPerTx: parseUnits(need("SETUP_AGENT_MAX_DRAW"), 18),
    expiry: days > 0 ? BigInt(Math.floor(Date.now() / 1000) + days * 86_400) : 0n,
    active: true,
  };
  await send(
    `setAgent (cap ${formatUnits(policy.dailyCap, 18)}/day, float ${formatUnits(policy.maxFloat, 18)}, draw ${formatUnits(policy.maxDrawPerTx, 18)})`,
    wallet.writeContract({ address: vault, abi: banqorVaultAbi, functionName: "setAgent", args: [agent.address, policy], chain }),
  );

  // 4. agent gas (Wave 1 agents pay their own draw() gas in BTC)
  const gasTarget = parseEther(need("SETUP_AGENT_GAS_BTC"));
  const agentBtc = await publicClient.getBalance({ address: agent.address });
  if (agentBtc < gasTarget) {
    await send(`fund agent ${formatEther(gasTarget - agentBtc)} BTC`, wallet.sendTransaction({ to: agent.address, value: gasTarget - agentBtc, chain }));
  }

  const s = await publicClient.readContract({ address: vault, abi: banqorVaultAbi, functionName: "lineStatus" });
  console.log(
    `\nline: ${formatEther(s.coll)} BTC / ${formatUnits(s.debt, 18)} MUSD, ICR ${Number(s.icrBps) / 100}%, ` +
      `vault float ${formatUnits(s.vaultFloat, 18)} MUSD\n${d.explorer}/address/${vault}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
