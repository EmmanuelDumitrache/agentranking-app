import { timingSafeEqual } from "node:crypto";

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function isInternalBearerSecretConfigured(
  secret: string | null | undefined,
  minimumLength = 24,
): boolean {
  const value = secret?.trim() ?? "";
  return value.length >= minimumLength;
}

export function verifyInternalBearer(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined,
  minimumLength = 24,
): boolean {
  const expected = secret?.trim() ?? "";
  if (!isInternalBearerSecretConfigured(expected, minimumLength)) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader?.trim() ?? "");
  const supplied = match?.[1]?.trim() ?? "";
  if (!supplied) return false;
  return constantTimeEqual(supplied, expected);
}

export function constantTimeHexEqual(
  suppliedValue: string | null | undefined,
  expectedHex: string,
): boolean {
  const supplied = (suppliedValue?.trim() ?? "").replace(/^sha256=/i, "").toLowerCase();
  const expected = expectedHex.trim().toLowerCase();
  if (!/^[a-f0-9]+$/.test(supplied) || !/^[a-f0-9]+$/.test(expected)) return false;
  const suppliedBytes = Buffer.from(supplied, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  if (suppliedBytes.byteLength !== expectedBytes.byteLength) return false;
  return timingSafeEqual(suppliedBytes, expectedBytes);
}
