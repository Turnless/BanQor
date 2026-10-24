import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";

export type Route = "overview" | "agents" | "activity" | "open";
const ROUTES: Route[] = ["overview", "agents", "activity", "open"];

/** `#/agents?vault=0x…`: the page, plus an optional vault to view instead of the connected wallet's. */
function parse(): { route: Route; vaultParam?: Address } {
  const [path, query = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  const route = ROUTES.includes(path as Route) ? (path as Route) : "overview";
  // `?vault=` in the hash, or the older `app.html?vault=0x…` form
  const v = new URLSearchParams(query).get("vault") ?? new URLSearchParams(window.location.search).get("vault");
  return { route, vaultParam: v && isAddress(v) ? v : undefined };
}

export function useRoute() {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => {
      setR(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export const href = (route: Route, vault?: Address) => `#/${route}${vault ? `?vault=${vault}` : ""}`;
