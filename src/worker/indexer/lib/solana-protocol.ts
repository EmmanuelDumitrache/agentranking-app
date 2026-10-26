import { createHash } from "node:crypto";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { parseCanonicalUnsignedDecimal } from "./exact-protocol.js";
export function validateSolanaTransactionSignature(signature: string): string {
  let bytes: Uint8Array;
  try { bytes = bs58.decode(signature); } catch (error) {
    throw new Error("Solana transaction signature must be valid base58", { cause: error });
  }
  if (bytes.byteLength !== 64) throw new Error("Solana transaction signature must decode to exactly 64 bytes");
  return signature;
}
export type SolanaSourceCoordinates = {
  slot: bigint | null;
  signature: string | null;
  transactionIndex: number | null;
  eventOrdinal: number | null;
  blockHash: string | null;
  parentSlot: bigint | null;
  blockTime: Date | null;
  indexerUpdatedAt: Date | null;
};
export function parseSolanaExactUnsigned(value: unknown, label: string): bigint | null {
  if (value == null || value === "") return null;
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must not pass through an unsafe JavaScript number`);
    return BigInt(value);
  }
  if (typeof value !== "string") throw new Error(`${label} must be a decimal string`);
  return parseCanonicalUnsignedDecimal(value, { label });
}
export function parseSolanaBoundedInt(
  value: unknown,
  label: string,
  maximum = 2_147_483_647,
): number | null {
  if (value == null || value === "") return null;
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("maximum must be a non-negative safe integer");
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new Error(`${label} is outside bounded integer range`);
    }
    return value;
  }
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical unsigned decimal integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error(`${label} is outside bounded integer range`);
  return parsed;
}
export function parseSolanaPublicKey(value: unknown, label: string, required = false): string | null {
  if (value == null || value === "") {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${label} must be base58 text`);
  try { return new PublicKey(value).toBase58(); }
  catch (error) { throw new Error(`${label} is not a 32-byte Solana public key`, { cause: error }); }
}
export function compareSolanaSourceCoordinates(a: SolanaSourceCoordinates, b: SolanaSourceCoordinates): number {
  if (a.slot == null || b.slot == null) return 0;
  if (a.slot !== b.slot) return a.slot < b.slot ? -1 : 1;
  const aTx = a.transactionIndex ?? -1;
  const bTx = b.transactionIndex ?? -1;
  if (aTx !== bTx) return aTx - bTx;
  return (a.eventOrdinal ?? -1) - (b.eventOrdinal ?? -1);
}
export function solanaSourceEventBusinessKey(
  asset: string,
  source: SolanaSourceCoordinates,
  raw: Record<string, unknown>,
): string {
  if (source.slot != null && source.signature && source.eventOrdinal != null) {
    return `${asset}:${source.slot}:${source.signature}:${source.transactionIndex ?? -1}:${source.eventOrdinal}`;
  }
  return `${asset}:indexer:${createHash("sha256").update(JSON.stringify(raw)).digest("hex")}`;
}
