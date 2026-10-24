// Test helper: a local anvil fork of Mezo testnet with BanQor deployed and a line open.
// Mezo's PriceFeed reads an oracle precompile anvil can't execute, so its code is swapped for
// MockPriceFeed seeded with the live price read from the real RPC.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  pad,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { banqorFactoryAbi, banqorVaultAbi } from "../src/abi.js";
import { chainFromRpc, type Deployment } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
// anvil's well-known public test mnemonic (local dev chain only)
// forked state is pulled from the remote RPC on first touch, so early calls can be slow
export const RPC_TIMEOUT = 180_000;
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
/** anvil's pre-funded dev accounts (0 = owner, 1 = agent, 2 = payee in startLocalMezo) */
export const devAccount = (index: number) => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });

export const loadDeploymentFile = (chainId = 31611): Deployment =>
  JSON.parse(readFileSync(resolve(root, "deployments", `${chainId}.json`), "utf8"));

function artifact(file: string, name: string): { abi: unknown[]; bytecode: Hex; deployedBytecode: Hex } {
  const j = JSON.parse(readFileSync(resolve(root, "contracts/out", file, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object, deployedBytecode: j.deployedBytecode.object };
}

async function rpcAlive(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitForRpc(url: string, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await rpcAlive(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`anvil did not start at ${url}`);
}

export interface LocalMezo {
  rpcUrl: string;
  deployment: Deployment;
  network: `eip155:${number}`;
  factory: Address;
  vault: Address;
  owner: ReturnType<typeof mnemonicToAccount>;
  agent: ReturnType<typeof mnemonicToAccount>;
  payee: ReturnType<typeof mnemonicToAccount>;
  price: bigint;
  publicClient: PublicClient;
  setPrice(p: bigint): Promise<void>;
  ownerWrite(functionName: string, args?: readonly unknown[], value?: bigint): Promise<void>;
  stop(): void;
}

export async function startLocalMezo(port: number, opts: { forkUrl?: string } = {}): Promise<LocalMezo> {
  const deployment = loadDeploymentFile();
  const forkUrl = opts.forkUrl ?? process.env.MEZO_RPC ?? deployment.rpc;
  const rpcUrl = `http://127.0.0.1:${port}`;

  // live price from the real chain (the precompile works there)
  const live = createPublicClient({ transport: http(forkUrl) });
  const price = await live.readContract({
    address: deployment.mezo.priceFeed,
    abi: [{ type: "function", name: "fetchPrice", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }],
    functionName: "fetchPrice",
  });

  // never attach to a stale node from an earlier run: its state would leak into these tests
  if (await rpcAlive(rpcUrl)) throw new Error(`port ${port} already has an RPC node; stop it first`);
  // spawned directly (no shell) so stop() kills anvil itself
  const proc: ChildProcess = spawn("anvil", ["--fork-url", forkUrl, "--port", String(port), "--silent", "--timeout", "120000", "--retries", "10"], {
    stdio: "ignore",
  });
  const exited = new Promise<never>((_, reject) => proc.once("exit", (code) => reject(new Error(`anvil exited (${code})`))));
  await Promise.race([waitForRpc(rpcUrl), exited]);

  const chain = chainFromRpc(rpcUrl, deployment.network);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: RPC_TIMEOUT }) }) as PublicClient;
  const test = createTestClient({ chain, mode: "anvil", transport: http(rpcUrl, { timeout: RPC_TIMEOUT }) });
  const [owner, agent, payee] = [0, 1, 2].map((i) => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: i }));

  const mockFeed = artifact("MezoMocks.sol", "MockPriceFeed");
  await test.setCode({ address: deployment.mezo.priceFeed, bytecode: mockFeed.deployedBytecode });
  const setPrice = async (p: bigint) => {
    await test.setStorageAt({ address: deployment.mezo.priceFeed, index: pad(toHex(0)), value: pad(toHex(p)) });
  };
  await setPrice(price);

  const ownerWallet = createWalletClient({ account: owner, chain, transport: http(rpcUrl, { timeout: RPC_TIMEOUT }) });
  const fac = artifact("BanQorFactory.sol", "BanQorFactory");
  const m = deployment.mezo;
  const ctorArgs = encodeAbiParameters(
    [
      { type: "tuple", components: [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }] },
      { type: "tuple", components: [{ type: "uint16" }, { type: "uint16" }, { type: "uint128" }, { type: "uint32" }] },
    ],
    [
      [m.musd, m.borrowerOperations, m.troveManager, m.hintHelpers, m.sortedTroves, m.priceFeed],
      [20000, 1000, 5n * 10n ** 18n, 15],
    ],
  );
  const deployHash = await ownerWallet.sendTransaction({ data: (fac.bytecode + ctorArgs.slice(2)) as Hex, chain });
  const factory = (await publicClient.waitForTransactionReceipt({ hash: deployHash })).contractAddress!;

  const createHash = await ownerWallet.writeContract({ address: factory, abi: banqorFactoryAbi, functionName: "createVault", chain });
  await publicClient.waitForTransactionReceipt({ hash: createHash });
  const vault = await publicClient.readContract({ address: factory, abi: banqorFactoryAbi, functionName: "vaultOf", args: [owner.address] });

  const ownerWrite = async (functionName: string, args: readonly unknown[] = [], value?: bigint) => {
    const hash = await ownerWallet.writeContract({
      address: vault,
      abi: banqorVaultAbi,
      functionName: functionName as never,
      args: args as never,
      value,
      chain,
    } as never);
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} reverted`);
  };

  // open a line at ~300% ICR on Mezo's minimum debt, read from the live contracts
  const bo = [
    { type: "function", name: "minNetDebt", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "MUSD_GAS_COMPENSATION", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
    { type: "function", name: "getBorrowingFee", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  ] as const;
  const debt = await publicClient.readContract({ address: m.borrowerOperations, abi: bo, functionName: "minNetDebt" });
  const gasComp = await publicClient.readContract({ address: m.borrowerOperations, abi: bo, functionName: "MUSD_GAS_COMPENSATION" });
  const fee = await publicClient.readContract({ address: m.borrowerOperations, abi: bo, functionName: "getBorrowingFee", args: [debt] });
  const coll = ((debt + fee + gasComp) * 3n * 10n ** 18n) / price + 1n;
  await ownerWrite("openLine", [debt, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"], coll);

  return {
    rpcUrl,
    deployment,
    network: deployment.network,
    factory,
    vault,
    owner,
    agent,
    payee,
    price,
    publicClient,
    setPrice,
    ownerWrite,
    stop: () => {
      proc.kill();
    },
  };
}
