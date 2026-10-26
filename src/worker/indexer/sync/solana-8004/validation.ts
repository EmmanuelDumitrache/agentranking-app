import { PublicKey } from "@solana/web3.js";

export function requirePublicKey(value: string, label: string): string {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`${label} is not a canonical Solana public key`);
  }
}

export function validateBoundedUtf8(value: string, label: string, maxBytes: number): string {
  if (value.includes("\0")) throw new Error(`${label} contains a NUL byte`);
  const normalized = value.normalize("NFC").trim();
  if (Buffer.byteLength(normalized, "utf8") > maxBytes) throw new Error(`${label} exceeds ${maxBytes} UTF-8 bytes`);
  return normalized;
}

export function validateRegistrationUri(value: string | null): string | null {
  if (!value) return null;
  const uri = validateBoundedUtf8(value, "Solana 8004 registration URI", 250);
  if (!uri) return null;
  if (/[\u0000-\u001f\u007f]/.test(uri)) throw new Error("Solana 8004 registration URI contains control characters");
  return uri;
}
