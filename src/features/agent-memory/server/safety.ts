import "server-only";

const MEMORY_SECRET_PATTERNS = [
  /\b(private key|seed phrase|recovery phrase|mnemonic)\b/i,
  /\b(password|passphrase|api key|secret key|access token|refresh token|bearer token)\b\s*(?:is|=|:)\s*\S+/i,
  /\b(ignore|override|bypass)\b.{0,40}\b(system|developer|security|policy|instructions?)\b/i,
  /\b0x[A-Fa-f0-9]{64}\b/,
  /\b[A-Fa-f0-9]{64}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\[(?:\s*\d{1,3}\s*,){31,}\s*\d{1,3}\s*\]/,
] as const;

export function isSafeMemoryContent(content: string): boolean {
  return !MEMORY_SECRET_PATTERNS.some((pattern) => pattern.test(content));
}
