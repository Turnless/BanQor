import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { getVaultActivity, type VaultActivity } from "@banqor/sdk";
import { deployment, explorer, settings } from "../config";
import { amt, day, num, onMezo, short } from "../lib";
import { useVault } from "../hooks";
import { VaultGate } from "../ui/Shell";

export function Activity() {
  return <VaultGate>{(vault) => <ActivityPage vault={vault} />}</VaultGate>;
}

type Kind = "draws" | "line" | "agents" | "safety";
const FILTERS: [Kind | "all", string][] = [
  ["all", "All"],
  ["draws", "Agent draws"],
  ["line", "Credit line"],
  ["agents", "Agents"],
  ["safety", "Safety"],
];
const big = (v: unknown) => (typeof v === "bigint" ? v : 0n);
const addr = (v: unknown) => short(String(v));

/** Each event in plain words: [filter, icon class, icon, title, detail]. */
function describe(e: VaultActivity, owner?: string): [Kind, string, string, ReactNode, string] {
  const a = e.args;
  switch (e.eventName) {
    case "Drawn":
      return ["draws", "draw", "↓", <>Agent <span className="mono">{addr(a.agent)}</span> drew <b>{amt(big(a.amount))} MUSD</b></>, big(a.borrowed) > 0n ? `The vault was short, so it borrowed ${amt(big(a.borrowed))} MUSD against your BTC first.` : "Paid from MUSD already in the vault."];
    case "Borrowed":
      return ["line", "line", "⇣", <>Vault borrowed <b>{amt(big(a.amount))} MUSD</b> against your BTC</>, "Topped up the vault so agent draws could continue."];
    case "LineOpened":
      return ["line", "line", "◎", <>Line opened with <b>{amt(big(a.coll))} BTC</b></>, `Starting debt ${num(big(a.debt))} MUSD, including Mezo's fee and gas deposit.`];
    case "LineClosed":
      return ["line", "line", "◌", "Line closed", `${amt(big(a.collReturned))} BTC returned to you.`];
    case "Swept":
      return ["line", "line", "↗", <>Moved <b>{amt(big(a.amount))} MUSD</b> out of the vault</>, owner && String(a.to).toLowerCase() === owner.toLowerCase() ? "To your wallet." : `To ${addr(a.to)}.`];
    case "Repaid":
      return ["line", "line", "↺", <>Repaid <b>{amt(big(a.amount))} MUSD</b></>, "Debt reduced from the vault's MUSD."];
    case "CollateralAdded":
      return ["line", "line", "+", <>Added <b>{amt(big(a.amount))} BTC</b></>, "More collateral behind the line."];
    case "CollateralWithdrawn":
      return ["line", "line", "−", <>Withdrew <b>{amt(big(a.amount))} BTC</b></>, "Collateral returned to you."];
    case "CollateralClaimed":
      return ["line", "line", "↙", <>Claimed <b>{amt(big(a.amount))} BTC</b></>, "Surplus Mezo kept after the trove closed."];
    case "AgentSet": {
      const p = a.policy as { dailyCap: bigint; maxDrawPerTx: bigint; maxFloat: bigint; expiry: bigint };
      return ["agents", "agent", "✦", <>Agent <span className="mono">{addr(a.agent)}</span> added or updated</>, `${amt(p.dailyCap)} MUSD a day, ${amt(p.maxDrawPerTx)} per draw, holds up to ${amt(p.maxFloat)}${p.expiry ? `, until ${day(p.expiry)}` : ", no end date"}.`];
    }
    case "AgentRevoked":
      return ["agents", "agent", "✕", <>Agent <span className="mono">{addr(a.agent)}</span> revoked</>, "It can no longer draw from the vault."];
    case "VaultPaused":
      return ["safety", "safety", "❚❚", "All agents paused", "Every draw is refused until you unpause."];
    case "VaultUnpaused":
      return ["safety", "safety", "▶", "Agents unpaused", "Draws allowed again, within each agent's limits."];
    case "IcrFloorSet":
      return ["safety", "safety", "⟂", <>ICR floor set to <b>{Number(a.bps) / 100}%</b></>, "Agent draws stop below this ratio."];
    case "Rebalanced":
      return ["safety", "safety", "⇅", <>Rebalanced: repaid <b>{amt(big(a.repaid))} MUSD</b></>, "Brought the ratio back above the floor."];
    case "BorrowBufferSet":
      return ["safety", "safety", "≡", <>Borrow buffer set to <b>{amt(big(a.amount))} MUSD</b></>, "Extra borrowed on top of each shortfall."];
  }
}

