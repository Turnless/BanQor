import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFromDeployment, type Deployment } from "@banqor/sdk";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");
loadEnv({ path: resolve(repoRoot, ".env") });

export const chainId = Number(process.env.CHAIN_ID ?? 31611);
export const deploymentPath = resolve(repoRoot, "deployments", `${chainId}.json`);

export function loadDeployment(): Deployment {
  return JSON.parse(readFileSync(deploymentPath, "utf8")) as Deployment;
}

/** Writes one field under "banqor" back to deployments/<chainId>.json. */
export function saveBanqor(key: keyof Deployment["banqor"], value: string | number | null) {
  const d = loadDeployment();
  (d.banqor as Record<string, unknown>)[key] = value;
  writeFileSync(deploymentPath, JSON.stringify(d, null, 2) + "\n");
}

/** Optional env value with a documented default. */
export function opt(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (copy .env.example to .env and fill it in)`);
  return v;
}

export function key(name: string): Hex {
  const v = need(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be a 0x-prefixed 32-byte hex private key`);
  return v as Hex;
}

export function address(name: string): Address {
  const v = need(name);
  if (!isAddress(v)) throw new Error(`${name} is not an address`);
  return v;
}

export function context() {
  const deployment = loadDeployment();
  const rpcUrl = process.env.MEZO_RPC || deployment.rpc;
  const chain = chainFromDeployment({ ...deployment, rpc: rpcUrl });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
  return { deployment, rpcUrl, chain, publicClient };
}

export function demoVault(deployment: Deployment): Address {
  const v = process.env.VAULT || deployment.banqor.demoVault;
  if (!v || !isAddress(v)) throw new Error("No vault: run `pnpm agent:setup` first (or set VAULT)");
  return v;
}

export const agentAccount = () => privateKeyToAccount(key("AGENT_KEY"));
export const ownerAccount = () => privateKeyToAccount(key("OWNER_KEY"));

export const explorerTx = (d: Deployment, hash: string) => `${d.explorer}/tx/${hash}`;
