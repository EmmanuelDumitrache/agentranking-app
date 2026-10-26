export const METAPLEX_TRADEABLE_LAUNCH_STATUSES = new Set([
  "active",
  "live",
  "trading",
  "open",
]);
export function computeMetaplexTradeable(input: {
  tradeUrl?: string | null;
  launchStatus?: string | null;
  hasDexPair?: boolean | null;
}): boolean {
  if (input.tradeUrl?.trim()) return true;
  const status = input.launchStatus?.trim().toLowerCase() ?? "";
  if (status && METAPLEX_TRADEABLE_LAUNCH_STATUSES.has(status)) return true;
  if (input.hasDexPair === true) return true;
  return false;
}