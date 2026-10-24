import { describe, expect, it } from "vitest";
import { maxUint256 } from "viem";
import { fmt, pct, short } from "../src/lib";
import { chain, deployment, settings } from "../src/config";

describe("dashboard helpers", () => {
  it("formats amounts and ratios", () => {
    expect(fmt(1_500_000_000_000_000_000n)).toBe((1.5).toLocaleString());
    expect(fmt(undefined)).toBe("–");
    expect(pct(20000n)).toBe("200.00%");
    expect(pct(maxUint256)).toBe("∞");
    expect(short("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("reads chain and settings from the deployments file", () => {
    expect(chain.id).toBe(deployment.chainId);
    expect(chain.nativeCurrency.symbol).toBe("BTC");
    expect(settings.logsMaxRange).toBe(10_000n);
  });
});
