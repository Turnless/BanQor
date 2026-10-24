import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress, type Address } from "viem";
import type { Deployment } from "@banqor/sdk";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");

export function loadDeployment(chainId = Number(process.env.CHAIN_ID ?? 31611)): Deployment {
  return JSON.parse(readFileSync(resolve(repoRoot, "deployments", `${chainId}.json`), "utf8")) as Deployment;
}

export interface ApiConfig {
  port: number;
  network: `eip155:${number}`;
  facilitatorUrl: string;
  payTo: Address;
  prices: { price: string; funding: string; sentiment: string };
  sources: { price: string; funding: string; sentiment: string };
  cacheSeconds: number;
  /** The funding source is a large payload (~10 MB), so it refreshes less often. */
  fundingCacheSeconds: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see .env.example)`);
  return v;
}

function env(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/** Defaults for the public data sources; every one can be overridden from env. */
export const DEFAULT_SOURCES = {
  price: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
  funding: "https://api.coingecko.com/api/v3/derivatives?include_tickers=unexpired",
  sentiment: "https://api.alternative.me/fng/?limit=1",
};

export function loadApiConfig(d: Deployment = loadDeployment()): ApiConfig {
  const payTo = required("PAY_TO");
  if (!isAddress(payTo)) throw new Error(`PAY_TO is not an address: ${payTo}`);
  return {
    port: Number(env("API_PORT", "4021")),
    network: d.network,
    facilitatorUrl: env("FACILITATOR_URL", d.facilitator),
    payTo,
    prices: {
      price: required("API_PRICE_PATH_PRICE"),
      funding: required("API_PRICE_PATH_FUNDING"),
      sentiment: required("API_PRICE_PATH_SENTIMENT"),
    },
    sources: {
      price: env("DATA_PRICE_URL", DEFAULT_SOURCES.price),
      funding: env("DATA_FUNDING_URL", DEFAULT_SOURCES.funding),
      sentiment: env("DATA_SENTIMENT_URL", DEFAULT_SOURCES.sentiment),
    },
    cacheSeconds: Number(env("DATA_CACHE_SECONDS", "60")),
    fundingCacheSeconds: Number(env("DATA_FUNDING_CACHE_SECONDS", "300")),
  };
}
