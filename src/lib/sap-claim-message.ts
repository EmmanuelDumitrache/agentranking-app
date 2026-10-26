/** Shared with client — no Node/crypto imports. */
export const SAP_CLAIM_PREFIX = "Claim AgentRanking profile for ";
export function buildSapClaimMessage(sapAgentPda: string, timestampIso: string): string {
  return `${SAP_CLAIM_PREFIX}${sapAgentPda} at ${timestampIso}`;
}
export function parseSapClaimMessage(message: string): { pda: string; atMs: number } | null {
  if (!message.startsWith(SAP_CLAIM_PREFIX)) return null;
  const atIdx = message.lastIndexOf(" at ");
  if (atIdx === -1) return null;
  const pda = message.slice(SAP_CLAIM_PREFIX.length, atIdx).trim();
  const tsStr = message.slice(atIdx + 4).trim();
  const atMs = Date.parse(tsStr);
  if (!pda || !Number.isFinite(atMs)) return null;
  return { pda, atMs };
}
export function isFreshClaimTimestamp(atMs: number, nowMs: number = Date.now(), windowMs = 15 * 60 * 1000): boolean {
  return Math.abs(nowMs - atMs) <= windowMs;
}
export function normalizeSolanaAddress(addr: string): string {
  return addr.trim();
}