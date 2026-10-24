import express, { type Express } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import type { FacilitatorClient } from "@x402/core/server";
import type { Address } from "viem";
import type { DataSources } from "./data.js";

export interface AppOptions {
  network: `eip155:${number}`;
  payTo: Address;
  prices: { price: string; funding: string; sentiment: string };
  facilitator: FacilitatorClient;
  data: DataSources;
  /** Where x402 verify/settle failures are reported. Defaults to console. */
  log?: Pick<Console, "warn">;
}

/** Demo paid BTC-market API. Uses the official x402 Express middleware and `exact` scheme (FR-D1..D3). */
export function createApp(opts: AppOptions): Express {
  const log = opts.log ?? console;
  const server = new x402ResourceServer(opts.facilitator)
    .register(opts.network, new ExactEvmScheme())
    // surface the facilitator's reason whenever a paid request ends in 402
    .onVerifyFailure(async ({ error }) => log.warn(`[x402] verify failed: ${error.message}`))
    .onSettleFailure(async ({ error }) => log.warn(`[x402] settle failed: ${error.message}`))
    .onAfterSettle(async ({ result }) => {
      if (!result.success) log.warn(`[x402] settle unsuccessful: ${result.errorReason ?? "?"} ${result.errorMessage ?? ""} tx=${result.transaction}`);
    });
  const accepts = (price: string) => ({ scheme: "exact", price, network: opts.network, payTo: opts.payTo });
  // MUSD settles through Permit2. Advertising EIP-2612 gas sponsoring lets a fresh agent pay with a signed
  // permit instead of first sending an on-chain Permit2 approval (without it the server answers 412).
  const extensions = { ...declareEip2612GasSponsoringExtension() };

  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ ok: true, network: opts.network, payTo: opts.payTo, prices: opts.prices });
  });

  app.use(
    paymentMiddleware(
      {
        "GET /price": { accepts: accepts(opts.prices.price), description: "BTC/USD spot price", extensions },
        "GET /funding": { accepts: accepts(opts.prices.funding), description: "BTC perpetual funding rates", extensions },
        "GET /sentiment": { accepts: accepts(opts.prices.sentiment), description: "Crypto fear & greed index", extensions },
      },
      server,
    ),
  );

  app.get("/price", async (_req, res) => res.json(await opts.data.price()));
  app.get("/funding", async (_req, res) => res.json(await opts.data.funding()));
  app.get("/sentiment", async (_req, res) => res.json(await opts.data.sentiment()));

  return app;
}
