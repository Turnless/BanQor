import { createConfig, http } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import { isAddress } from "viem";
import { chainFromDeployment, type Deployment } from "@banqor/sdk";

// All deployments/<chainId>.json files are bundled; VITE_CHAIN_ID picks one (NFR-7).
const files = import.meta.glob<Deployment>("../../../deployments/*.json", { eager: true, import: "default" });
const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? 31611);
const found = Object.entries(files).find(([path]) => path.endsWith(`/${chainId}.json`));
if (!found) throw new Error(`No deployments/${chainId}.json`);

export const deployment: Deployment = found[1];
export const rpcUrl: string = import.meta.env.VITE_MEZO_RPC || deployment.rpc;
export const chain = {
  ...chainFromDeployment({ ...deployment, rpc: rpcUrl }, chainId === 31611 ? "Mezo Testnet" : `Mezo ${chainId}`),
  testnet: chainId === 31611,
};

export const settings = {
  /** lineStatus polling interval (ARCHITECTURE §7: 10s) */
  pollMs: Number(import.meta.env.VITE_POLL_MS ?? 10_000),
  /** Mezo's public RPC caps eth_getLogs at 10,000 blocks */
  logsMaxRange: BigInt(import.meta.env.VITE_LOGS_MAX_RANGE ?? 10_000),
  /** how far back the activity feed scans when the factory block is unknown */
  activityLookback: BigInt(import.meta.env.VITE_ACTIVITY_LOOKBACK_BLOCKS ?? 50_000),
  activityLimit: Number(import.meta.env.VITE_ACTIVITY_LIMIT ?? 50),
  hintTrials: BigInt(import.meta.env.VITE_HINT_TRIALS ?? 15),
  /** warn when ICR is within this many bps of Mezo's 110% liquidation line */
  liquidationWarnBps: BigInt(import.meta.env.VITE_LIQUIDATION_WARN_BPS ?? 1000),
};

/**
 * Dev server only: VITE_DEV_ACCOUNT=0x… adds a "wallet" that is just that address, to look at the dashboard as
 * its owner. It holds no key, so it can read but every transaction it tries fails. Never part of a build.
 */
function devConnector() {
  const a = import.meta.env.VITE_DEV_ACCOUNT;
  return import.meta.env.DEV && a && isAddress(a) ? [mock({ accounts: [a] })] : [];
}

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [...devConnector(), injected()],
  transports: { [chain.id]: http(rpcUrl) },
});

export const explorer = {
  tx: (h: string) => `${deployment.explorer}/tx/${h}`,
  address: (a: string) => `${deployment.explorer}/address/${a}`,
};

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