function ActivityPage({ vault }: { vault: Address }) {
  const { isOwner, address } = useVault();
  const client = usePublicClient(onMezo);
  const [filter, setFilter] = useState<Kind | "all">("all");
  // the full history is scanned once; later polls only fetch blocks after the last one scanned
  const seen = useRef<{ vault: Address; toBlock: bigint; events: VaultActivity[] } | undefined>(undefined);
  const q = useQuery({
    queryKey: ["activity", vault],
    enabled: !!client && isOwner,
    refetchInterval: settings.pollMs * 3,
    queryFn: async () => {
      const head = await client!.getBlockNumber();
      const prev = seen.current?.vault === vault ? seen.current : undefined;
      if (prev && prev.toBlock >= head) return prev.events;
      const deployed = deployment.banqor.factoryDeployBlock;
      const floor = head > settings.activityLookback ? head - settings.activityLookback : 0n;
      const start = deployed !== null && BigInt(deployed) > floor ? BigInt(deployed) : floor;
      const fresh = await getVaultActivity(client!, { vault, fromBlock: prev ? prev.toBlock + 1n : start, toBlock: head, maxRange: settings.logsMaxRange, limit: settings.activityLimit });
      const events = [...fresh, ...(prev?.events ?? [])].slice(0, settings.activityLimit);
      seen.current = { vault, toBlock: head, events };
      return events;
    },
  });
  // block times for the rows, fetched once per block
  const blocks = [...new Set((q.data ?? []).map((e) => e.blockNumber))];
  const times = useQuery({
    queryKey: ["block-times", ...blocks.map(String)],
    enabled: !!client && blocks.length > 0,
    staleTime: Infinity,
    queryFn: async () => Object.fromEntries(await Promise.all(blocks.map(async (b) => [String(b), Number((await client!.getBlock({ blockNumber: b })).timestamp)] as const))),
  });

  if (!isOwner)
    return (
      <div className="pg-activity">
        <div className="head">
          <div>
            <h1>Activity</h1>
          </div>
        </div>
        <section className="panel locked" aria-label="Owner only">
          <h2>Activity is for the vault owner</h2>
          <p>
            Connect the owner wallet to see this vault's history here. Like everything on a blockchain, the raw transactions are still public on the{" "}
            <a href={explorer.address(vault)} target="_blank" rel="noreferrer">
              Mezo explorer
            </a>
            ; this page just doesn't put them on display.
          </p>
        </section>
      </div>
    );

  const rows = (q.data ?? []).map((e) => ({ e, d: describe(e, address) }));
  const shown = rows.filter((r) => filter === "all" || r.d[0] === filter);
  const drawn = rows.filter((r) => r.e.eventName === "Drawn").reduce((s, r) => s + big(r.e.args.amount), 0n);
  const borrowed = rows.filter((r) => r.e.eventName === "Borrowed").reduce((s, r) => s + big(r.e.args.amount), 0n);
  const tOf = (b: bigint) => times.data?.[String(b)];
  const when = (b: bigint) => {
    const t = tOf(b);
    if (!t) return "";
    const d = new Date(t * 1000);
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
  };
  const last = rows[0]?.e;

  return (
    <div className="pg-activity">
      <div className="head">
        <div>
          <h1>Activity</h1>
          <div className="sub">
            <span className="mute">Only you see this page in the dashboard. What your agents drew, what the vault borrowed, and every change you made.</span>
          </div>
        </div>
      </div>
      {q.error && (
        <p className="alert">
          Couldn't load activity ({(q.error as Error).message}).{" "}
          <a href={explorer.address(vault)} target="_blank" rel="noreferrer">
            See the vault on the explorer
          </a>
        </p>
      )}
      <dl className="sum">
        <div>
          <dt>Drawn by agents</dt>
          <dd>
            {amt(drawn)} <small>MUSD</small>
          </dd>
        </div>
        <div>
          <dt>Borrowed on demand</dt>
          <dd>
            {amt(borrowed)} <small>MUSD</small>
          </dd>
        </div>
        <div>
          <dt>Events</dt>
          <dd>{q.isLoading ? "…" : rows.length}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{last && tOf(last.blockNumber) ? <>{new Date(tOf(last.blockNumber)! * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</> : "—"}</dd>
        </div>
      </dl>
      <div className="filters" role="group" aria-label="Show">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
            <span className="n">{k === "all" ? rows.length : rows.filter((r) => r.d[0] === k).length}</span>
          </button>
        ))}
      </div>
      <ul className="log" aria-live="polite">
        {q.isLoading && <li className="empty">Reading the vault's history from Mezo…</li>}
        {!q.isLoading && shown.length === 0 && <li className="empty">Nothing of this kind yet.</li>}
        {shown.map(({ e, d }) => (
          <li key={`${e.transactionHash}-${e.logIndex}`}>
            <span className={`ic ${d[1]}`} aria-hidden="true">
              {d[2]}
            </span>
            <span className="what">
              {d[3]}
              <span className="detail">{d[4]}</span>
            </span>
            <span className="when">
              {when(e.blockNumber)}
              {when(e.blockNumber) && <br />}
              <a href={explorer.tx(e.transactionHash)} target="_blank" rel="noreferrer">
                block {e.blockNumber.toString()} ↗
              </a>
            </span>
          </li>
        ))}
      </ul>
      {rows.length >= settings.activityLimit && <p className="mute" style={{ fontSize: 13 }}>Showing the latest {settings.activityLimit} events. Older ones are on the explorer.</p>}
    </div>
  );
}

