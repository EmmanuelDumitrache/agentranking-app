import { compare, hash } from "bcryptjs";
import { randomBytes } from "node:crypto";

const BACKUP_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10;

function formatCode(raw: Buffer): string {
  // 8 chars from base32-ish alphabet without ambiguous 0/O/1/I
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[raw[i]! % alphabet.length]!;
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(formatCode(randomBytes(8)));
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hash(normalizeBackupCode(code), BCRYPT_ROUNDS)));
}

export function normalizeBackupCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Returns remaining hashes after consuming a matching code, or null if no match.
 */
export async function consumeBackupCode(
  hashes: string[],
  codeInput: string,
): Promise<string[] | null> {
  const normalized = normalizeBackupCode(codeInput);
  if (normalized.length < 8) return null;
  for (let i = 0; i < hashes.length; i += 1) {
    const candidate = hashes[i]!;
    if (await compare(normalized, candidate)) {
      return hashes.filter((_, idx) => idx !== i);
    }
  }
  return null;
}
