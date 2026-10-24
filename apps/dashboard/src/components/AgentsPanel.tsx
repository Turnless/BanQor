import { useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import { banqorVaultAbi } from "@banqor/sdk";
import { explorer, settings } from "../config";
import { fmt, onMezo, short, useTx } from "../lib";
import { TxStatus } from "./TxStatus";

const ratio = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 1000n) / b) / 1000);

/** Agents table with spend-vs-cap and float-vs-max bars, add/edit and revoke (FR-UI4). */
export function AgentsPanel({ vault, isOwner }: { vault: Address; isOwner: boolean }) {
  const { data: list } = useReadContract({
    ...onMezo,
    address: vault,
    abi: banqorVaultAbi,
    functionName: "agentList",
    query: { refetchInterval: settings.pollMs },
  });
  const { data: statuses } = useReadContracts({
    contracts: (list ?? []).map((a) => ({ ...onMezo, address: vault, abi: banqorVaultAbi, functionName: "agentStatus", args: [a] }) as const),
    query: { enabled: !!list?.length, refetchInterval: settings.pollMs },
  });
  const [editing, setEditing] = useState<Address | "new" | undefined>();
  const tx = useTx();
  const now = BigInt(Math.floor(Date.now() / 1000));

  return (
    <section aria-label="agents">
      <h2>Agents</h2>
      {!list?.length && <p>No agents yet.</p>}
      {!!list?.length && (
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Spent today / cap</th>
              <th>Float / max</th>
              <th>Max draw</th>
              <th>Expiry</th>
              <th>Status</th>
              {isOwner && <th />}
            </tr>
          </thead>
          <tbody>
            {list.map((a, i) => {
              const st = statuses?.[i]?.result;
              if (!st) return (
                <tr key={a}>
                  <td colSpan={isOwner ? 7 : 6}>{short(a)} loading…</td>
                </tr>
              );
              const p = st.policy;
              const expired = p.expiry !== 0n && p.expiry <= now;
              const status = !p.active ? "revoked" : expired ? "expired" : "active";
              return (
                <tr key={a}>
                  <td>
                    <a href={explorer.address(a)} target="_blank" rel="noreferrer">
                      {short(a)}
                    </a>
                  </td>
                  <td>
                    <progress max={1} value={ratio(st.spentInWindow, p.dailyCap)} /> {fmt(st.spentInWindow)} / {fmt(p.dailyCap)}
                  </td>
                  <td>
                    <progress max={1} value={ratio(st.agentBalance, p.maxFloat)} /> {fmt(st.agentBalance)} / {fmt(p.maxFloat)}
                  </td>
                  <td>{fmt(p.maxDrawPerTx)}</td>
                  <td>{p.expiry === 0n ? "never" : new Date(Number(p.expiry) * 1000).toLocaleString()}</td>
                  <td>{status}</td>
                  {isOwner && (
                    <td>
                      <button onClick={() => setEditing(a)}>Edit</button>
                      {p.active && (
                        <button
                          onClick={() => tx.run("Revoke agent", { address: vault, abi: banqorVaultAbi, functionName: "revokeAgent", args: [a] })}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {isOwner && <button onClick={() => setEditing("new")}>Add agent</button>}
      <TxStatus state={tx.state} />
      {editing && (
        <PolicyEditor
          vault={vault}
          agent={editing === "new" ? undefined : editing}
          current={editing === "new" ? undefined : statuses?.[list!.indexOf(editing)]?.result?.policy}
          onClose={() => setEditing(undefined)}
        />
      )}
    </section>
  );
}

interface PolicyIn {
  dailyCap: bigint;
  maxFloat: bigint;
  maxDrawPerTx: bigint;
  expiry: bigint;
  active: boolean;
}

function PolicyEditor({ vault, agent, current, onClose }: { vault: Address; agent?: Address; current?: PolicyIn; onClose: () => void }) {
  const tx = useTx();
  const toStr = (v?: bigint) => (v === undefined ? "" : formatUnits(v, 18));
  const [addr, setAddr] = useState<string>(agent ?? "");
  const [cap, setCap] = useState(toStr(current?.dailyCap));
  const [float, setFloat] = useState(toStr(current?.maxFloat));
  const [draw, setDraw] = useState(toStr(current?.maxDrawPerTx));
  // empty = keep the current expiry when editing (or "never" for a new agent); "0" = never
  const [days, setDays] = useState("");
  // editing keeps the agent's current state; a revoked agent is only re-enabled by ticking this
  const [active, setActive] = useState(current?.active ?? true);
  const [error, setError] = useState<string>();

  async function save() {
    setError(undefined);
    try {
      if (!isAddress(addr)) throw new Error("agent address is not valid");
      if (days !== "" && !(Number(days) >= 0)) throw new Error("expiry must be a number of days");
      const d = Number(days);
      const expiry = days === "" ? (current?.expiry ?? 0n) : d > 0 ? BigInt(Math.floor(Date.now() / 1000) + d * 86400) : 0n;
      const policy = {
        dailyCap: parseUnits(cap, 18),
        maxFloat: parseUnits(float, 18),
        maxDrawPerTx: parseUnits(draw, 18),
        expiry,
        active,
      };
      if (await tx.run(agent ? "Update agent" : "Add agent", { address: vault, abi: banqorVaultAbi, functionName: "setAgent", args: [addr, policy] }))
        onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <dialog open aria-label="agent policy">
      <h3>{agent ? "Edit agent" : "Add agent"}</h3>
      <label>
        Agent address <input value={addr} onChange={(e) => setAddr(e.target.value)} disabled={!!agent} placeholder="0x…" />
      </label>
      <label>
        Daily cap (MUSD) <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
      </label>
      <label>
        Max float (MUSD) <input inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} />
      </label>
      <label>
        Max single draw (MUSD) <input inputMode="decimal" value={draw} onChange={(e) => setDraw(e.target.value)} />
      </label>
      <label>
        Expires in (days; 0 = never; empty = {current ? "keep current" : "never"}){" "}
        <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (can draw)
      </label>
      {current && (
        <p>Current expiry: {current.expiry === 0n ? "never" : new Date(Number(current.expiry) * 1000).toLocaleString()}</p>
      )}
      {error && <p role="alert">{error}</p>}
      <button onClick={save} disabled={tx.state.status === "pending"}>
        Save
      </button>
      <button onClick={onClose}>Cancel</button>
      <TxStatus state={tx.state} />
    </dialog>
  );
}
