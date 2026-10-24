import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { isAddress, zeroAddress, type Address } from "viem";
import { banqorFactoryAbi, banqorVaultAbi } from "@banqor/sdk";
import { chain, deployment, explorer } from "./config";
import { onMezo, useLineStatus } from "./lib";
import { Connect } from "./components/Connect";
import { CreateVault, OpenLine } from "./components/CreateLine";
import { LinePanel } from "./components/LinePanel";
import { AgentsPanel } from "./components/AgentsPanel";
import { KillSwitch } from "./components/KillSwitch";
import { ActivityFeed } from "./components/ActivityFeed";

function vaultFromUrl(): Address | undefined {
  const v = new URLSearchParams(window.location.search).get("vault");
  return v && isAddress(v) ? v : undefined;
}

export function App() {
  const readOnlyVault = vaultFromUrl();
  return (
    <main>
      <header>
        <h1>BanQor</h1>
        <p>A credit line for AI agents, backed by your Bitcoin on Mezo. Testnet, unaudited.</p>
        <Connect />
      </header>
      {readOnlyVault ? <VaultView vault={readOnlyVault} /> : <OwnerHome />}
      <ReadOnlyLookup />
      <footer>
        <small>
          {chain.name} · factory{" "}
          {deployment.banqor.factory ? (
            <a href={explorer.address(deployment.banqor.factory)} target="_blank" rel="noreferrer">
              {deployment.banqor.factory}
            </a>
          ) : (
            "not deployed"
          )}
        </small>
      </footer>
    </main>
  );
}

function OwnerHome() {
  const { address, isConnected, chainId } = useAccount();
  const factory = deployment.banqor.factory;
  const { data: vault, isLoading } = useReadContract({
    ...onMezo,
    address: factory ?? undefined,
    abi: banqorFactoryAbi,
    functionName: "vaultOf",
    args: address ? [address] : undefined,
    query: { enabled: !!factory && !!address },
  });

  if (!factory) return <p role="alert">No BanQor factory in deployments/{deployment.chainId}.json yet.</p>;
  if (!isConnected) return <p>Connect a wallet to manage your line, or open a vault read-only below.</p>;
  if (chainId !== chain.id) return null;
  if (isLoading || vault === undefined) return <p>Looking up your vault…</p>;
  if (vault === zeroAddress) return <NoVaultYet factory={factory} />;
  return <VaultView vault={vault} />;
}

/** The full owner screen; read-only when the connected wallet isn't the vault owner (FR-UI7). */
function VaultView({ vault }: { vault: Address }) {
  const { address } = useAccount();
  const { data: owner } = useReadContract({ ...onMezo, address: vault, abi: banqorVaultAbi, functionName: "owner" });
  const { data: rebalanceBufferBps } = useReadContract({ ...onMezo, address: vault, abi: banqorVaultAbi, functionName: "rebalanceBufferBps" });
  const { data: line } = useLineStatus(vault);
  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase();

  return (
    <>
      <p>
        Vault{" "}
        <a href={explorer.address(vault)} target="_blank" rel="noreferrer">
          {vault}
        </a>
        {!isOwner && " (read-only)"}
      </p>
      {isOwner && line && !line.lineOpen && <OpenLine vault={vault} icrFloorBps={line.icrFloorBps} />}
      <KillSwitch vault={vault} isOwner={isOwner} />
      <LinePanel vault={vault} isOwner={isOwner} rebalanceBufferBps={rebalanceBufferBps ?? 0} />
      <AgentsPanel vault={vault} isOwner={isOwner} />
      <ActivityFeed vault={vault} />
    </>
  );
}

/** FR-UI2: no vault yet — create it, and size the line with a live preview on the same screen. */
function NoVaultYet({ factory }: { factory: Address }) {
  const { data: defaults } = useReadContract({ ...onMezo, address: factory, abi: banqorFactoryAbi, functionName: "defaults" });
  return (
    <>
      <CreateVault factory={factory} />
      {defaults && <OpenLine icrFloorBps={defaults.icrFloorBps} />}
    </>
  );
}

function ReadOnlyLookup() {
  const [v, setV] = useState("");
  return (
    <form
      aria-label="view a vault"
      onSubmit={(e) => {
        e.preventDefault();
        if (isAddress(v)) window.location.search = `?vault=${v}`;
      }}
    >
      <label>
        View any vault <input value={v} onChange={(e) => setV(e.target.value)} placeholder="0x… vault address" />
      </label>
      <button type="submit" disabled={!isAddress(v)}>
        View
      </button>
    </form>
  );
}
