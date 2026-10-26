/** Message format for optional wallet proof on holder perk allocation. */
export const STAKE_PERK_PREFIX = "AgentRanking holder perk for ";
export function isFreshStakePerkTimestamp(atMs: number, nowMs: number = Date.now(), windowMs = 15 * 60 * 1000): boolean {
  return Math.abs(nowMs - atMs) <= windowMs;
}
export function parseStakePerkMessage(message: string): { wallet: string; atMs: number } | null {
  if (!message.startsWith(STAKE_PERK_PREFIX)) return null;
  const atIdx = message.lastIndexOf(" at ");
  if (atIdx === -1) return null;
  const wallet = message.slice(STAKE_PERK_PREFIX.length, atIdx).trim();
  const atMs = Date.parse(message.slice(atIdx + 4).trim());
  if (!wallet || !Number.isFinite(atMs)) return null;
  return { wallet, atMs };
}