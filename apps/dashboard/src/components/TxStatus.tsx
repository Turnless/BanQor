import { explorer } from "../config";
import type { TxState } from "../lib";

export function TxStatus({ state }: { state: TxState }) {
  if (state.status === "idle") return null;
  const link = state.hash ? (
    <a href={explorer.tx(state.hash)} target="_blank" rel="noreferrer">
      view on explorer
    </a>
  ) : null;
  return (
    <p role="status" data-status={state.status}>
      {state.status === "pending" && <>⏳ {state.label}: {state.hash ? "waiting for confirmation" : "confirm in your wallet"} </>}
      {state.status === "confirmed" && <>✓ {state.label} confirmed </>}
      {state.status === "failed" && <>✗ {state.label} failed: {state.error} </>}
      {link}
    </p>
  );
}
