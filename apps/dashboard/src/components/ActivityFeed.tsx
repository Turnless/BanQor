import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { formatUnits, type Address } from "viem";
import { getVaultActivity, type VaultActivity } from "@banqor/sdk";
import { deployment, explorer, settings } from "../config";
import { onMezo, short } from "../lib";

const money = (v: unknown) => (typeof v === "bigint" ? Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "");

function describe(e: VaultActivity): string {
  const a = e.args;
  switch (e.eventName) {
    case "Drawn":
      return `Agent ${short(a.agent as string)} drew ${money(a.amount)} MUSD${a.borrowed ? ` (borrowed ${money(a.borrowed)} from the trove)` : ""}`;
    case "Borrowed":
      return `Borrowed ${money(a.amount)} MUSD against BTC`;
    case "Repaid":
      return `Repaid ${money(a.amount)} MUSD`;
    case "LineOpened":
      return `Line opened: ${money(a.coll)} BTC, ${money(a.debt)} MUSD debt`;
    case "LineClosed":
      return `Line closed, ${money(a.collReturned)} BTC returned`;
    case "AgentSet":
      return `Policy set for ${short(a.agent as string)}`;
    case "AgentRevoked":
      return `Agent ${short(a.agent as string)} revoked`;
    case "CollateralAdded":
      return `Added ${money(a.amount)} BTC`;
    case "CollateralWithdrawn":
      return `Withdrew ${money(a.amount)} BTC`;
    case "CollateralClaimed":
      return `Claimed ${money(a.amount)} BTC of collateral surplus`;
    case "Swept":
      return `Swept ${money(a.amount)} MUSD to ${short(a.to as string)}`;
    case "VaultPaused":
      return "Paused all agents";
    case "VaultUnpaused":
      return "Unpaused agents";
    case "Rebalanced":
      return `Rebalanced: repaid ${money(a.repaid)} MUSD`;
    case "IcrFloorSet":
      return `ICR floor set to ${Number(a.bps) / 100}%`;
    case "BorrowBufferSet":
      return `Borrow buffer set to ${money(a.amount)} MUSD`;
  }
}

/** Recent vault events from contract logs, with explorer links (FR-UI6). */
export function ActivityFeed({ vault }: { vault: Address }) {
  const client = usePublicClient(onMezo);
  // the full lookback is scanned once; later polls only fetch blocks after the last one scanned
  const seen = useRef<{ vault: Address; toBlock: bigint; events: VaultActivity[] } | undefined>(undefined);
  const q = useQuery({
    queryKey: ["activity", vault],
    enabled: !!client,
    refetchInterval: settings.pollMs * 3,
    queryFn: async () => {
      const head = await client!.getBlockNumber();
      const prev = seen.current?.vault === vault ? seen.current : undefined;
      if (prev && prev.toBlock >= head) return prev.events;
      const deployed = deployment.banqor.factoryDeployBlock;
      const floor = head > settings.activityLookback ? head - settings.activityLookback : 0n;
      const start = deployed !== null && BigInt(deployed) > floor ? BigInt(deployed) : floor;
      const fromBlock = prev ? prev.toBlock + 1n : start;
      const fresh = await getVaultActivity(client!, { vault, fromBlock, toBlock: head, maxRange: settings.logsMaxRange, limit: settings.activityLimit });
      const events = [...fresh, ...(prev?.events ?? [])].slice(0, settings.activityLimit);
      seen.current = { vault, toBlock: head, events };
      return events;
    },
  });

  return (
    <section aria-label="activity">
      <h2>Activity</h2>
      {q.isLoading && <p>Loading activity…</p>}
      {q.error && (
        <p role="alert">
          Could not load activity ({(q.error as Error).message}).{" "}
          <a href={explorer.address(vault)} target="_blank" rel="noreferrer">
            See the vault on the explorer
          </a>
        </p>
      )}
      {q.data && q.data.length === 0 && <p>No activity yet.</p>}
      <ol>
        {q.data?.map((e) => (
          <li key={`${e.transactionHash}-${e.logIndex}`}>
            {describe(e)}{" "}
            <a href={explorer.tx(e.transactionHash)} target="_blank" rel="noreferrer">
              block {e.blockNumber.toString()}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
