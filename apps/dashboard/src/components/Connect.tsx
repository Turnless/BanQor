import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "../config";
import { short } from "../lib";

/** Wallet connect + wrong-network guard (FR-UI1). */
export function Connect() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  if (!isConnected) {
    return (
      <section aria-label="wallet">
        {connectors.map((c) => (
          <button key={c.uid} onClick={() => connect({ connector: c, chainId: chain.id })} disabled={isPending}>
            Connect {c.name}
          </button>
        ))}
        {error && <p role="alert">{error.message}</p>}
      </section>
    );
  }
  return (
    <section aria-label="wallet">
      <span>{short(address)}</span> <button onClick={() => disconnect()}>Disconnect</button>
      {chainId !== chain.id && (
        <p role="alert">
          Wrong network. <button onClick={() => switchChain({ chainId: chain.id })} disabled={switching}>Switch to {chain.name}</button>
        </p>
      )}
    </section>
  );
}
