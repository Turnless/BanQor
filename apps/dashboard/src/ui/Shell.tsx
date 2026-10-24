import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { isAddress, type Address } from "viem";
import { chain, deployment } from "../config";
import { short } from "../lib";
import { href, useRoute, type Route } from "../route";
import { useVault } from "../hooks";
import { useSlideThumb } from "./thumb";

const TABS: { route: Route; label: string; ownerOnly?: boolean }[] = [
  { route: "overview", label: "Overview" },
  { route: "agents", label: "Agents" },
  { route: "activity", label: "Activity", ownerOnly: true },
  { route: "open", label: "Open a line" },
];

export const Logo = ({ size = 24 }: { size?: number }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <circle cx="15" cy="15" r="11" fill="none" stroke="#f2efeb" strokeWidth="3.2" />
    <path d="M20 20 L27.5 27.5" stroke="#ff6b1f" strokeWidth="3.6" strokeLinecap="round" />
    <circle cx="15" cy="15" r="3.6" fill="#ff6b1f" />
  </svg>
);

/** Floating top bar: page tabs with a sliding highlight, the network, and the wallet (FR-UI1). */
export function TopBar() {
  const { route, vaultParam } = useRoute();
  const { isOwner } = useVault();
  const tabs = TABS.filter((t) => !t.ownerOnly || isOwner);
  const current = tabs.findIndex((t) => t.route === route);
  const nav = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useSlideThumb(nav, "a", current, [tabs.length]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // a viewed vault stays in the links, so moving between pages keeps looking at it
  const link = (r: Route) => href(r, r === "open" ? undefined : vaultParam);

  return (
    <header className={`top${scrolled ? " scrolled" : ""}`}>
      <div className="shell">
        <a className="brand" href="./">
          <Logo />
          BanQor
        </a>
        <nav className="tabs" aria-label="Dashboard" ref={nav}>
          {tabs.map((t) => (
            <a key={t.route} href={link(t.route)} aria-current={t.route === route ? "page" : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
        <div className="right">
          <span className="net" title={`Network: ${chain.name}`}>
            Mezo<span className="net-tag">{chain.testnet ? "Testnet" : "Mainnet"}</span>
          </span>
          <Wallet />
        </div>
      </div>
      <nav className="tabs-m" aria-label="Dashboard">
        {tabs.map((t) => (
          <a key={t.route} href={link(t.route)} aria-current={t.route === route ? "page" : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function Wallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [menu, setMenu] = useState(false);

  if (!isConnected) {
    const c = connectors[0];
    return (
      <>
        <button className="btn btn-orange btn-sm" type="button" disabled={!c || isPending} onClick={() => c && connect({ connector: c, chainId: chain.id })} title={error?.message}>
          {isPending ? "Connecting…" : c ? "Connect wallet" : "No wallet found"}
        </button>
      </>
    );
  }
  if (chainId !== chain.id) {
    return (
      <button className="btn btn-danger btn-sm" type="button" disabled={switching} onClick={() => switchChain({ chainId: chain.id })}>
        Switch to Mezo
      </button>
    );
  }
  return (
    <div className="wallet-wrap">
      <button className="wallet" type="button" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        {short(address)}
      </button>
      {menu && (
        <div className="wallet-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => navigator.clipboard?.writeText(address!).then(() => setMenu(false))}>
            Copy address
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export function Footer() {
  return (
    <footer>
      <a className="f-brand" href="./">
        <Logo size={18} />
        BanQor
      </a>
      <span className="f-note">
        {chain.testnet ? "Mezo testnet" : "Mezo"} <span aria-hidden="true">·</span> unaudited
      </span>
    </footer>
  );
}

/**
 * Shows `children(vault)` once there's a vault to show; otherwise explains what's missing: no factory,
 * no wallet, wrong network, still looking, or no vault yet. Anyone can also open a vault read-only.
 */
export function VaultGate({ children }: { children: (vault: Address) => ReactNode }) {
  const v = useVault();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  if (v.vault) return <>{children(v.vault)}</>;
  if (!v.factory) return <Empty title="Not deployed yet">There's no BanQor factory in deployments/{deployment.chainId}.json.</Empty>;
  if (!v.isConnected)
    return (
      <Empty title="Connect your wallet" actions={connectors[0] && <button className="btn btn-orange" type="button" onClick={() => connect({ connector: connectors[0], chainId: chain.id })}>Connect wallet</button>}>
        See your credit line and manage your agents. Or look at any vault without connecting.
      </Empty>
    );
  if (v.wrongChain)
    return (
      <Empty title="Wrong network" actions={<button className="btn btn-orange" type="button" onClick={() => switchChain({ chainId: chain.id })}>Switch to Mezo</button>}>
        Your wallet is on another network. BanQor runs on {chain.name}.
      </Empty>
    );
  if (v.loading) return <Empty title="Looking up your vault…" />;
  return (
    <Empty title="No credit line yet" actions={<a className="btn btn-orange" href={href("open")}>Open a line →</a>}>
      This wallet doesn't have a vault. Opening a line takes about two minutes and three transactions.
    </Empty>
  );
}

function Empty({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="empty">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
      <div className="empty-acts">
        {actions}
        <Lookup />
      </div>
    </section>
  );
}

/** Open any vault read-only (FR-UI7); the demo vault is one click away when the deployment names one. */
export function Lookup() {
  const [v, setV] = useState("");
  const { route } = useRoute();
  const target = route === "open" ? "overview" : route;
  const demo = deployment.banqor.demoVault;
  return (
    <form
      className="lookup"
      aria-label="View a vault"
      onSubmit={(e) => {
        e.preventDefault();
        if (isAddress(v)) window.location.hash = href(target, v);
      }}
    >
      <div className="inwrap">
        <input value={v} onChange={(e) => setV(e.target.value.trim())} placeholder="View any vault: 0x…" aria-label="Vault address" spellCheck={false} />
        <button className="btn btn-ghost btn-sm" type="submit" disabled={!isAddress(v)}>
          View
        </button>
      </div>
      {demo && (
        <a className="demo-link" href={href(target, demo)}>
          or see the demo vault →
        </a>
      )}
    </form>
  );
}
