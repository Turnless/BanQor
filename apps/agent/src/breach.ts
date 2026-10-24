// Breach demo (FR-A3): every attempt is refused on-chain, and the script prints the reason.
//  1. a draw above the per-draw cap        -> DrawTooLarge
//  2. a draw above the daily cap           -> DailyCapExceeded (via a probe agent with a tiny cap)
//  3. a draw while the owner has paused    -> Paused
//  4. a draw from an unregistered key      -> NotAgent
// Refused draws are simulated (eth_call), so they cost no gas. Owner steps (probe, pause) are real txs.
import { createWalletClient, getAddress, http, keccak256, parseUnits, stringToHex, type Address } from "viem";
import { banqorVaultAbi, createVaultClient, toBanQorError } from "@banqor/sdk";
import { agentAccount, context, demoVault, explorerTx, ownerAccount } from "./env.js";

const { deployment: d, rpcUrl, chain, publicClient } = context();
const vaultAddr = demoVault(d);
const owner = ownerAccount();
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });

async function ownerTx(functionName: "pause" | "unpause" | "setAgent" | "revokeAgent", args: readonly unknown[] = []) {
  const hash = await ownerWallet.writeContract({ address: vaultAddr, abi: banqorVaultAbi, functionName, args, chain } as never);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`   owner ${functionName}  ${explorerTx(d, hash)}`);
}

// eth_call only needs a sender address, so probes need no keys. The probe address is derived from the
// vault, so repeated runs reuse one agentList entry instead of adding a new one each time.
const derived = (tag: string): Address => getAddress(`0x${keccak256(stringToHex(`banqor:${tag}:${vaultAddr}`)).slice(26)}`);

async function attempt(label: string, account: Address, amount: bigint) {
  try {
    await publicClient.simulateContract({ account, address: vaultAddr, abi: banqorVaultAbi, functionName: "draw", args: [amount] });
    console.log(`✗ ${label}: NOT refused (this should never happen)`);
    return false;
  } catch (e) {
    // the same typed error the SDK gives an agent
    console.log(`✓ ${label}: refused with ${toBanQorError(e).code}`);
    return true;
  }
}

async function main() {
  const agent = agentAccount();
  const a = await createVaultClient({ vault: vaultAddr, network: d.network, rpcUrl }).getAgentStatus(agent.address);
  let ok = true;

  ok = (await attempt(`draw ${a.policy.maxDrawPerTx + 1n} wei above maxDrawPerTx`, agent.address, a.policy.maxDrawPerTx + 1n)) && ok;

  const probe = derived("breach-probe");
  const tiny = parseUnits("0.01", 18);
  await ownerTx("setAgent", [probe, { dailyCap: tiny, maxFloat: parseUnits("1", 18), maxDrawPerTx: parseUnits("1", 18), expiry: 0n, active: true }]);
  try {
    ok = (await attempt("draw 0.02 MUSD against a 0.01 MUSD daily cap", probe, tiny * 2n)) && ok;
  } finally {
    await ownerTx("revokeAgent", [probe]);
  }

  // if the script is interrupted while paused, unpause before exiting
  let paused = false;
  const restore = async () => {
    if (paused) await ownerTx("unpause").catch((e) => console.error("UNPAUSE FAILED, unpause from the dashboard:", e));
    process.exit(130);
  };
  process.once("SIGINT", restore);
  process.once("SIGTERM", restore);
  await ownerTx("pause");
  paused = true;
  try {
    ok = (await attempt("draw while paused", agent.address, parseUnits("0.1", 18))) && ok;
  } finally {
    await ownerTx("unpause");
    paused = false;
  }

  ok = (await attempt("draw from an unregistered address", derived("never-registered"), parseUnits("0.1", 18))) && ok;

  console.log(ok ? "\nall breaches blocked on-chain" : "\nSOME BREACH WAS NOT BLOCKED");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
