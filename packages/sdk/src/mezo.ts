import type { Address, PublicClient } from "viem";

/** Minimal Mezo MUSD ABIs (signatures match the verified testnet implementations). */
export const borrowerOperationsAbi = [
  { type: "function", name: "minNetDebt", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "MUSD_GAS_COMPENSATION", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "getBorrowingFee",
    inputs: [{ name: "_debt", type: "uint256" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const hintHelpersAbi = [
  {
    type: "function",
    name: "getApproxHint",
    inputs: [
      { name: "_CR", type: "uint256" },
      { name: "_numTrials", type: "uint256" },
      { name: "_inputRandomSeed", type: "uint256" },
    ],
    outputs: [
      { name: "hintAddress", type: "address" },
      { name: "diff", type: "uint256" },
      { name: "latestRandomSeed", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

export const sortedTrovesAbi = [
  {
    type: "function",
    name: "findInsertPosition",
    inputs: [
      { name: "_NICR", type: "uint256" },
      { name: "_prevId", type: "address" },
      { name: "_nextId", type: "address" },
    ],
    outputs: [{ type: "address" }, { type: "address" }],
    stateMutability: "view",
  },
] as const;

export const priceFeedAbi = [
  { type: "function", name: "fetchPrice", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

/** Mezo LiquityMath NICR precision */
const NICR_PRECISION = 10n ** 20n;
const E18 = 10n ** 18n;
/** Mezo's minimum collateral ratio (liquidation line), 110% */
export const MEZO_MCR_BPS = 11_000n;

export interface MezoAddresses {
  borrowerOperations: Address;
  hintHelpers: Address;
  sortedTroves: Address;
  priceFeed: Address;
}

/**
 * Sorted-list insert hints for a trove that will hold `coll` BTC against `principal` MUSD.
 * Computing them off-chain keeps owner transactions cheap.
 */
export async function computeHints(
  client: PublicClient,
  mezo: Pick<MezoAddresses, "hintHelpers" | "sortedTroves">,
  coll: bigint,
  principal: bigint,
  trials = 15n,
): Promise<readonly [Address, Address]> {
  if (principal === 0n) return ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"];
  const nicr = (coll * NICR_PRECISION) / principal;
  const seed = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const [hint] = await client.readContract({
    address: mezo.hintHelpers,
    abi: hintHelpersAbi,
    functionName: "getApproxHint",
    args: [nicr, trials, seed],
  });
  return client.readContract({
    address: mezo.sortedTroves,
    abi: sortedTrovesAbi,
    functionName: "findInsertPosition",
    args: [nicr, hint, hint],
  });
}

export interface OpenLinePreview {
  price: bigint;
  fee: bigint;
  gasCompensation: bigint;
  minNetDebt: bigint;
  /** debt the trove will record: requested + fee + gas compensation */
  compositeDebt: bigint;
  icrBps: bigint;
  /** BTC price at which the trove hits Mezo's 110% MCR */
  liquidationPrice: bigint;
  /** BTC price below which draws stop (ICR floor) */
  floorPrice: bigint;
  meetsMinDebt: boolean;
}

/** Live preview for the open-line form (FR-UI2): reads fee, gas compensation and price from Mezo. */
export async function previewOpenLine(
  client: PublicClient,
  mezo: Pick<MezoAddresses, "borrowerOperations" | "priceFeed">,
  coll: bigint,
  debt: bigint,
  icrFloorBps: bigint,
): Promise<OpenLinePreview> {
  const bo = { address: mezo.borrowerOperations, abi: borrowerOperationsAbi } as const;
  const [price, fee, gasCompensation, minNetDebt] = await Promise.all([
    client.readContract({ address: mezo.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" }),
    client.readContract({ ...bo, functionName: "getBorrowingFee", args: [debt] }),
    client.readContract({ ...bo, functionName: "MUSD_GAS_COMPENSATION" }),
    client.readContract({ ...bo, functionName: "minNetDebt" }),
  ]);
  const compositeDebt = debt + fee + gasCompensation;
  return {
    price,
    fee,
    gasCompensation,
    minNetDebt,
    compositeDebt,
    ...lineMath(coll, compositeDebt, price, icrFloorBps),
    meetsMinDebt: debt + fee >= minNetDebt,
  };
}

/** Derived numbers shown on the dashboard (ARCHITECTURE §7). */
export function lineMath(coll: bigint, debt: bigint, price: bigint, icrFloorBps: bigint) {
  if (coll === 0n || debt === 0n) return { icrBps: 0n, liquidationPrice: 0n, floorPrice: 0n };
  return {
    icrBps: (coll * price * 10_000n) / (debt * E18),
    liquidationPrice: (debt * MEZO_MCR_BPS * E18) / (coll * 10_000n),
    floorPrice: (debt * icrFloorBps * E18) / (coll * 10_000n),
  };
}
