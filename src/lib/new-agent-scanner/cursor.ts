export type NewAgentScannerCursor = Readonly<{
  listedAt: Date;
  id: number;
}>;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export function encodeNewAgentScannerCursor(cursor: NewAgentScannerCursor): string {
  if (Number.isNaN(cursor.listedAt.getTime())) {
    throw new Error("New Agent scanner cursor date is invalid");
  }
  if (!Number.isSafeInteger(cursor.id) || cursor.id <= 0) {
    throw new Error("New Agent scanner cursor id must be a positive safe integer");
  }
  return Buffer.from(`${cursor.listedAt.toISOString()}\n${cursor.id}`, "utf8").toString("base64url");
}

export function decodeNewAgentScannerCursor(
  value: string | null | undefined,
): NewAgentScannerCursor | null {
  if (!value || value.length > 256 || !BASE64URL_PATTERN.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== value) return null;
    const decoded = bytes.toString("utf8");
    const [dateValue, idValue, ...extra] = decoded.split("\n");
    if (extra.length > 0 || !dateValue || !POSITIVE_INTEGER_PATTERN.test(idValue ?? "")) return null;
    const listedAt = new Date(dateValue);
    const id = Number(idValue);
    if (!Number.isSafeInteger(id) || id <= 0 || Number.isNaN(listedAt.getTime())) return null;
    // Enforce a canonical UTC timestamp so distinct strings cannot address the
    // same logical page under separate cache keys.
    if (listedAt.toISOString() !== dateValue) return null;
    return { listedAt, id };
  } catch {
    return null;
  }
}
