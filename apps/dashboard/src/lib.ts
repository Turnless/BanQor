import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { formatUnits, maxUint256, type Address, type Hash } from "viem";
import { banqorVaultAbi, toBanQorError } from "@banqor/sdk";
import { chain, settings } from "./config";

// MUSD and BTC both use 18 decimals on Mezo
export const fmt = (v: bigint | undefined, decimals = 18, digits = 4) =>
  v === undefined ? "–" : Number(formatUnits(v, decimals)).toLocaleString(undefined, { maximumFractionDigits: digits });

export const pct = (bps: bigint | number | undefined) => {
  if (bps === undefined) return "–";
  if (typeof bps === "bigint" && bps === maxUint256) return "∞";
  return `${(Number(bps) / 100).toFixed(2)}%`;
};

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** Every read is pinned to Mezo, so read-only views work whatever network the wallet is on. */
export const onMezo = { chainId: chain.id } as const;

/** lineStatus() polled every settings.pollMs (ARCHITECTURE §7). */
export function useLineStatus(vault: Address) {
  return useReadContract({
    ...onMezo,
    address: vault,
    abi: banqorVaultAbi,
    functionName: "lineStatus",
    query: { refetchInterval: settings.pollMs },
  });
}

export type TxState =
  | { status: "idle" }
  | { status: "pending"; label: string; hash?: Hash }
  | { status: "confirmed"; label: string; hash: Hash }
  | { status: "failed"; label: string; hash?: Hash; error: string };

type WriteArgs = Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0];
// payable vault functions (openLine, addCollateral) take `value`; the generic wagmi type can't express that here
type TxArgs = Omit<WriteArgs, "value" | "chainId"> & { value?: bigint };

/**
 * Sends a contract write and tracks pending / confirmed / failed (NFR-5). `args` may be a function, so
 * preparation (input checks, hint reads) fails into the same visible "failed" state. Refreshes reads on success.
 */
export function useTx() {
  const [state, setState] = useState<TxState>({ status: "idle" });
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient(onMezo);
  const qc = useQueryClient();

  async function run(label: string, args: TxArgs | (() => Promise<TxArgs>)) {
    setState({ status: "pending", label });
    let hash: Hash | undefined;
    try {
      if (!client) throw new Error("no RPC client for Mezo");
      const resolved = typeof args === "function" ? await args() : args;
      hash = await writeContractAsync({ ...resolved, chainId: chain.id } as WriteArgs);
      setState({ status: "pending", label, hash });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setState({ status: "confirmed", label, hash });
      await qc.invalidateQueries();
      return true;
    } catch (e) {
      const err = toBanQorError(e);
      setState({ status: "failed", label, hash, error: err.code === "Unknown" ? err.message : `${err.code}: ${err.message}` });
      return false;
    }
  }

  return { state, run, reset: () => setState({ status: "idle" }) };
}
