import { parseEventLogs, type Address, type PublicClient } from "viem";
import { banqorVaultAbi } from "./abi.js";

export type VaultEventName =
  | "LineOpened"
  | "LineClosed"
  | "AgentSet"
  | "AgentRevoked"
  | "Drawn"
  | "Borrowed"
  | "Repaid"
  | "CollateralAdded"
  | "CollateralWithdrawn"
  | "CollateralClaimed"
  | "Swept"
  | "VaultPaused"
  | "VaultUnpaused"
  | "Rebalanced"
  | "IcrFloorSet"
  | "BorrowBufferSet";

export interface VaultActivity {
  eventName: VaultEventName;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
}

export interface ActivityQuery {
  vault: Address;
  /** Stop scanning at this block (e.g. the factory deploy block). */
  fromBlock: bigint;
  toBlock?: bigint;
  /** Max blocks per eth_getLogs call; Mezo's public RPC allows 10,000. */
  maxRange: bigint;
  /** Stop once this many events are found (newest first). */
  limit: number;
}

/** Recent vault events, newest first, scanning backwards in RPC-sized chunks (FR-UI6). */
export async function getVaultActivity(client: PublicClient, q: ActivityQuery): Promise<VaultActivity[]> {
  const head = q.toBlock ?? (await client.getBlockNumber());
  const out: VaultActivity[] = [];
  let to = head;
  while (to >= q.fromBlock && out.length < q.limit) {
    const from = to - q.maxRange + 1n > q.fromBlock ? to - q.maxRange + 1n : q.fromBlock;
    const logs = await client.getLogs({ address: q.vault, fromBlock: from, toBlock: to });
    const parsed = parseEventLogs({ abi: banqorVaultAbi, logs, strict: false });
    for (const l of parsed.reverse()) {
      out.push({
        eventName: l.eventName as VaultEventName,
        args: (l.args ?? {}) as Record<string, unknown>,
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash,
        logIndex: l.logIndex,
      });
    }
    if (from === q.fromBlock) break;
    to = from - 1n;
  }
  return out.slice(0, q.limit);
}
