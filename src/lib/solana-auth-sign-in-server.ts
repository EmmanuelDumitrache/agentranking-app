/** Server-only Solana sign-in message helpers (no client imports). */
export const SOLANA_SIGN_IN_PREFIX = "AgentRanking sign-in\n\nWallet: ";
export function parseSolanaSignInIssuedAt(message: string): number | null {
  const issued = message.match(/Issued At:\s*(.+)/i)?.[1]?.trim();
  if (!issued) return null;
  const t = Date.parse(issued);
  return Number.isFinite(t) ? t : null;
}
export function isFreshSolanaSignInTimestamp(
  issuedMs: number,
  nowMs: number = Date.now(),
  windowMs = 20 * 60 * 1000,
): boolean {
  return Math.abs(nowMs - issuedMs) <= windowMs;
}