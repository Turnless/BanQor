import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { zeroAddress, type Address } from "viem";
import { banqorFactoryAbi, banqorVaultAbi, borrowerOperationsAbi } from "@banqor/sdk";
import { chain, deployment, settings } from "./config";
import { onMezo } from "./lib";
import { useRoute } from "./route";

/**
 * Which vault the page shows: `?vault=` when given (read-only unless you own it), otherwise the connected
 * wallet's vault from the factory. `isOwner` gates every write (FR-UI7).
 */
export function useVault() {
  const { address, isConnected, chainId } = useAccount();
  const { vaultParam } = useRoute();
  const factory = deployment.banqor.factory;
  const vaultOf = useReadContract({
    ...onMezo,
    address: factory ?? undefined,
    abi: banqorFactoryAbi,
    functionName: "vaultOf",
    args: address ? [address] : undefined,
    query: { enabled: !!factory && !!address },
  });
  const own = vaultOf.data && vaultOf.data !== zeroAddress ? vaultOf.data : undefined;
  const vault = vaultParam ?? own;
  const owner = useReadContract({ ...onMezo, address: vault, abi: banqorVaultAbi, functionName: "owner", query: { enabled: !!vault } });
  const isOwner = !!address && !!owner.data && address.toLowerCase() === owner.data.toLowerCase();
  return {
    address,
    isConnected,
    wrongChain: isConnected && chainId !== chain.id,
    factory,
    vault,
    vaultParam,
    ownVault: own,
    isOwner,
    /** connected, factory says this wallet has no vault yet */
    noVault: isConnected && vaultOf.data === zeroAddress,
    loading: isConnected && !!factory && vaultOf.isLoading,
  };
}

export type Policy = { dailyCap: bigint; maxFloat: bigint; maxDrawPerTx: bigint; expiry: bigint; active: boolean };
export type AgentRow = {
  addr: Address;
  policy: Policy;
  spentInWindow: bigint;
  windowResetsAt: bigint;
  agentBalance: bigint;
  drawableNow: bigint;
};

/** agentList() + agentStatus() for each, polled like the line (FR-UI4). */
export function useAgents(vault: Address | undefined) {
  const list = useReadContract({
    ...onMezo,
    address: vault,
    abi: banqorVaultAbi,
    functionName: "agentList",
    query: { enabled: !!vault, refetchInterval: settings.pollMs },
  });
  const statuses = useReadContracts({
    contracts: (list.data ?? []).map((a) => ({ ...onMezo, address: vault!, abi: banqorVaultAbi, functionName: "agentStatus", args: [a] }) as const),
    query: { enabled: !!vault && !!list.data?.length, refetchInterval: settings.pollMs },
  });
  const rows: AgentRow[] = [];
  (list.data ?? []).forEach((addr, i) => {
    const st = statuses.data?.[i]?.result;
    if (st) rows.push({ addr, policy: st.policy, spentInWindow: st.spentInWindow, windowResetsAt: st.windowResetsAt, agentBalance: st.agentBalance, drawableNow: st.drawableNow });
  });
  return { rows, loading: list.isLoading || (!!list.data?.length && statuses.isLoading), count: list.data?.length ?? 0, error: list.error ?? statuses.error };
}

export const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
export const isExpired = (p: Policy) => p.expiry !== 0n && p.expiry <= nowSec();
export function agentStatus(p: Policy, paused: boolean | undefined): ["on" | "off" | "warn", string] {
  if (!p.active) return ["off", "Revoked"];
  if (isExpired(p)) return ["off", "Expired"];
  if (paused) return ["warn", "Paused"];
  return ["on", "Active"];
}

/** Mezo's minimum debt rules, needed to know how much the vault may repay. */
export function useMezoParams() {
  const bo = { ...onMezo, address: deployment.mezo.borrowerOperations, abi: borrowerOperationsAbi } as const;
  const r = useReadContracts({
    contracts: [
      { ...bo, functionName: "MUSD_GAS_COMPENSATION" },
      { ...bo, functionName: "minNetDebt" },
    ],
  });
  return { gasComp: r.data?.[0]?.result, minNetDebt: r.data?.[1]?.result };
}
