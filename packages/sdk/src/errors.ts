import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";
import { banqorVaultAbi } from "./abi.js";

/** Refusal reasons from the vault (custom errors) plus SDK-side guards. */
export type BanQorErrorCode =
  | "NotOwner"
  | "NotAgent"
  | "Paused"
  | "AgentInactive"
  | "AgentExpired"
  | "DrawTooLarge"
  | "DailyCapExceeded"
  | "FloatExceeded"
  | "IcrTooLow"
  | "LineNotOpen"
  | "LineAlreadyOpen"
  | "FloorTooLow"
  | "NothingToRebalance"
  | "ZeroAddress"
  | "ZeroAmount"
  | "BtcTransferFailed"
  // SDK guards (checked before signing a payment)
  | "PriceTooHigh"
  | "PayeeNotAllowed"
  | "AssetNotAllowed"
  // anything else (Mezo revert strings, RPC failures, ...)
  | "Unknown";

/** BanQor's own custom errors; anything else (e.g. inherited OpenZeppelin errors) becomes "Unknown". */
const VAULT_ERRORS = new Set<string>([
  "NotOwner",
  "NotAgent",
  "AgentInactive",
  "AgentExpired",
  "DrawTooLarge",
  "DailyCapExceeded",
  "FloatExceeded",
  "IcrTooLow",
  "LineNotOpen",
  "LineAlreadyOpen",
  "FloorTooLow",
  "NothingToRebalance",
  "ZeroAddress",
  "ZeroAmount",
  "BtcTransferFailed",
]);

export class BanQorError extends Error {
  readonly code: BanQorErrorCode;
  override readonly cause?: unknown;

  constructor(code: BanQorErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "BanQorError";
    this.code = code;
    this.cause = cause;
  }
}

function codeFromErrorName(name: string): BanQorErrorCode {
  // The contract names its paused error ErrPaused to avoid clashing with the event.
  if (name === "ErrPaused") return "Paused";
  return VAULT_ERRORS.has(name) ? (name as BanQorErrorCode) : "Unknown";
}

// Checked by shape, not instanceof: an app that bundles its own copy of viem hands us errors from classes
// that aren't this module's, and instanceof would silently skip decoding.
const isViemError = (e: unknown): e is BaseError =>
  e instanceof BaseError || (typeof e === "object" && e !== null && typeof (e as BaseError).walk === "function" && "shortMessage" in e);
const isRevertedError = (e: unknown): e is ContractFunctionRevertedError =>
  e instanceof ContractFunctionRevertedError || (e as Error | null)?.name === "ContractFunctionRevertedError";

/** Turns a viem error (or raw revert data) from a vault call into a typed BanQorError. */
export function toBanQorError(err: unknown): BanQorError {
  if (err instanceof BanQorError) return err;

  if (isViemError(err)) {
    const reverted = err.walk((e) => isRevertedError(e));
    if (isRevertedError(reverted)) {
      const name = reverted.data?.errorName;
      if (name) return new BanQorError(codeFromErrorName(name), `Vault refused: ${name}`, err);
      if (reverted.reason) return new BanQorError("Unknown", reverted.reason, err);
    }
    const data = findRevertData(err);
    if (data) {
      const decoded = decodeVaultRevert(data);
      if (decoded) return decoded;
    }
    return new BanQorError("Unknown", err.shortMessage, err);
  }
  return new BanQorError("Unknown", err instanceof Error ? err.message : String(err), err);
}

/** Decodes raw revert data against the vault ABI. */
export function decodeVaultRevert(data: Hex): BanQorError | undefined {
  try {
    const { errorName } = decodeErrorResult({ abi: banqorVaultAbi, data });
    return new BanQorError(codeFromErrorName(errorName), `Vault refused: ${errorName}`);
  } catch {
    return undefined;
  }
}

function findRevertData(err: BaseError): Hex | undefined {
  let found: Hex | undefined;
  err.walk((e) => {
    const d = (e as { data?: unknown }).data;
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) {
      found = d as Hex;
      return true;
    }
    return false;
  });
  return found;
}
