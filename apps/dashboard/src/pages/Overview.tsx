import { useRef, useState } from "react";
import { usePublicClient, useReadContract } from "wagmi";
import { formatUnits, parseEther, parseUnits, type Address } from "viem";
import { banqorVaultAbi, computeHints, lineMath, MEZO_MCR_BPS } from "@banqor/sdk";
import { deployment, explorer, settings } from "../config";
import { amt, day, num, onMezo, ratio, short, toNum, useLineStatus, usd } from "../lib";
import { useTx } from "../tx";
import { agentStatus, useAgents, useMezoParams, useVault } from "../hooks";
import { href } from "../route";
import { Info } from "../ui/Info";
import { VaultGate } from "../ui/Shell";
import { useSlideThumb } from "../ui/thumb";

type LineStatus = NonNullable<ReturnType<typeof useLineStatus>["data"]>;
const E18 = 10n ** 18n;
/** position of a ratio on the 100–400% rail */
const railPct = (bps: number) => ((Math.min(40000, Math.max(10000, bps)) - 10000) / 30000) * 100;

export function Overview() {
  return <VaultGate>{(vault) => <VaultOverview vault={vault} />}</VaultGate>;
}

function VaultOverview({ vault }: { vault: Address }) {
  const { isOwner } = useVault();
  const { data: s, error } = useLineStatus(vault);

  return (
    <div className="pg-overview">
      <div className="head">
        <div className="head-line">
          <h1>{isOwner ? "Your credit line" : "Credit line"}</h1>
          <div className="sub">
            <span className="chip">{short(vault)}</span>
            <a href={explorer.address(vault)} target="_blank" rel="noreferrer">
              Vault on explorer ↗
            </a>
            {!isOwner && <span className="pill">Read-only</span>}
          </div>
        </div>
      </div>
      {error && <p className="alert">Couldn't read the vault: {error.message}</p>}
      {!s && !error && <p className="mute loading">Loading the line…</p>}
      {s && !s.lineOpen && (
        <section className="panel notice">
          <h2>No line open</h2>
          <p className="mute">This vault exists but hasn't opened a credit line yet.</p>
          {isOwner && (
            <a className="btn btn-orange" href={href("open")}>
              Open a line →
            </a>
          )}
        </section>
      )}
      {s && s.troveStatus > 1 && isOwner && <ClosedTrove vault={vault} lineOpen={s.lineOpen} troveStatus={s.troveStatus} />}
      {s && s.lineOpen && <Health s={s} />}
      <div className="stack">
        {s && isOwner && s.lineOpen && s.troveStatus === 1 && <Manage vault={vault} s={s} />}
        {s && <AgentsSummary vault={vault} paused={s.paused} isOwner={isOwner} />}
      </div>
    </div>
  );
}

/** Line health strip: the ratio, the key numbers, and the ratio on a 100–400% rail (FR-UI3). */
function Health({ s }: { s: LineStatus }) {
  const m = lineMath(s.coll, s.debt, s.price, BigInt(s.icrFloorBps));
  const icr = Number(s.icrBps);
  const drop = (p: bigint) => (s.price > 0n ? `BTC −${((1 - toNum(p) / toNum(s.price)) * 100).toFixed(1)}%` : "");
  const state = icr < s.icrFloorBps ? " below" : icr < s.icrFloorBps + 1000 ? " near" : "";
  return (
    <section className="statement" aria-label="Line health">
      <div className="st-row">
        <div className="st-main">
          <p className="lbl">
            Collateral ratio
            <Info label="About line health">
              {`How safe your credit line is. The collateral ratio is your locked BTC's value divided by your MUSD debt. Above your ICR floor (${s.icrFloorBps / 100}% now), agents can draw. Below it, their draws stop on their own. At 110%, Mezo can liquidate the line. Next to it: what you've locked, what you owe, today's BTC price, the BTC prices where draws stop and where liquidation happens, and the MUSD waiting in the vault for agents. The bar underneath puts your ratio on a 100–400% scale.`}
            </Info>
          </p>
          <p className={`icr${state}`}>
            <span>{s.debt === 0n ? "∞" : (icr / 100).toFixed(1)}</span>
            <small>%</small>
          </p>
        </div>
        <dl className="figs">
          <div>
            <dt>BTC locked</dt>
            <dd>{num(s.coll, 4)}</dd>
          </div>
          <div>
            <dt>MUSD debt</dt>
            <dd>{num(s.debt)}</dd>
          </div>
          <div>
            <dt>BTC price</dt>
            <dd>{usd(s.price)}</dd>
          </div>
          <div>
            <dt>Draws stop at</dt>
            <dd>{usd(m.floorPrice)}</dd>
            <span className="drop">{drop(m.floorPrice)}</span>
          </div>
          <div>
            <dt>Liquidation at</dt>
            <dd>{usd(m.liquidationPrice)}</dd>
            <span className="drop">{drop(m.liquidationPrice)}</span>
          </div>
          <div>
            <dt>Vault float</dt>
            <dd>
              {num(s.vaultFloat)} <small>MUSD</small>
            </dd>
          </div>
        </dl>
      </div>
      <div className="gbar" role="img" aria-label={`Collateral ratio ${ratio(s.icrBps)}, floor ${s.icrFloorBps / 100}%, liquidation 110%`}>
        <div className="g-rail">
          <i className="g-danger" />
          <i className="g-safe" style={{ left: `${railPct(s.icrFloorBps)}%` }} />
          <span className="g-tick" style={{ left: `${railPct(Number(MEZO_MCR_BPS))}%` }} />
          <span className="g-tick floor" style={{ left: `${railPct(s.icrFloorBps)}%` }} />
          <span className="g-dot" style={{ left: `${railPct(icr)}%` }} />
        </div>
        <div className="g-labels">
          <span className="liq-l" style={{ left: 0 }}>
            110% liquidation
          </span>
          <span className="floor" style={{ left: `${railPct(s.icrFloorBps)}%` }}>
            {s.icrFloorBps / 100}% floor
          </span>
          <span style={{ right: 0 }}>400%</span>
        </div>
      </div>
    </section>
  );
}

type Act = "add" | "withdraw" | "repay" | "sweep" | "floor";
const ACTS: { key: Act; icon: string; tab: string; label: string; unit: string; go: string; row2: string }[] = [
  { key: "add", icon: "+", tab: "Add BTC", label: "BTC to add", unit: "BTC", go: "Add BTC", row2: "Draws stop below" },
  { key: "withdraw", icon: "−", tab: "Withdraw", label: "BTC to withdraw", unit: "BTC", go: "Withdraw BTC", row2: "Draws stop below" },
  { key: "repay", icon: "↺", tab: "Repay", label: "MUSD to repay from the vault", unit: "MUSD", go: "Repay", row2: "MUSD debt" },
  { key: "sweep", icon: "↗", tab: "Sweep", label: "MUSD to move to your wallet", unit: "MUSD", go: "Sweep to my wallet", row2: "Vault float" },
  { key: "floor", icon: "⟂", tab: "Floor", label: "New ICR floor", unit: "%", go: "Set floor", row2: "Draws stop below" },
];

/** Owner actions with a before → after preview of what each does to the trove. */
function Manage({ vault, s }: { vault: Address; s: LineStatus }) {
  const client = usePublicClient(onMezo);
  const { address: me } = useVault();
  const { gasComp, minNetDebt } = useMezoParams();
  const { data: minFloor } = useReadContract({ ...onMezo, address: vault, abi: banqorVaultAbi, functionName: "MIN_FLOOR_BPS" });
  const tx = useTx();
  const [act, setAct] = useState<Act>("add");
  const [raw, setRaw] = useState("");
  const tabs = useRef<HTMLDivElement>(null);
  const idx = ACTS.findIndex((a) => a.key === act);
  useSlideThumb(tabs, "button", idx);
  const a = ACTS[idx];

  // the vault repays from its own MUSD and never below Mezo's minimum debt
  const maxRepay = (() => {
    if (gasComp === undefined || minNetDebt === undefined) return s.vaultFloat;
    const room = s.debt > gasComp + minNetDebt ? s.debt - gasComp - minNetDebt : 0n;
    return room < s.vaultFloat ? room : s.vaultFloat;
  })();
  // BTC that can leave while staying on the floor, rounded down to 0.0001
  const maxWithdraw = (() => {
    if (s.price === 0n) return 0n;
    const need = (s.debt * BigInt(s.icrFloorBps) * 10n ** 14n + s.price - 1n) / s.price;
    const room = s.coll > need ? s.coll - need : 0n;
    return (room / 10n ** 14n) * 10n ** 14n;
  })();

  const o = (() => {
    let coll = s.coll, debt = s.debt, float = s.vaultFloat, floor = s.icrFloorBps, v = 0n, err = "";
    const t = raw.trim();
    if (!t || !(Number(t) > 0)) return { empty: true, err, coll, debt, float, floor, v };
    try {
      if (act === "floor") {
        const p = Number(t);
        if (!Number.isFinite(p) || Math.round(p * 100) !== p * 100) throw new Error("Use at most two decimals.");
        floor = Math.round(p * 100);
        if (minFloor !== undefined && floor < minFloor) err = `The floor can't go below ${minFloor / 100}%.`;
        else if (floor > 65535) err = "That floor is higher than the vault can store.";
      } else {
        v = act === "add" || act === "withdraw" ? parseEther(t) : parseUnits(t, 18);
      }
    } catch (e) {
      return { empty: false, err: e instanceof Error && e.message.startsWith("Use") ? e.message : "Enter a valid number.", coll, debt, float, floor, v };
    }
    if (act === "add") coll += v;
    if (act === "withdraw") {
      if (v >= s.coll) err = "That is more BTC than the line holds.";
      else coll -= v;
    }
    if (act === "repay") {
      if (v > maxRepay) err = `You can repay up to ${num(maxRepay)} MUSD now: what the vault holds, while keeping Mezo's minimum debt.`;
      else {
        debt -= v;
        float -= v;
      }
    }
    if (act === "sweep") {
      if (v > s.vaultFloat) err = `The vault holds ${num(s.vaultFloat)} MUSD.`;
      else float -= v;
    }
    if (!err && act === "withdraw") {
      const after = lineMath(coll, debt, s.price, BigInt(floor)).icrBps;
      if (after < BigInt(floor)) err = `That would drop the ratio to ${ratio(after)}, under your ${floor / 100}% floor.`;
    }
    return { empty: false, err, coll, debt, float, floor, v };
  })();

  const before = lineMath(s.coll, s.debt, s.price, BigInt(s.icrFloorBps));
  const after = lineMath(o.coll, o.debt, s.price, BigInt(o.floor));
  const d1 = (Number(after.icrBps) - Number(before.icrBps)) / 100;
  const musd = act === "repay" || act === "sweep";
  const pick = (m: { floorPrice: bigint }, st: { debt: bigint; float: bigint }) => (act === "repay" ? st.debt : act === "sweep" ? st.float : m.floorPrice);
  const b2 = pick(before, { debt: s.debt, float: s.vaultFloat }), a2 = pick(after, { debt: o.debt, float: o.float });
  const d2 = toNum(a2) - toNum(b2);
  const show2 = (x: bigint) => (musd ? `${num(x)} MUSD` : usd(x));
  const lowerIsSafer = act === "add" || act === "withdraw" || act === "repay";
  const chip2 = act === "sweep" || act === "floor" ? "" : d2 < 0 === lowerIsSafer ? "good" : "bad";
  const hint =
    act === "add" || act === "withdraw"
      ? o.v > 0n
        ? `≈ ${usd((o.v * s.price) / E18)} at today's price`
        : `BTC is ${usd(s.price)} today`
      : act === "floor"
        ? `Now ${s.icrFloorBps / 100}%${minFloor !== undefined ? ` · lowest allowed ${minFloor / 100}%` : ""}`
        : `The vault holds ${num(s.vaultFloat)} MUSD`;

  const hints = (coll: bigint, debt: bigint) => computeHints(client!, deployment.mezo, coll, debt, settings.hintTrials);
  async function submit() {
    if (o.empty || o.err) return;
    const done = await tx.run(a.go, async () => {
      if (act === "add") {
        const [u, l] = await hints(o.coll, s.debt);
        return { address: vault, abi: banqorVaultAbi, functionName: "addCollateral", args: [u, l], value: o.v };
      }
      if (act === "withdraw") {
        const [u, l] = await hints(o.coll, s.debt);
        return { address: vault, abi: banqorVaultAbi, functionName: "withdrawCollateral", args: [o.v, u, l] };
      }
      if (act === "repay") {
        const [u, l] = await hints(s.coll, o.debt);
        return { address: vault, abi: banqorVaultAbi, functionName: "repay", args: [o.v, u, l] };
      }
      if (act === "sweep") {
        if (!me) throw new Error("connect the owner wallet first");
        return { address: vault, abi: banqorVaultAbi, functionName: "sweep", args: [me, o.v] };
      }
      return { address: vault, abi: banqorVaultAbi, functionName: "setIcrFloor", args: [o.floor] };
    });
    if (done) setRaw(act === "floor" ? String(o.floor / 100) : "");
  }

  const pickTab = (k: Act) => {
    setAct(k);
    setRaw(k === "floor" ? String(s.icrFloorBps / 100) : "");
  };
  const max = act === "withdraw" ? maxWithdraw : act === "repay" ? maxRepay : act === "sweep" ? s.vaultFloat : undefined;
  const unchangedFloor = act === "floor" && o.floor === s.icrFloorBps;

  return (
    <section className="panel" aria-label="Manage the line">
      <h2>Manage the line</h2>
      <div className="acts" role="tablist" aria-label="Action" ref={tabs}>
        {ACTS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={x.key === act} onClick={() => pickTab(x.key)}>
            <span className="gi" aria-hidden="true">
              {x.icon}
            </span>
            {x.tab}
          </button>
        ))}
      </div>
      <form
        className="form"
        id="act-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="amt-card">
          <label htmlFor="amt">{a.label}</label>
          <div className="amt-line">
            <input id="amt" inputMode="decimal" autoComplete="off" placeholder="0.00" value={raw} onChange={(e) => setRaw(e.target.value)} />
            <span className="unit-chip">{a.unit}</span>
          </div>
          <div className="amt-foot">
            <span>{hint}</span>
            {max !== undefined && (
              <button type="button" className="max" onClick={() => setRaw(formatUnits(max, 18))}>
                Max
              </button>
            )}
          </div>
        </div>
        <dl className={`res-card${o.empty ? " idle" : ""}${o.err ? " err" : ""}`}>
          <dt className="res-h">After this</dt>
          <dd className="res-row" style={{ margin: 0 }}>
            <span className="res-k">Collateral ratio</span>
            <span className="res-v">
              <span className="from">{ratio(before.icrBps)}</span>
              <span className="arr" aria-label="becomes">
                →
              </span>
              <span className="to">{ratio(after.icrBps)}</span>
            </span>
            {!o.empty && Math.abs(d1) >= 0.05 && <span className={`delta ${d1 > 0 ? "good" : "bad"}`}>{`${d1 > 0 ? "+" : "−"}${Math.abs(d1).toFixed(1)} pts`}</span>}
          </dd>
          <dd className="res-row" style={{ margin: 0 }}>
            <span className="res-k">{a.row2}</span>
            <span className="res-v">
              <span className="from">{show2(b2)}</span>
              <span className="arr" aria-label="becomes">
                →
              </span>
              <span className="to">{show2(a2)}</span>
            </span>
            {!o.empty && Math.abs(d2) >= 0.005 && (
              <span className={`delta${chip2 ? " " + chip2 : ""}`}>{`${d2 > 0 ? "+" : "−"}${musd ? `${num(Math.abs(d2))} MUSD` : usd(Math.abs(d2))}`}</span>
            )}
          </dd>
        </dl>
        <p className={`note${o.err ? " err" : ""}`} aria-live="polite">
          {o.err}
        </p>
        <button className="btn btn-orange" type="submit" id="go" disabled={o.empty || !!o.err || unchangedFloor || tx.busy}>
          {a.go}
        </button>
      </form>
      <details className="more">
        <summary>Close the line</summary>
        <p className="mute">
          Repays the whole trove and sends all your BTC back. The vault must already hold the full debt in MUSD, minus Mezo's gas deposit.
        </p>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={tx.busy}
          onClick={() => window.confirm("Close the line and return all BTC to your wallet?") && tx.run("Close line", { address: vault, abi: banqorVaultAbi, functionName: "closeLine" })}
        >
          Close the line
        </button>
      </details>
    </section>
  );
}

