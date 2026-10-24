import { defineChain, type Address, type Chain } from "viem";

/** Shape of deployments/<chainId>.json, the single source of addresses (NFR-7). */
export interface Deployment {
  chainId: number;
  rpc: string;
  explorer: string;
  /** Blockscout API used by `forge --verify` */
  verifier?: string;
  network: `eip155:${number}`;
  facilitator: string;
  mezo: {
    musd: Address;
    borrowerOperations: Address;
    troveManager: Address;
    hintHelpers: Address;
    sortedTroves: Address;
    priceFeed: Address;
  };
  banqor: {
    factory: Address | null;
    factoryDeployBlock: number | null;
    demoVault: Address | null;
  };
}

/** Parses a CAIP-2 EVM network id ("eip155:31611") into a chain id. */
export function chainIdFromNetwork(network: string): number {
  const m = /^eip155:(\d+)$/.exec(network);
  if (!m) throw new Error(`Unsupported network "${network}", expected eip155:<chainId>`);
  return Number(m[1]);
}

/** Builds a viem chain from a deployment file. Mezo uses BTC (18 decimals) as its gas asset. */
export function chainFromDeployment(d: Pick<Deployment, "chainId" | "rpc" | "explorer">, name = `Mezo ${d.chainId}`): Chain {
  return defineChain({
    id: d.chainId,
    name,
    nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
    rpcUrls: { default: { http: [d.rpc] } },
    blockExplorers: { default: { name: "Mezo Explorer", url: d.explorer } },
  });
}

/** Minimal chain when only an RPC URL and network id are known. */
export function chainFromRpc(rpcUrl: string, network: string): Chain {
  const id = chainIdFromNetwork(network);
  return defineChain({
    id,
    name: `Mezo ${id}`,
    nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}
