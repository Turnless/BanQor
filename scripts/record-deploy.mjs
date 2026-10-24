// Records the factory from the latest successful `forge script Deploy` broadcast into deployments/<CHAIN_ID>.json,
// after confirming the receipt succeeded and the address has code on-chain.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chainId = process.env.CHAIN_ID || "31611";
const depPath = resolve(root, "deployments", `${chainId}.json`);
const d = JSON.parse(readFileSync(depPath, "utf8"));
const rpc = process.env.MEZO_RPC || d.rpc;
const run = JSON.parse(
  readFileSync(resolve(root, "contracts/broadcast/Deploy.s.sol", chainId, "run-latest.json"), "utf8"),
);

const tx = run.transactions.find((t) => t.transactionType === "CREATE" && t.contractName === "BanQorFactory");
if (!tx) throw new Error("no BanQorFactory CREATE in the latest broadcast");
const receipt = run.receipts.find((r) => r.transactionHash === tx.hash);
if (!receipt || receipt.status !== "0x1") throw new Error(`deploy tx ${tx.hash} has no successful receipt`);

const call = async (method, params) => {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};
const code = await call("eth_getCode", [tx.contractAddress, "latest"]);
if (!code || code === "0x") throw new Error(`no code at ${tx.contractAddress} on ${rpc}`);

d.banqor.factory = tx.contractAddress;
d.banqor.factoryDeployBlock = Number(BigInt(receipt.blockNumber));
writeFileSync(depPath, JSON.stringify(d, null, 2) + "\n");
console.log(`recorded BanQorFactory ${tx.contractAddress} (block ${d.banqor.factoryDeployBlock}) in deployments/${chainId}.json`);
