import { createHash } from "node:crypto";
import { assertWellFormedUnicode, boundUtf8String } from "./unicode-bounds.js";
export type NormalizedChainString = {
  value: string;
  sourceDigest: string;
  sourceUtf8Bytes: number;
  normalized: boolean;
  truncated: boolean;
};
const PROHIBITED_CONTROL = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/**
 * Normalizes an untrusted chain/indexer string for PostgreSQL and logs.
 * NUL is rejected because PostgreSQL text cannot represent it. Other terminal
 * control bytes are removed, Unicode is NFC-normalized, and bounding is by
 * UTF-8 bytes rather than UTF-16 code units.
 */
export function normalizeChainString(
  input: unknown,
  options: { label: string; maxBytes: number; allowTruncation?: boolean; trim?: boolean },
): NormalizedChainString {
  if (typeof input !== "string") throw new Error(`${options.label} must be a string`);
  assertWellFormedUnicode(input, options.label);
  if (input.includes("\u0000")) throw new Error(`${options.label} contains a NUL character`);
  const sourceBytes = Buffer.from(input, "utf8");
  const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
  let normalized = input.normalize("NFC").replace(PROHIBITED_CONTROL, "");
  if (options.trim !== false) normalized = normalized.trim();
  const bounded = boundUtf8String(normalized, options.maxBytes, options.label);
  if (bounded.truncated && options.allowTruncation !== true) {
    throw new Error(`${options.label} exceeds ${options.maxBytes} UTF-8 bytes`);
  }
  return {
    value: bounded.value,
    sourceDigest,
    sourceUtf8Bytes: sourceBytes.byteLength,
    normalized: normalized !== input,
    truncated: bounded.truncated,
  };
}
export function normalizationEvidence(value: NormalizedChainString): Record<string, unknown> | null {
  if (!value.normalized && !value.truncated) return null;
  return {
    sourceDigest: value.sourceDigest,
    sourceUtf8Bytes: value.sourceUtf8Bytes,
    normalized: value.normalized,
    truncated: value.truncated,
  };
}
