import { useState } from "react";
import { usePublicClient } from "wagmi";
import { isAddress, parseEther, parseUnits, type Address } from "viem";
import { banqorVaultAbi, computeHints, lineMath, MEZO_MCR_BPS } from "@banqor/sdk";
import { deployment, settings } from "../config";
import { fmt, onMezo, pct, useLineStatus, useTx } from "../lib";
import { TxStatus } from "./TxStatus";

type Health = "ok" | "near-floor" | "below-floor" | "near-liquidation";

function health(icrBps: bigint, floorBps: number, bufferBps: number): Health {
  if (icrBps < MEZO_MCR_BPS + settings.liquidationWarnBps) return "near-liquidation";
  if (icrBps < BigInt(floorBps)) return "below-floor";
  if (icrBps < BigInt(floorBps + bufferBps)) return "near-floor";
  return "ok";
}

const HEALTH_TEXT: Record<Health, string> = {
  ok: "healthy",
  "near-floor": "close to the floor: draws may soon stop",
  "below-floor": "below the floor: agent draws are blocked",
  "near-liquidation": "close to Mezo's 110% liquidation line: add BTC or repay now",
};

/** Line panel (FR-UI3): collateral, debt, ICR vs floor and 110%, prices, vault float, owner actions. */
export function LinePanel({ vault, isOwner, rebalanceBufferBps }: { vault: Address; isOwner: boolean; rebalanceBufferBps: number }) {
  const { data: s, error } = useLineStatus(vault);
  if (error) return <p role="alert">Could not read the vault: {error.message}</p>;
  if (!s) return <p>Loading line…</p>;
  const m = lineMath(s.coll, s.debt, s.price, BigInt(s.icrFloorBps));
  const h = health(s.icrBps, s.icrFloorBps, rebalanceBufferBps);

  return (
    <section aria-label="credit line">
      <h2>Credit line</h2>
      {!s.lineOpen && <p>No open line.</p>}
      <dl>
        <dt>BTC collateral</dt>
        <dd>{fmt(s.coll, 18, 6)} BTC</dd>
        <dt>MUSD debt</dt>
        <dd>{fmt(s.debt)} MUSD</dd>
        <dt>ICR</dt>
        <dd data-health={h}>
          {pct(s.icrBps)}: {HEALTH_TEXT[h]} (floor {pct(s.icrFloorBps)}, liquidation {pct(MEZO_MCR_BPS)})
        </dd>
        <dt>BTC price</dt>
        <dd>${fmt(s.price, 18, 2)}</dd>
        <dt>Liquidation price</dt>
        <dd>${fmt(m.liquidationPrice, 18, 2)}</dd>
        <dt>Draws stop below</dt>
        <dd>${fmt(m.floorPrice, 18, 2)}</dd>
        <dt>Vault MUSD float</dt>
        <dd>{fmt(s.vaultFloat)} MUSD</dd>
      </dl>
      {isOwner && s.lineOpen && s.troveStatus === 1 && <LineActions vault={vault} coll={s.coll} debt={s.debt} />}
      {isOwner && s.troveStatus > 1 && <ClosedTroveActions vault={vault} lineOpen={s.lineOpen} troveStatus={s.troveStatus} />}
    </section>
  );
}

const CLOSED_BY: Record<number, string> = { 2: "you", 3: "liquidation", 4: "redemption" };

/** After Mezo closes the trove (liquidation / redemption), recover any surplus BTC and reset the line. */
function ClosedTroveActions({ vault, lineOpen, troveStatus }: { vault: Address; lineOpen: boolean; troveStatus: number }) {
  const tx = useTx();
  return (
    <fieldset disabled={tx.state.status === "pending"}>
      <legend>Trove closed by {CLOSED_BY[troveStatus] ?? "Mezo"}</legend>
      <button onClick={() => tx.run("Claim collateral", { address: vault, abi: banqorVaultAbi, functionName: "claimCollateral" })}>
        Claim surplus BTC
      </button>
      {lineOpen && (
        <button onClick={() => tx.run("Reset line", { address: vault, abi: banqorVaultAbi, functionName: "closeLine" })}>Reset line</button>
      )}
      <TxStatus state={tx.state} />
    </fieldset>
  );
}

function LineActions({ vault, coll, debt }: { vault: Address; coll: bigint; debt: bigint }) {
  const client = usePublicClient(onMezo);
  const tx = useTx();
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [floor, setFloor] = useState("");
  const busy = tx.state.status === "pending";

  const hints = (newColl: bigint, newDebt: bigint) => computeHints(client!, deployment.mezo, newColl, newDebt, settings.hintTrials);
  /** Parses the amount field; throws a readable error (shown as the tx's failed state). */
  const amountOf = (parse: (v: string) => bigint, max?: bigint, what = "amount") => {
    let v: bigint;
    try {
      v = parse(amount);
    } catch {
      throw new Error(`enter a valid ${what}`);
    }
    if (v <= 0n) throw new Error(`${what} must be greater than 0`);
    if (max !== undefined && v > max) throw new Error(`${what} is larger than the line holds`);
    return v;
  };

  const addColl = () =>
    tx.run("Add collateral", async () => {
      const v = amountOf(parseEther, undefined, "BTC amount");
      const [u, l] = await hints(coll + v, debt);
      return { address: vault, abi: banqorVaultAbi, functionName: "addCollateral", args: [u, l], value: v };
    });
  const withdrawColl = () =>
    tx.run("Withdraw collateral", async () => {
      const v = amountOf(parseEther, coll, "BTC amount");
      const [u, l] = await hints(coll - v, debt);
      return { address: vault, abi: banqorVaultAbi, functionName: "withdrawCollateral", args: [v, u, l] };
    });
  const repay = () =>
    tx.run("Repay", async () => {
      const v = amountOf((x) => parseUnits(x, 18), debt, "MUSD amount");
      const [u, l] = await hints(coll, debt - v);
      return { address: vault, abi: banqorVaultAbi, functionName: "repay", args: [v, u, l] };
    });
  const sweep = () =>
    tx.run("Sweep", async () => {
      const v = amountOf((x) => parseUnits(x, 18), undefined, "MUSD amount");
      if (!isAddress(to)) throw new Error("enter a valid destination address");
      return { address: vault, abi: banqorVaultAbi, functionName: "sweep", args: [to, v] };
    });
  const setIcrFloor = () =>
    tx.run("Set ICR floor", async () => {
      const p = Number(floor);
      if (!Number.isFinite(p) || p <= 0) throw new Error("enter the floor as a percentage, e.g. 200");
      return { address: vault, abi: banqorVaultAbi, functionName: "setIcrFloor", args: [Math.round(p * 100)] };
    });
  async function closeLine() {
    await tx.run("Close line", { address: vault, abi: banqorVaultAbi, functionName: "closeLine" });
  }

  return (
    <fieldset disabled={busy}>
      <legend>Manage line</legend>
      <label>
        Amount <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <button onClick={addColl}>Add BTC</button>
      <button onClick={withdrawColl}>Withdraw BTC</button>
      <button onClick={repay}>Repay MUSD</button>
      <label>
        Sweep to <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" />
      </label>
      <button onClick={sweep}>Sweep MUSD</button>
      <label>
        ICR floor % <input inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="200" />
      </label>
      <button onClick={setIcrFloor}>Set floor</button>
      <button onClick={closeLine}>Close line</button>
      <TxStatus state={tx.state} />
    </fieldset>
  );
}
