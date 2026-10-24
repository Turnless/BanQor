import type { Address } from "viem";
import { banqorVaultAbi } from "@banqor/sdk";
import { useLineStatus, useTx } from "../lib";
import { TxStatus } from "./TxStatus";

/** Pause / unpause every agent draw (FR-UI5). */
export function KillSwitch({ vault, isOwner }: { vault: Address; isOwner: boolean }) {
  const { data: s } = useLineStatus(vault);
  const tx = useTx();
  if (!s) return null;
  const fn = s.paused ? "unpause" : "pause";
  return (
    <section aria-label="kill switch">
      <p>
        Agent draws are <strong>{s.paused ? "PAUSED" : "live"}</strong>.
      </p>
      {isOwner && (
        <button onClick={() => tx.run(s.paused ? "Unpause" : "Pause", { address: vault, abi: banqorVaultAbi, functionName: fn })} disabled={tx.state.status === "pending"}>
          {s.paused ? "Unpause agents" : "Pause all agents"}
        </button>
      )}
      <TxStatus state={tx.state} />
    </section>
  );
}
