import { validateSolanaTransactionSignature } from "./solana-protocol.js";
import {
  LosslessJsonNumber,
  decodeJsonBytes,
  isLosslessObject,
  losslessIntegerToken,
  losslessToJsonSafe,
  type LosslessJsonValue,
} from "./lossless-json.js";
export type ExactSolanaSignatureInfo = {
  signature: string;
  slot: bigint;
  err: unknown;
  memo: string | null;
  blockTime: bigint | null;
  confirmationStatus: string | null;
};
function signedIntegerToken(value: LosslessJsonValue, label: string): string {
  if (!(value instanceof LosslessJsonNumber) || !/^-?(?:0|[1-9][0-9]*)$/.test(value.token)) {
    throw new Error(`${label} must be an exact JSON integer`);
  }
  return value.token;
}
export function parseSolanaSignatureRpcBytes(
  bytes: Uint8Array,
  expectedId = "1",
): ExactSolanaSignatureInfo[] {
  const decoded = decodeJsonBytes(bytes, {
    maxDepth: 24,
    maxNodes: 100_000,
    maxArrayItems: 1_100,
    maxObjectMembers: 64,
  }).value;
  if (!isLosslessObject(decoded) || decoded.jsonrpc !== "2.0") {
    throw new Error("malformed Solana JSON-RPC envelope");
  }
  const id = decoded.id;
  if (!(id instanceof LosslessJsonNumber) || id.token !== expectedId) {
    throw new Error("Solana JSON-RPC response id mismatch");
  }
  if (decoded.error != null) {
    throw new Error(`Solana RPC error: ${JSON.stringify(losslessToJsonSafe(decoded.error))}`);
  }
  if (!Array.isArray(decoded.result)) throw new Error("Solana signature result is not an array");
  return decoded.result.map((item, index) => {
    if (!isLosslessObject(item)) throw new Error(`Solana signature row ${index} is not an object`);
    if (typeof item.signature !== "string") throw new Error(`Solana signature row ${index} omitted signature`);
    const signature = validateSolanaTransactionSignature(item.signature);
    const slot = BigInt(losslessIntegerToken(item.slot, `Solana signature row ${index} slot`));
    const memo = item.memo == null
      ? null
      : typeof item.memo === "string"
        ? item.memo
        : (() => { throw new Error(`Solana signature row ${index} memo is invalid`); })();
    const confirmationStatus = item.confirmationStatus == null
      ? null
      : typeof item.confirmationStatus === "string"
        ? item.confirmationStatus
        : (() => { throw new Error(`Solana signature row ${index} confirmationStatus is invalid`); })();
    const blockTime = item.blockTime == null
      ? null
      : BigInt(signedIntegerToken(item.blockTime, `Solana signature row ${index} blockTime`));
    return {
      signature,
      slot,
      err: item.err == null ? null : losslessToJsonSafe(item.err),
      memo,
      blockTime,
      confirmationStatus,
    };
  });
}
