// Runs a command with the repo-root .env loaded and deployment defaults filled in.
//   node --env-file-if-exists=.env scripts/with-env.mjs <cmd> [args...]
// Args may contain {{NAME}} placeholders, replaced from the environment (no shell expansion,
// so it behaves the same in cmd.exe and sh). MEZO_RPC and MEZO_VERIFIER_URL default to the
// "rpc" and "verifier" fields of deployments/<CHAIN_ID>.json.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chainId = process.env.CHAIN_ID || "31611";
const d = JSON.parse(readFileSync(resolve(root, "deployments", `${chainId}.json`), "utf8"));
process.env.CHAIN_ID = chainId;
process.env.MEZO_RPC ||= d.rpc;
process.env.MEZO_VERIFIER_URL ||= d.verifier;

const [cmd, ...raw] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: with-env.mjs <cmd> [args...]");
  process.exit(2);
}
const args = raw.map((a) =>
  a.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const v = process.env[name];
    if (!v) {
      console.error(`with-env: ${name} is not set`);
      process.exit(2);
    }
    return v;
  }),
);
// No shell: substituted values (e.g. an RPC URL with "&" in its query) must reach the command unparsed.
const r = spawnSync(cmd, args, { stdio: "inherit", env: process.env });
if (r.error) {
  console.error(`with-env: could not run ${cmd}: ${r.error.message}`);
  process.exit(127);
}
process.exit(r.status ?? 1);
