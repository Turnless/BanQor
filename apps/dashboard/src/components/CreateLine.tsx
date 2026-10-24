import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseEther, parseUnits, type Address } from "viem";
import { banqorFactoryAbi, banqorVaultAbi, computeHints, previewOpenLine } from "@banqor/sdk";
import { deployment, settings } from "../config";
import { fmt, onMezo, pct, useTx } from "../lib";
import { TxStatus } from "./TxStatus";

export function CreateVault({ factory }: { factory: Address }) {
  const tx = useTx();
  return (
    <section aria-label="create vault">
      <h2>Create your vault</h2>
      <p>One vault per owner. It will own a Mezo trove in its own name.</p>
      <button
        onClick={() => tx.run("Create vault", { address: factory, abi: banqorFactoryAbi, functionName: "createVault" })}
        disabled={tx.state.status === "pending"}
      >
        Create vault
      </button>
      <TxStatus state={tx.state} />
    </section>
  );
}

/**
 * Open-line form with a live ICR / liquidation-price preview (FR-UI2). Without a vault it still previews
 * (using the factory's default floor) so the owner can size the line before creating the vault.
 */
export function OpenLine({ vault, icrFloorBps }: { vault?: Address; icrFloorBps: number }) {
  const client = usePublicClient(onMezo);
  const tx = useTx();
  const [btc, setBtc] = useState("");
  const [musd, setMusd] = useState("");

  const parsed = (() => {
    try {
      return btc && musd ? { coll: parseEther(btc), debt: parseUnits(musd, 18) } : undefined;
    } catch {
      return undefined;
    }
  })();

  const preview = useQuery({
    queryKey: ["preview", btc, musd],
    enabled: !!parsed && !!client,
    queryFn: () => previewOpenLine(client!, deployment.mezo, parsed!.coll, parsed!.debt, BigInt(icrFloorBps)),
  });
  const p = preview.data;
  const ok = !!p && p.meetsMinDebt && p.icrBps >= BigInt(icrFloorBps);

  const open = () =>
    tx.run("Open line", async () => {
      if (!vault || !parsed || !p) throw new Error("create the vault and enter collateral and debt first");
      const [upper, lower] = await computeHints(client!, deployment.mezo, parsed.coll, p.compositeDebt, settings.hintTrials);
      return { address: vault, abi: banqorVaultAbi, functionName: "openLine", args: [parsed.debt, upper, lower], value: parsed.coll };
    });

  return (
    <section aria-label="open line">
      <h2>Open a credit line</h2>
      <label>
        BTC collateral <input inputMode="decimal" value={btc} onChange={(e) => setBtc(e.target.value)} placeholder="0.07" />
      </label>
      <label>
        Initial MUSD debt <input inputMode="decimal" value={musd} onChange={(e) => setMusd(e.target.value)} placeholder="1800" />
      </label>
      {p && (
        <dl>
          <dt>ICR</dt>
          <dd>{pct(p.icrBps)} (floor {pct(icrFloorBps)})</dd>
          <dt>Liquidation price</dt>
          <dd>${fmt(p.liquidationPrice, 18, 2)}</dd>
          <dt>Draws stop below</dt>
          <dd>${fmt(p.floorPrice, 18, 2)}</dd>
          <dt>BTC price</dt>
          <dd>${fmt(p.price, 18, 2)}</dd>
          <dt>Borrowing fee + gas compensation</dt>
          <dd>
            {fmt(p.fee)} + {fmt(p.gasCompensation)} MUSD
          </dd>
          {!p.meetsMinDebt && <dd role="alert">Mezo needs at least {fmt(p.minNetDebt)} MUSD of debt.</dd>}
          {p.icrBps < BigInt(icrFloorBps) && <dd role="alert">ICR is below your floor: add BTC or borrow less.</dd>}
        </dl>
      )}
      {preview.error && <p role="alert">{(preview.error as Error).message}</p>}
      <button onClick={open} disabled={!vault || !ok || tx.state.status === "pending"}>
        Open line
      </button>
      {!vault && <p>Create your vault first; you can size the line now.</p>}
      <TxStatus state={tx.state} />
    </section>
  );
}