const CLOSED_BY: Record<number, string> = { 2: "you", 3: "liquidation", 4: "redemption" };

/** After Mezo closes the trove (liquidation / redemption): recover any surplus BTC and reset the line. */
function ClosedTrove({ vault, lineOpen, troveStatus }: { vault: Address; lineOpen: boolean; troveStatus: number }) {
  const tx = useTx();
  return (
    <section className="panel notice warn">
      <h2>The trove was closed by {CLOSED_BY[troveStatus] ?? "Mezo"}</h2>
      <p className="mute">Claim any BTC Mezo kept for you, then reset the line so you can open a new one.</p>
      <div className="stage-acts">
        <button className="btn btn-orange" type="button" disabled={tx.busy} onClick={() => tx.run("Claim collateral", { address: vault, abi: banqorVaultAbi, functionName: "claimCollateral" })}>
          Claim surplus BTC
        </button>
        {lineOpen && (
          <button className="btn btn-ghost" type="button" disabled={tx.busy} onClick={() => tx.run("Reset line", { address: vault, abi: banqorVaultAbi, functionName: "closeLine" })}>
            Reset line
          </button>
        )}
      </div>
    </section>
  );
}

/** Agents with the pause switch in the header (FR-UI5), one row per agent. */
function AgentsSummary({ vault, paused, isOwner }: { vault: Address; paused: boolean; isOwner: boolean }) {
  const { rows, loading, count } = useAgents(vault);
  const tx = useTx();
  const { vaultParam } = useVault();
  return (
    <section className={`panel agents-panel${paused ? " paused" : ""}`} id="kill" aria-label="Agents">
      <div className="ap-head">
        <h2>Agents</h2>
        {paused && <span className="pill off">All draws paused</span>}
        <div className="ap-actions">
          <a className="btn btn-ghost btn-sm" href={href("agents", vaultParam)}>
            {isOwner ? "Manage agents" : "See agents"}
          </a>
          {isOwner && (
            <button
              className={`btn btn-sm ${paused ? "btn-orange" : "btn-danger"}`}
              id="kill-btn"
              type="button"
              disabled={tx.busy}
              onClick={() => tx.run(paused ? "Unpause agents" : "Pause all agents", { address: vault, abi: banqorVaultAbi, functionName: paused ? "unpause" : "pause" })}
            >
              {paused ? "Unpause agents" : "Pause all agents"}
            </button>
          )}
        </div>
      </div>
      {loading && <p className="mute">Loading agents…</p>}
      {!loading && count === 0 && (
        <p className="mute empty-row">
          No agents yet.{" "}
          {isOwner && (
            <a href={href("agents")}>
              Add your first agent →
            </a>
          )}
        </p>
      )}
      {rows.length > 0 && (
        <div className="ap-table" role="table" aria-label="Agents and their limits">
          <div className="ap-row ap-th" role="row">
            <span role="columnheader">Agent</span>
            <span role="columnheader">Spent today</span>
            <span role="columnheader">Holding now</span>
            <span role="columnheader">Can draw now</span>
            <span role="columnheader">Expires</span>
          </div>
          {rows.map((r) => {
            const [cls, label] = agentStatus(r.policy, paused);
            const pctOf = (a: bigint, b: bigint) => (b > 0n ? Math.min(100, (toNum(a) / toNum(b)) * 100) : 0);
            return (
              <div key={r.addr} className={`ap-row${cls === "off" ? " is-off" : ""}`} role="row">
                <span className="ap-who" role="cell">
                  <span className={`ap-av${cls === "off" ? " off" : ""}`} aria-hidden="true" />
                  <a className="mono" href={explorer.address(r.addr)} target="_blank" rel="noreferrer">
                    {short(r.addr)}
                  </a>
                  <span className={`pill ${cls}`}>{label}</span>
                </span>
                <span className="ap-meter" role="cell" data-label="Spent today">
                  <span>
                    <b>{num(r.spentInWindow)}</b> / {amt(r.policy.dailyCap)} MUSD
                  </span>
                  <span className="track">
                    <i style={{ width: `${pctOf(r.spentInWindow, r.policy.dailyCap)}%` }} />
                  </span>
                </span>
                <span className="ap-meter" role="cell" data-label="Holding now">
                  <span>
                    <b>{num(r.agentBalance)}</b> / {amt(r.policy.maxFloat)} MUSD
                  </span>
                  <span className="track">
                    <i style={{ width: `${pctOf(r.agentBalance, r.policy.maxFloat)}%` }} />
                  </span>
                </span>
                <span className="mono" role="cell" data-label="Can draw now">
                  {num(r.drawableNow)} MUSD
                </span>
                <span role="cell" data-label="Expires">
                  {r.policy.expiry === 0n ? "Never" : day(r.policy.expiry)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
