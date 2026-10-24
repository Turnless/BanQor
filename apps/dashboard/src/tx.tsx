import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useWriteContract } from "wagmi";
import type { Hash } from "viem";
import { toBanQorError } from "@banqor/sdk";
import { chain, explorer } from "./config";
import { onMezo } from "./lib";

export type TxState =
  | { status: "idle" }
  | { status: "pending"; label: string; hash?: Hash }
  | { status: "confirmed"; label: string; hash: Hash }
  | { status: "failed"; label: string; hash?: Hash; error: string };

type WriteArgs = Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0];
// payable vault functions (openLine, addCollateral) take `value`; the generic wagmi type can't express that here
export type TxArgs = Omit<WriteArgs, "value" | "chainId"> & { value?: bigint };

const Ctx = createContext<{ state: TxState; set: (s: TxState) => void } | null>(null);

/** One transaction at a time, shown in a single toast (NFR-5: pending / confirmed / failed). */
export function TxProvider({ children }: { children: ReactNode }) {
  const [state, set] = useState<TxState>({ status: "idle" });
  useEffect(() => {
    if (state.status !== "confirmed") return;
    const t = setTimeout(() => set({ status: "idle" }), 5000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <Ctx.Provider value={{ state, set }}>
      {children}
      <Toast state={state} onClose={() => set({ status: "idle" })} />
    </Ctx.Provider>
  );
}

/**
 * Sends a contract write and tracks it in the toast. `args` may be a function, so preparation (input checks,
 * hint reads) fails into the same visible "failed" state. Refreshes every read on success.
 */
export function useTx() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTx needs <TxProvider>");
  const { state, set } = ctx;
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient(onMezo);
  const qc = useQueryClient();

  async function run(label: string, args: TxArgs | (() => Promise<TxArgs>)) {
    if (state.status === "pending") return false;
    set({ status: "pending", label });
    let hash: Hash | undefined;
    try {
      if (!client) throw new Error("no RPC client for Mezo");
      const resolved = typeof args === "function" ? await args() : args;
      hash = await writeContractAsync({ ...resolved, chainId: chain.id } as WriteArgs);
      set({ status: "pending", label, hash });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      set({ status: "confirmed", label, hash });
      await qc.invalidateQueries();
      return true;
    } catch (e) {
      const err = toBanQorError(e);
      set({ status: "failed", label, hash, error: err.code === "Unknown" ? err.message : `${err.code}: ${err.message}` });
      return false;
    }
  }

  return { state, busy: state.status === "pending", run };
}

function Toast({ state, onClose }: { state: TxState; onClose: () => void }) {
  if (state.status === "idle") return null;
  const link = state.hash ? (
    <a href={explorer.tx(state.hash)} target="_blank" rel="noreferrer">
      View on explorer ↗
    </a>
  ) : null;
  return (
    <div className="toast" role="status" aria-live="polite" data-status={state.status}>
      {state.status === "pending" && <span className="spin" />}
      {state.status === "confirmed" && <span className="okmark">✓</span>}
      {state.status === "failed" && <span className="xmark">✕</span>}
      <span className="toast-body">
        <b>{state.label}</b>
        <br />
        {state.status === "pending" && (state.hash ? "Waiting for Mezo to confirm…" : "Confirm in your wallet…")}
        {state.status === "confirmed" && "Done."}
        {state.status === "failed" && state.error}
        {link && <> {link}</>}
      </span>
      {state.status !== "pending" && (
        <button className="toast-x" type="button" aria-label="Dismiss" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}
