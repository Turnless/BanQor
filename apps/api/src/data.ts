import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Sourced<T> {
  data: T;
  source: "live" | "cache" | "fallback";
  fetchedAt: string;
}

export interface PriceData {
  usd: number;
  change24hPct: number | null;
}
export interface FundingData {
  /** mean funding rate (in %) across BTC perpetuals */
  meanRatePct: number;
  markets: number;
  top: { market: string; ratePct: number }[];
}
export interface SentimentData {
  value: number;
  label: string;
}

type Fetch = typeof globalThis.fetch;

const here = dirname(fileURLToPath(import.meta.url));
const fallback = JSON.parse(readFileSync(resolve(here, "../fallback.json"), "utf8")) as {
  price: PriceData;
  funding: FundingData;
  sentiment: SentimentData;
  capturedAt: string;
};

// ---- parsers for the default sources (CoinGecko, alternative.me) ----

export function parsePrice(j: unknown): PriceData {
  const b = (j as { bitcoin?: { usd?: number; usd_24h_change?: number } }).bitcoin;
  if (typeof b?.usd !== "number") throw new Error("unexpected price payload");
  return { usd: b.usd, change24hPct: typeof b.usd_24h_change === "number" ? b.usd_24h_change : null };
}

export function parseFunding(j: unknown): FundingData {
  if (!Array.isArray(j)) throw new Error("unexpected funding payload");
  const rows = (j as { market?: string; index_id?: string; contract_type?: string; funding_rate?: number }[])
    .filter((r) => r.index_id === "BTC" && r.contract_type === "perpetual" && typeof r.funding_rate === "number")
    .map((r) => ({ market: r.market ?? "unknown", ratePct: r.funding_rate as number }));
  if (rows.length === 0) throw new Error("no BTC perpetuals in funding payload");
  const mean = rows.reduce((s, r) => s + r.ratePct, 0) / rows.length;
  const top = [...rows].sort((a, b) => Math.abs(b.ratePct) - Math.abs(a.ratePct)).slice(0, 5);
  return { meanRatePct: mean, markets: rows.length, top };
}

export function parseSentiment(j: unknown): SentimentData {
  const d = (j as { data?: { value?: string; value_classification?: string }[] }).data?.[0];
  if (!d?.value) throw new Error("unexpected sentiment payload");
  return { value: Number(d.value), label: d.value_classification ?? "" };
}

/** A cached reader that serves the last good value, then the bundled fallback, so the demo never breaks. */
export function cachedSource<T>(
  url: string,
  parse: (j: unknown) => T,
  fallbackValue: T,
  ttlSeconds: number,
  fetchImpl: Fetch = globalThis.fetch,
  timeoutMs = 8000,
): () => Promise<Sourced<T>> {
  let last: { value: T; at: number } | undefined;
  let inflight: Promise<Sourced<T>> | undefined;

  async function refresh(): Promise<Sourced<T>> {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = parse(await res.json());
      last = { value, at: Date.now() };
      return { data: value, source: "live", fetchedAt: new Date(last.at).toISOString() };
    } catch {
      if (last) return { data: last.value, source: "cache", fetchedAt: new Date(last.at).toISOString() };
      return { data: fallbackValue, source: "fallback", fetchedAt: fallback.capturedAt };
    }
  }

  return async () => {
    if (last && Date.now() - last.at < ttlSeconds * 1000) {
      return { data: last.value, source: "cache", fetchedAt: new Date(last.at).toISOString() };
    }
    inflight ??= refresh().finally(() => (inflight = undefined));
    return inflight;
  };
}

export function createDataSources(
  sources: { price: string; funding: string; sentiment: string },
  ttlSeconds: number,
  fundingTtlSeconds: number,
  fetchImpl?: Fetch,
) {
  return {
    price: cachedSource(sources.price, parsePrice, fallback.price, ttlSeconds, fetchImpl),
    funding: cachedSource(sources.funding, parseFunding, fallback.funding, fundingTtlSeconds, fetchImpl, 30_000),
    sentiment: cachedSource(sources.sentiment, parseSentiment, fallback.sentiment, ttlSeconds, fetchImpl),
  };
}

export type DataSources = ReturnType<typeof createDataSources>;
