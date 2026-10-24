import { describe, expect, it } from "vitest";
import { encodeErrorResult } from "viem";
import { banqorVaultAbi } from "../src/abi.js";
import { BanQorError, decodeVaultRevert, toBanQorError } from "../src/errors.js";
import { chainIdFromNetwork } from "../src/config.js";

const errors = banqorVaultAbi.filter((x) => x.type === "error") as readonly { name: string; inputs: readonly unknown[] }[];
// BanQor-declared errors take no args; inherited OpenZeppelin ones are tested separately
const errorNames = errors.filter((e) => e.inputs.length === 0 && !e.name.startsWith("ReentrancyGuard")).map((e) => e.name);

describe("error decoding", () => {
  it.each(errorNames)("decodes vault error %s", (name) => {
    const data = encodeErrorResult({ abi: banqorVaultAbi, errorName: name as never });
    const e = decodeVaultRevert(data);
    expect(e).toBeInstanceOf(BanQorError);
    expect(e!.code).toBe(name === "ErrPaused" ? "Paused" : name);
  });

  it("maps inherited OpenZeppelin errors to Unknown", () => {
    const data = encodeErrorResult({ abi: banqorVaultAbi, errorName: "ReentrancyGuardReentrantCall" });
    expect(decodeVaultRevert(data)!.code).toBe("Unknown");
  });

  it("maps unknown data to undefined and plain errors to Unknown", () => {
    expect(decodeVaultRevert("0xdeadbeef")).toBeUndefined();
    expect(toBanQorError(new Error("boom")).code).toBe("Unknown");
    const e = new BanQorError("IcrTooLow", "x");
    expect(toBanQorError(e)).toBe(e);
  });

  it("parses CAIP-2 network ids", () => {
    expect(chainIdFromNetwork("eip155:31611")).toBe(31611);
    expect(() => chainIdFromNetwork("solana:mainnet")).toThrow();
  });
});

describe("intrinsic gas", () => {
  it("matches the estimate a node returned for draw(1e18) against state without the vault (tx 0x239f…a006)", async () => {
    const { encodeFunctionData } = await import("viem");
    const { intrinsicGas } = await import("../src/vault.js");
    const data = encodeFunctionData({ abi: banqorVaultAbi, functionName: "draw", args: [10n ** 18n] });
    expect(intrinsicGas(data)).toBe(21_264n);
  });
});
