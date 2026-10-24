import type { FacilitatorClient } from "@x402/core/server";

export interface StubOptions {
  network: string;
  musd: string;
  /** Called on settle with (payer, payTo, amount). Lets tests move MUSD on a local chain. */
  onSettle?: (payer: string, payTo: string, amount: bigint) => Promise<string | void>;
}

export type StubFacilitator = FacilitatorClient & { settled: number; verified: number };

/** Finds the payer address inside an exact-scheme payload (EIP-3009 or Permit2 shapes). */
function findPayer(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const o = payload as Record<string, unknown>;
  if (typeof o.from === "string") return o.from;
  for (const v of Object.values(o)) {
    const f = findPayer(v);
    if (f) return f;
  }
  return undefined;
}

/**
 * Stub facilitator for tests: advertises what facilitator.vativ.io advertises for Mezo
 * (exact + MUSD via Permit2 with EIP-2612 gas sponsoring) and records verify/settle calls.
 */
export function stubFacilitator(opts: StubOptions): StubFacilitator {
  const stub = {
    settled: 0,
    verified: 0,
    async getSupported() {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: "exact",
            network: opts.network,
            extra: {
              assets: [
                {
                  address: opts.musd,
                  symbol: "MUSD",
                  decimals: 18,
                  eip712: { name: "Mezo USD", version: "1" },
                  assetTransferMethod: "permit2",
                  supportsEip2612: true,
                },
              ],
            },
          },
        ],
        extensions: ["eip2612GasSponsoring"],
        signers: { "eip155:*": ["0x0000000000000000000000000000000000000001"] },
      };
    },
    async verify(payload: { payload?: unknown }) {
      stub.verified++;
      return { isValid: true, payer: findPayer(payload.payload) };
    },
    async settle(payload: { payload?: unknown }, req: { payTo: string; amount: string }) {
      const payer = findPayer(payload.payload) ?? "";
      const tx = (await opts.onSettle?.(payer, req.payTo, BigInt(req.amount))) || `0x${"ab".repeat(32)}`;
      stub.settled++;
      return { success: true, transaction: tx, network: opts.network, payer };
    },
  };
  return stub as unknown as StubFacilitator;
}
