// Demo agent (FR-A2): N paid x402 calls with automatic draws from the vault, with a live log.
import { formatUnits } from "viem";
import { BanQorError, createBanQorFetch, createVaultClient, type BanQorEvent } from "@banqor/sdk";
import { agentAccount, context, demoVault, explorerTx, need, opt } from "./env.js";

const { deployment: d, rpcUrl } = context();
const vaultAddr = demoVault(d);
const agent = agentAccount();
const base = opt("API_BASE_URL", `http://localhost:${opt("API_PORT", "4021")}`).replace(/\/$/, "");
const calls = Number(opt("AGENT_CALLS", "100")); // FR-A2 default
const endpoints = (process.env.AGENT_ENDPOINTS ?? "/price,/funding,/sentiment").split(",");
const payees = process.env.PAY_TO ? [process.env.PAY_TO as `0x${string}`] : undefined;

const m = (x: bigint) => Number(formatUnits(x, 18)).toFixed(4);
const stats = { ok: 0, failed: 0, refused: 0, paid: 0n, draws: 0, borrowed: 0n };

const vault = createVaultClient({ vault: vaultAddr, network: d.network, rpcUrl });
const onEvent = (e: BanQorEvent) => {
  if (e.type === "draw") {
    stats.draws++;
    stats.borrowed += e.borrowed;
    const src = e.borrowed > 0n ? `borrowed ${m(e.borrowed)} MUSD from the trove` : "from vault float";
    console.log(`   ⤷ draw ${m(e.amount)} MUSD (${src}) -> float ${m(e.balanceAfter)}  ${explorerTx(d, e.hash)}`);
  } else if (e.type === "payment") {
    if (e.status < 400) stats.paid += e.amount;
  } else {
    stats.refused++;
    console.log(`   ✗ refused ${e.code}: ${e.message}`);
  }
};

const fetchPaid = createBanQorFetch({
  account: agent,
  vault: vaultAddr,
  network: d.network,
  rpcUrl,
  minFloat: need("AGENT_MIN_FLOAT"),
  topUp: need("AGENT_TOP_UP"),
  maxPricePerCall: need("AGENT_MAX_PRICE_PER_CALL"),
  allowedPayees: payees,
  onEvent,
});

async function status() {
  const [line, a] = await Promise.all([vault.getLineStatus(), vault.getAgentStatus(agent.address)]);
  return (
    `ICR ${Number(line.icrBps) / 100}% (floor ${line.icrFloorBps / 100}%), trove debt ${m(line.debt)}, ` +
    `spent today ${m(a.spentInWindow)}/${m(a.policy.dailyCap)}, float ${m(a.agentBalance)}`
  );
}

async function main() {
  console.log(`agent ${agent.address} -> vault ${vaultAddr}\n${await status()}\n`);
  for (let i = 1; i <= calls; i++) {
    const path = endpoints[(i - 1) % endpoints.length]!;
    const t0 = Date.now();
    try {
      const res = await fetchPaid(`${base}${path}`);
      const body = (await res.json().catch(() => ({}))) as { data?: unknown; source?: string };
      if (res.ok) stats.ok++;
      else stats.failed++;
      console.log(`#${String(i).padStart(3)} ${path.padEnd(10)} ${res.status} ${String(Date.now() - t0).padStart(5)}ms ${body.source ?? ""} ${JSON.stringify(body.data ?? body).slice(0, 70)}`);
    } catch (e) {
      stats.failed++;
      const msg = e instanceof BanQorError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      console.log(`#${String(i).padStart(3)} ${path.padEnd(10)} ERR ${msg}`);
      // any typed refusal (vault policy or SDK guard) would repeat on every call, so stop
      if (e instanceof BanQorError && e.code !== "Unknown") {
        console.log("   stopping: credit refused");
        break;
      }
    }
    if (i % 10 === 0) console.log(`   · ${await status()}`);
  }
  console.log(
    `\ndone: ${stats.ok} paid calls ok, ${stats.failed} failed, ${stats.refused} refused, ` +
      `${m(stats.paid)} MUSD paid, ${stats.draws} draws, ${m(stats.borrowed)} MUSD borrowed from the trove\n${await status()}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
