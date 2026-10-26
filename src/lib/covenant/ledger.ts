/** Best-effort ledger account decode (SAP append-only ledger; layout may evolve). */
const ANCHOR_DISCRIMINATOR_LEN = 8;
const CONTENT_HASH_LEN = 32;
export type DecodedLedgerSnapshot = {
  contentHashHex: string;
  releaseTarget: string | null;
  rawDataLen: number;
};
/**
 * Attempt to read a 32-byte content hash from ledger account data.
 * Falls back to last 32 bytes when structured layout is unknown.
 */
export function decodeLedgerAccountData(data: Buffer): DecodedLedgerSnapshot | null {
  if (data.length < ANCHOR_DISCRIMINATOR_LEN + CONTENT_HASH_LEN) return null;
  let contentHash: Buffer | null = null;
  let releaseTarget: string | null = null;
  if (data.length >= ANCHOR_DISCRIMINATOR_LEN + CONTENT_HASH_LEN) {
    contentHash = data.subarray(ANCHOR_DISCRIMINATOR_LEN, ANCHOR_DISCRIMINATOR_LEN + CONTENT_HASH_LEN);
  }
  const jsonStart = data.indexOf(0x7b, ANCHOR_DISCRIMINATOR_LEN + CONTENT_HASH_LEN);
  if (jsonStart >= 0) {
    try {
      const tail = data.subarray(jsonStart).toString("utf8").replace(/\0/g, "").trim();
      const brace = tail.indexOf("}");
      if (brace >= 0) {
        const parsed = JSON.parse(tail.slice(0, brace + 1)) as Record<string, unknown>;
        const target =
          typeof parsed.target === "string"
            ? parsed.target
            : typeof parsed.release_target === "string"
              ? parsed.release_target
              : null;
        if (target?.trim()) releaseTarget = target.trim();
      }
    } catch {
      /* ignore JSON tail parse */
    }
  }
  if (!contentHash || contentHash.every((b) => b === 0)) {
    const tail = data.subarray(Math.max(0, data.length - CONTENT_HASH_LEN));
    if (tail.length === CONTENT_HASH_LEN && !tail.every((b) => b === 0)) {
      contentHash = tail;
    } else {
      return null;
    }
  }
  return {
    contentHashHex: Buffer.from(contentHash).toString("hex"),
    releaseTarget,
    rawDataLen: data.length,
  };
}
export function isValidRootHashHex(hex: string): boolean {
  return /^[0-9a-f]{64}$/.test(hex.trim().toLowerCase());
}
export function normalizeRootHashHex(hex: string): string {
  return hex.trim().toLowerCase();
}