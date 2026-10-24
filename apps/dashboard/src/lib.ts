import { useReadContract } from "wagmi";
import { formatUnits, maxUint256, type Address } from "viem";
import { banqorVaultAbi } from "@banqor/sdk";
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

/** 18-decimal amount as a plain number, for display and percentages only (never for amounts sent on-chain). */
export const toNum = (v: bigint) => Number(formatUnits(v, 18));
/** Fixed decimals: amounts in tables and previews. */
export const num = (v: bigint | number, digits = 2) =>
  (typeof v === "bigint" ? toNum(v) : v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** Whole dollars: prices. */
export const usd = (v: bigint | number) => "$" + Math.round(typeof v === "bigint" ? toNum(v) : v).toLocaleString("en-US");
/** Compact amount: drops decimals on whole numbers ("20", "0.01", "2.5"). */
export const amt = (v: bigint | number) => {
  const n = typeof v === "bigint" ? toNum(v) : v;
  return n.toLocaleString("en-US", { maximumFractionDigits: n > 0 && n < 1 ? 4 : 2 });
};
/** ICR in basis points → "279.8%". */
export const ratio = (bps: bigint) => (bps === maxUint256 ? "∞" : `${(Number(bps) / 100).toFixed(1)}%`);
export const day = (unix: bigint | number) =>
  new Date(Number(unix) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Every read is pinned to Mezo, so read-only views work whatever network the wallet is on. */
export const onMezo = { chainId: chain.id } as const;

/** lineStatus() polled every settings.pollMs (ARCHITECTURE §7). */
export function useLineStatus(vault: Address | undefined) {
  return useReadContract({
    ...onMezo,
    address: vault,
    abi: banqorVaultAbi,
    functionName: "lineStatus",
    query: { enabled: !!vault, refetchInterval: settings.pollMs },
  });
}
