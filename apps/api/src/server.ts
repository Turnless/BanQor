import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createApp } from "./app.js";
import { loadApiConfig, repoRoot } from "./config.js";
import { createDataSources } from "./data.js";

loadEnv({ path: resolve(repoRoot, ".env") });

const cfg = loadApiConfig();
const app = createApp({
  network: cfg.network,
  payTo: cfg.payTo,
  prices: cfg.prices,
  facilitator: new HTTPFacilitatorClient({ url: cfg.facilitatorUrl }),
  data: createDataSources(cfg.sources, cfg.cacheSeconds, cfg.fundingCacheSeconds),
});

app.listen(cfg.port, () => {
  console.log(`BanQor demo API on :${cfg.port} (${cfg.network}), paying to ${cfg.payTo}`);
  console.log(`  facilitator ${cfg.facilitatorUrl}`);
  console.log(`  GET /price ${cfg.prices.price}  /funding ${cfg.prices.funding}  /sentiment ${cfg.prices.sentiment}  /health free`);
});
