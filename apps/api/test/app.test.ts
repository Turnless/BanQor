import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { createDataSources, parseFunding, parsePrice, parseSentiment } from "../src/data.js";
import { loadDeployment } from "../src/config.js";
import { stubFacilitator } from "./stub-facilitator.js";

const deployment = loadDeployment(31611);
const payTo = "0x000000000000000000000000000000000000bEEF";

const failingFetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({
    network: deployment.network,
    payTo,
    prices: { price: "$0.01", funding: "$0.02", sentiment: "$0.05" },
    facilitator: stubFacilitator({ network: deployment.network, musd: deployment.mezo.musd }),
    data: createDataSources({ price: "http://x/price", funding: "http://x/funding", sentiment: "http://x/s" }, 60, 300, failingFetch),
  });
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server?.close());

function decodeHeader(h: string | null) {
  expect(h).toBeTruthy();
  return JSON.parse(Buffer.from(h!, "base64").toString("utf8"));
}

describe("demo x402 API", () => {
  it("GET /health is free", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it.each([
    ["/price", 10n ** 16n],
    ["/funding", 2n * 10n ** 16n],
    ["/sentiment", 5n * 10n ** 16n],
  ])("GET %s answers 402 with an exact MUSD requirement", async (path, amount) => {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(402);
    const required = decodeHeader(res.headers.get("PAYMENT-REQUIRED"));
    expect(required.x402Version).toBe(2);
    const req = required.accepts[0];
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe(deployment.network);
    expect(req.asset.toLowerCase()).toBe(deployment.mezo.musd.toLowerCase());
    expect(BigInt(req.amount)).toBe(amount); // $ price -> MUSD (18 decimals)
    expect(req.payTo).toBe(payTo);
    // without this the real facilitator answers 412 permit2_allowance_required for a fresh agent
    expect(Object.keys(required.extensions ?? {})).toContain("eip2612GasSponsoring");
  });
});

describe("data sources", () => {
  it("fall back to the bundled snapshot when the source is down", async () => {
    const ds = createDataSources({ price: "http://x", funding: "http://x", sentiment: "http://x" }, 60, 300, failingFetch);
    const p = await ds.price();
    expect(p.source).toBe("fallback");
    expect(p.data.usd).toBeGreaterThan(0);
  });

  it("serve live, then cache, then last good value on failure", async () => {
    let calls = 0;
    let up = true;
    const f = (async () => {
      calls++;
      if (!up) throw new Error("down");
      return new Response(JSON.stringify({ bitcoin: { usd: 123, usd_24h_change: 1 } }));
    }) as typeof fetch;
    const ds = createDataSources({ price: "http://x", funding: "http://x", sentiment: "http://x" }, 0, 0, f);
    expect((await ds.price()).source).toBe("live");
    up = false;
    const r = await ds.price();
    expect(r.source).toBe("cache");
    expect(r.data.usd).toBe(123);
    expect(calls).toBe(2);
  });

  it("parsers read the default source formats", () => {
    expect(parsePrice({ bitcoin: { usd: 1, usd_24h_change: 2 } })).toEqual({ usd: 1, change24hPct: 2 });
    expect(parseSentiment({ data: [{ value: "40", value_classification: "Fear" }] })).toEqual({ value: 40, label: "Fear" });
    const f = parseFunding([
      { market: "A", index_id: "BTC", contract_type: "perpetual", funding_rate: 0.01 },
      { market: "B", index_id: "BTC", contract_type: "perpetual", funding_rate: 0.03 },
      { market: "C", index_id: "ETH", contract_type: "perpetual", funding_rate: 1 },
    ]);
    expect(f.markets).toBe(2);
    expect(f.meanRatePct).toBeCloseTo(0.02);
    expect(() => parsePrice({})).toThrow();
  });
});
