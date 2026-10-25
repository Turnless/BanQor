import { useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import { banqorVaultAbi, toBanQorError, type BanQorErrorCode } from "@banqor/sdk";
import { explorer } from "../config";
import { amt, day, num, onMezo, short, toNum, useLineStatus } from "../lib";
import { useTx } from "../tx";
import { agentStatus, isExpired, nowSec, useAgents, useVault, type AgentRow, type Policy } from "../hooks";
import { Sheet } from "../ui/Sheet";
import { VaultGate } from "../ui/Shell";

export function Agents() {
  return <VaultGate>{(vault) => <AgentsPage vault={vault} />}</VaultGate>;
}

type Editing = { kind: "new" } | { kind: "edit"; row: AgentRow } | null;

function AgentsPage({ vault }: { vault: Address }) {
  const { isOwner } = useVault();
  const { data: line } = useLineStatus(vault);
  const { rows, loading, count } = useAgents(vault);
  const tx = useTx();
  const [testing, setTesting] = useState<Address | "pick" | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [flash, setFlash] = useState<Address>();
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(undefined), 1300);
    return () => clearTimeout(t);
  }, [flash]);

  const revoke = (r: AgentRow) => tx.run(`Revoke ${short(r.addr)}`, { address: vault, abi: banqorVaultAbi, functionName: "revokeAgent", args: [r.addr] }).then((ok) => ok && setFlash(r.addr));
  const enable = (r: AgentRow) =>
    tx.run(`Re-enable ${short(r.addr)}`, { address: vault, abi: banqorVaultAbi, functionName: "setAgent", args: [r.addr, { ...r.policy, active: true }] }).then((ok) => ok && setFlash(r.addr));
  const editingAddr = editing?.kind === "edit" ? editing.row.addr : undefined;

  return (
    <div className="pg-agents">
      <div className="head">
        <div>
          <h1>Agents</h1>
          <div className="sub">
            <span className="mute">Each agent has its own key and its own limits. The vault checks them on every draw, so an agent can't spend past them even if its key leaks.</span>
          </div>
        </div>
        <div className="head-acts">
          <button className="btn btn-ghost" type="button" disabled={!rows.length} onClick={() => setTesting("pick")}>
            Test a draw
          </button>
          {isOwner && (
            <button className="btn btn-orange" type="button" onClick={() => setEditing({ kind: "new" })}>
              + Add an agent
            </button>
          )}
        </div>
      </div>

      <section className="panel alist" aria-labelledby="list-h">
        <h2 id="list-h">
          <span>
            Your agents<span className="count">{count}</span>
          </span>
        </h2>
        {rows.length > 0 && (
          <div className="a-head" aria-hidden="true">
            <span>Agent</span>
            <span>Limits</span>
            <span>Spent today</span>
            <span />
          </div>
        )}
        <div id="list" aria-live="polite">
          {loading && <p className="mute">Loading agents…</p>}
          {!loading && count === 0 && <p className="mute empty-row">No agents yet. Add one to give it a spending limit on this line.</p>}
          {rows.map((r) => {
            const [cls, label] = agentStatus(r.policy, line?.paused);
            const p = r.policy;
            return (
              <article key={r.addr} className={`arow${p.active ? "" : " is-off"}${editingAddr === r.addr ? " editing" : ""}${flash === r.addr ? " flash" : ""}`}>
                <div className="a-id">
                  <span className="a-av" aria-hidden="true" />
                  <span className="a-name">
                    <CopyAddr addr={r.addr} />
                    <span className={`pill ${cls}`}>{label}</span>
                  </span>
                </div>
                <div className="a-acts">
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setTesting(r.addr)}>
                    Test
                  </button>
                  {isOwner && (
                    <>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing({ kind: "edit", row: r })}>
                        Edit
                      </button>
                      {p.active ? (
                        <button className="btn btn-ghost btn-sm" type="button" style={{ color: "#ff8f73" }} disabled={tx.busy} onClick={() => revoke(r)}>
                          Revoke
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" type="button" disabled={tx.busy} onClick={() => enable(r)}>
                          Re-enable
                        </button>
                      )}
                    </>
                  )}
                </div>
                <p className="a-sum">
                  Up to <b>{amt(p.dailyCap)} MUSD a day</b>, {amt(p.maxDrawPerTx)} per draw, holds up to {amt(p.maxFloat)} · {p.expiry === 0n ? "no end date" : `${isExpired(p) ? "expired" : "until"} ${day(p.expiry)}`}
                </p>
                <div className="a-spend">
                  <small>
                    <span>Spent today</span>
                    <b>
                      {num(r.spentInWindow)} of {amt(p.dailyCap)}
                    </b>
                  </small>
                  <div className="track">
                    <i style={{ width: `${p.dailyCap > 0n ? Math.min(100, (toNum(r.spentInWindow) / toNum(p.dailyCap)) * 100) : 0}%` }} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {isOwner && (
          <button className="a-add" type="button" onClick={() => setEditing({ kind: "new" })}>
            + Add {count ? "another" : "an"} agent
          </button>
        )}
      </section>

      <Sheet open={testing !== null} onClose={() => setTesting(null)} title="Test a draw" sub="See what the vault would do if an agent asked for money right now. Nothing is sent.">
        {testing !== null && <TestDraw vault={vault} rows={rows} initial={testing === "pick" ? rows[0]?.addr : testing} line={line} />}
      </Sheet>
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        wide
        title={editing?.kind === "edit" ? `Edit ${short(editing.row.addr)}` : "Add an agent"}
        sub={editing?.kind === "edit" ? "Change its limits. What it has spent today is kept." : "Give an agent key its own limits. The vault enforces them on every draw."}
      >
        {editing && (
          <Editor
            key={editing.kind === "edit" ? editing.row.addr : "new"}
            vault={vault}
            rows={rows}
            current={editing.kind === "edit" ? editing.row : undefined}
            onDone={(addr) => {
              setEditing(null);
              setFlash(addr);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

function CopyAddr({ addr }: { addr: Address }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="a-addr"
      type="button"
      title={addr}
      aria-label={`Copy ${addr}`}
      onClick={() =>
        navigator.clipboard?.writeText(addr).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        })
      }
    >
      {short(addr)}
      <span className="cp">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Test a draw: the checks BanQorVault.draw() runs, in its order, confirmed against the live contract
// ---------------------------------------------------------------------------------------------------------

const STEP_CODES: BanQorErrorCode[] = ["Paused", "NotAgent", "AgentInactive", "AgentExpired", "ZeroAmount", "DrawTooLarge", "DailyCapExceeded", "FloatExceeded", "LineNotOpen", "IcrTooLow"];
const CODE_NAME: Partial<Record<BanQorErrorCode, string>> = { Paused: "ErrPaused" };
type Line = ReturnType<typeof useLineStatus>["data"];

function TestDraw({ vault, rows, initial, line }: { vault: Address; rows: AgentRow[]; initial?: Address; line: Line }) {
  const client = usePublicClient(onMezo);
  const [agent, setAgent] = useState<Address | undefined>(initial);
  const [raw, setRaw] = useState("1");
  const [marks, setMarks] = useState<("pass" | "fail" | "skip" | "")[]>([]);
  const [verdict, setVerdict] = useState<{ ok: boolean; title: string; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const run = useRef(0);
  const r = rows.find((x) => x.addr === agent);

  const left = r ? (r.policy.dailyCap > r.spentInWindow ? r.policy.dailyCap - r.spentInWindow : 0n) : 0n;
  // each check takes the amount being tested, so a run never reads an amount from an earlier render
  const steps: { label: string; ok: (amount: bigint) => boolean }[] = [
    { label: "Agents aren't paused", ok: () => !line?.paused },
    { label: "The address is a registered agent", ok: () => !!r },
    { label: "The agent is allowed to draw", ok: () => !!r?.policy.active },
    { label: "Its permission hasn't expired", ok: () => !!r && !isExpired(r.policy) },
    { label: "The amount is more than zero", ok: (a) => a > 0n },
    { label: `At most ${r ? amt(r.policy.maxDrawPerTx) : "—"} MUSD per draw`, ok: (a) => !!r && a <= r.policy.maxDrawPerTx },
    { label: `Stays inside today's cap (${num(left)} left)`, ok: (a) => !!r && a <= left },
    { label: `Keeps its holding under ${r ? amt(r.policy.maxFloat) : "—"} MUSD`, ok: (a) => !!r && r.agentBalance + a <= r.policy.maxFloat },
    { label: "The credit line is open", ok: () => !!line?.lineOpen && line.troveStatus === 1 },
    { label: "The line stays above your ICR floor", ok: () => !!line && line.icrBps >= BigInt(line.icrFloorBps) },
  ];

  // a new agent or amount clears the last result; a quick-amount chip then runs the checks for its amount
  const pending = useRef<string | null>(null);
  useEffect(() => {
    run.current++;
    setMarks([]);
    setVerdict(null);
    setChecking(false);
    if (pending.current !== null) {
      const a = pending.current;
      pending.current = null;
      void check(a);
    }
  }, [agent, raw]); // eslint-disable-line react-hooks/exhaustive-deps

  async function check(amountRaw = raw) {
    const me = ++run.current;
    setMarks([]);
    setVerdict(null);
    let amount: bigint;
    try {
      amount = parseUnits(amountRaw.trim(), 18);
    } catch {
      setVerdict({ ok: false, title: "Enter an amount", text: "Type how much the agent asks for." });
      return;
    }
    if (!agent) return;
    const localFail = steps.findIndex((s) => !s.ok(amount));
    // the live contract has the final word: simulate draw() as the agent
    setChecking(true);
    let failed = localFail, reason = "";
    try {
      await client!.simulateContract({ address: vault, abi: banqorVaultAbi, functionName: "draw", args: [amount], account: agent });
      failed = -1;
    } catch (e) {
      const err = toBanQorError(e);
      const i = STEP_CODES.indexOf(err.code);
      if (i >= 0) failed = i;
      else {
        failed = localFail >= 0 ? localFail : steps.length - 1;
        reason = err.message;
      }
    }
    if (me !== run.current) return;
    setChecking(false);
    const last = failed < 0 ? steps.length - 1 : failed;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    steps.forEach((_, i) =>
      setTimeout(() => {
        if (me !== run.current) return;
        setMarks((m) => {
          const n = [...m];
          n[i] = i < last || (i === last && failed < 0) ? "pass" : i === last ? "fail" : "skip";
          return n;
        });
        if (i === steps.length - 1)
          setVerdict(
            failed < 0
              ? { ok: true, title: "It goes through", text: `${short(agent)} receives ${num(amount)} MUSD. If the vault is short, it borrows the difference against your BTC first.` }
              : { ok: false, title: `Blocked at check ${failed + 1}`, text: reason || `${steps[failed].label}: no. The vault stops with ${CODE_NAME[STEP_CODES[failed]] ?? STEP_CODES[failed]} and no MUSD moves.` },
          );
      }, still ? 0 : i * 140),
    );
  }

  return (
    <>
      <div className="field">
        <label htmlFor="t-agent">Agent</label>
        <select className="select" id="t-agent" value={agent} onChange={(e) => setAgent(e.target.value as Address)}>
          {rows.map((x) => (
            <option key={x.addr} value={x.addr}>
              {short(x.addr)} · {agentStatus(x.policy, line?.paused)[1]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="t-amt">Amount</label>
        <div className="t-row">
          <div className="inwrap">
            <input id="t-amt" data-autofocus inputMode="decimal" autoComplete="off" value={raw} onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && check()} />
            <span className="unit">MUSD</span>
          </div>
          <button className="btn btn-orange" type="button" disabled={checking} onClick={() => check()}>
            {checking ? "Checking…" : "Run checks"}
          </button>
        </div>
        <div className="chips" role="group" aria-label="Quick amounts">
          {["0.5", "1", "2", "25"].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                if (a === raw) void check(a);
                else {
                  pending.current = a;
                  setRaw(a);
                }
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </div>
      <ol className="checks" aria-label="The vault's checks, in order">
        {steps.map((s, i) => (
          <li key={i} className={marks[i] ?? ""}>
            <span className="mk">{i + 1}</span>
            <span>{s.label}</span>
            <code>{CODE_NAME[STEP_CODES[i]] ?? STEP_CODES[i]}</code>
          </li>
        ))}
      </ol>
      {verdict && (
        <p className={`verdict ${verdict.ok ? "ok" : "no"}`} role="status">
          <b>{verdict.title}</b>
          {verdict.text}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Add / edit an agent: setAgent(address, Policy)
// ---------------------------------------------------------------------------------------------------------

const PRESETS = [
  { name: "Light", per: "5/day", cap: "5", draw: "0.5", float: "1" },
  { name: "Standard", per: "20/day", cap: "20", draw: "1", float: "2" },
  { name: "Heavy", per: "50/day", cap: "50", draw: "2", float: "5" },
];
type Dur = "keep" | "7" | "30" | "90" | "never" | "custom";
const DAY = 86_400;
const isoDay = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

function Editor({ vault, rows, current, onDone, onCancel }: { vault: Address; rows: AgentRow[]; current?: AgentRow; onDone: (a: Address) => void; onCancel: () => void }) {
  const { address: me } = useVault();
  const tx = useTx();
  const fromWei = (v: bigint) => formatUnits(v, 18);
  const [addr, setAddr] = useState<string>(current?.addr ?? "");
  const [cap, setCap] = useState(current ? fromWei(current.policy.dailyCap) : "20");
  const [draw, setDraw] = useState(current ? fromWei(current.policy.maxDrawPerTx) : "1");
  const [float, setFloat] = useState(current ? fromWei(current.policy.maxFloat) : "2");
  const [dur, setDur] = useState<Dur>(current ? "keep" : "30");
  const [date, setDate] = useState(isoDay(Number(nowSec()) + 30 * DAY));
  const [active, setActive] = useState(current?.policy.active ?? true);

  const parse = (s: string) => {
    try {
      return s.trim() === "" ? undefined : parseUnits(s.trim(), 18);
    } catch {
      return undefined;
    }
  };
  const p = { cap: parse(cap), draw: parse(draw), float: parse(float) };
  const now = Number(nowSec());
  const expiry: bigint | undefined =
    dur === "keep" ? current?.policy.expiry : dur === "never" ? 0n : dur === "custom" ? (date ? BigInt(Math.floor(Date.parse(date + "T23:59:59Z") / 1000)) : undefined) : BigInt(now + Number(dur) * DAY);

  let err = "";
  const a = addr.trim();
  if (!a) err = " "; // nothing typed yet: keep the button off without scolding
  else if (!isAddress(a)) err = "That isn't an address: 0x followed by 40 hex characters.";
  else if (/^0x0{40}$/.test(a)) err = "The zero address can't be an agent.";
  else if (!current && rows.some((r) => r.addr.toLowerCase() === a.toLowerCase())) err = "That agent is already added. Use Edit on its row.";
  else if (me && a.toLowerCase() === me.toLowerCase()) err = "That's your owner wallet. Give the agent a key of its own.";
  else if (p.cap === undefined || p.draw === undefined || p.float === undefined) err = "Limits must be numbers, with at most 18 decimals.";
  else if (p.cap === 0n || p.draw === 0n || p.float === 0n) err = "A zero limit means this agent can never draw.";
  else if (expiry === undefined) err = "Pick how long this agent can draw.";
  else if (expiry !== 0n && expiry <= BigInt(now)) err = "The end date has to be in the future.";
  const warn =
    !err && p.draw! > p.cap! ? "Per payment is above the daily limit, so the daily limit is what counts." : !err && p.draw! > p.float! ? "Per payment is above what it can hold, so no single draw can be that large." : "";

  const preset = PRESETS.find((x) => p.cap === parseUnits(x.cap, 18) && p.draw === parseUnits(x.draw, 18) && p.float === parseUnits(x.float, 18));
  const keepLabel = current ? (current.policy.expiry === 0n ? "Keep: no end date" : `Keep: until ${day(current.policy.expiry)}`) : "";

  async function save() {
    if (err) return;
    const policy: Policy = { dailyCap: p.cap!, maxDrawPerTx: p.draw!, maxFloat: p.float!, expiry: expiry!, active };
    const ok = await tx.run(current ? `Save limits for ${short(a)}` : `Add agent ${short(a)}`, { address: vault, abi: banqorVaultAbi, functionName: "setAgent", args: [a as Address, policy] });
    if (ok) onDone(a as Address);
  }

  return (
    <form
      className="form"
      id="ed"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <ol className="esteps">
        <li className="estep">
          <p className="estep-h">
            <span className="n">1</span>
            <label htmlFor="e-addr">Which agent?</label>
          </p>
          <div className={`inwrap${a && err && err.startsWith("That isn't") ? " bad" : ""}`}>
            <input id="e-addr" data-autofocus={!current || undefined} autoComplete="off" spellCheck={false} placeholder="Paste its address, 0x…" style={{ fontSize: 14 }} value={addr} readOnly={!!current} onChange={(e) => setAddr(e.target.value)} />
          </div>
          <span className="hint">The agent's own key, not your wallet. The SDK reads it from AGENT_KEY.</span>
        </li>
        <li className="estep">
          <p className="estep-h">
            <span className="n">2</span>How much can it spend?
          </p>
          <div className="chips" role="group" aria-label="Quick limits">
            {PRESETS.map((x) => (
              <button
                key={x.name}
                type="button"
                aria-pressed={preset === x}
                onClick={() => {
                  setCap(x.cap);
                  setDraw(x.draw);
                  setFloat(x.float);
                }}
              >
                {x.name}
                <small>{x.per}</small>
              </button>
            ))}
          </div>
          <div className="lim">
            <Lim id="e-cap" label="Per day" sub="resets every 24 hours" value={cap} set={setCap} autoFocus={!!current} />
            <Lim id="e-draw" label="Per payment" sub="largest single draw" value={draw} set={setDraw} />
            <Lim id="e-float" label="Holds at most" sub="in its wallet at once" value={float} set={setFloat} />
          </div>
        </li>
        <li className="estep">
          <p className="estep-h">
            <span className="n">3</span>For how long?
          </p>
          <div className="chips" role="group" aria-label="How long">
            {current && (
              <button type="button" aria-pressed={dur === "keep"} onClick={() => setDur("keep")}>
                {keepLabel}
              </button>
            )}
            {(["7", "30", "90"] as const).map((d) => (
              <button key={d} type="button" aria-pressed={dur === d} onClick={() => setDur(d)}>
                {d} days
              </button>
            ))}
            <button type="button" aria-pressed={dur === "never"} onClick={() => setDur("never")}>
              No end date
            </button>
            <button type="button" aria-pressed={dur === "custom"} onClick={() => setDur("custom")}>
              Pick a date
            </button>
          </div>
          {dur === "custom" && (
            <div className="inwrap">
              <input type="date" aria-label="End date" min={isoDay(now + DAY)} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}
        </li>
      </ol>
      <label className="switch">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span className="sw" aria-hidden="true" />
        Allowed to draw now
      </label>
      {p.cap !== undefined && p.draw !== undefined && p.float !== undefined && (
        <p className="sum">
          {active ? "This agent can" : "Once re-enabled, this agent could"} spend up to <b>{amt(p.cap)} MUSD a day</b>, at most <b>{amt(p.draw)} per draw</b>, and hold up to <b>{amt(p.float)} at once</b>,{" "}
          {expiry === undefined ? "…" : expiry === 0n ? <b>with no end date</b> : <>until <b>{day(expiry)}</b></>}. {current ? "Its current 24h window is kept." : ""}
        </p>
      )}
      <p className={`note${err.trim() ? " err" : ""}`} aria-live="polite">
        {err.trim() || warn}
      </p>
      <div className="formacts">
        <button className="btn btn-orange" type="submit" disabled={!!err || tx.busy}>
          {current ? "Save limits" : "Add agent"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {current && (
        <p className="mute" style={{ fontSize: 12.5, margin: 0 }}>
          <a href={explorer.address(current.addr)} target="_blank" rel="noreferrer">
            {current.addr} ↗
          </a>
        </p>
      )}
    </form>
  );
}

function Lim({ id, label, sub, value, set, autoFocus }: { id: string; label: string; sub: string; value: string; set: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="lim-row" htmlFor={id}>
      <span>
        {label}
        <small>{sub}</small>
      </span>
      <span className="inwrap">
        <input id={id} data-autofocus={autoFocus || undefined} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => set(e.target.value)} />
        <span className="unit">MUSD</span>
      </span>
    </label>
  );
}
