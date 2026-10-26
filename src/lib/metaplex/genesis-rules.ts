/** Allowed sources for metaplexBondingProgressPct — never DexScreener. */
export const METAPLEX_GENESIS_PROGRESS_SOURCES = [
  "metaplex_genesis_api",
  "metaplex_genesis_onchain",
] as const;
export type MetaplexGenesisProgressSource = (typeof METAPLEX_GENESIS_PROGRESS_SOURCES)[number];
export function isMetaplexGenesisProgressSource(
  source: string | null | undefined,
): source is MetaplexGenesisProgressSource {
  if (!source?.trim()) return false;
  return (METAPLEX_GENESIS_PROGRESS_SOURCES as readonly string[]).includes(source.trim());
}
/** True only when pct may be shown in UI (official Genesis source). */
export function hasRealMetaplexBondingProgress(input: {
  bondingProgressPct?: number | null;
  bondingProgressSource?: string | null;
}): boolean {
  if (input.bondingProgressPct == null || !Number.isFinite(input.bondingProgressPct)) {
    return false;
  }
  return isMetaplexGenesisProgressSource(input.bondingProgressSource);
}
/** Graduated launches keep status but must not retain stale fill %. */
export function shouldClearBondingProgress(launchStatus: string | null | undefined): boolean {
  const s = launchStatus?.trim().toLowerCase() ?? "";
  return s === "graduated" || s === "completed" || s === "ended";
}
export function normalizeBondingProgressPct(
  pct: number | null | undefined,
  launchStatus: string | null | undefined,
  source: string | null | undefined,
): number | null {
  if (!isMetaplexGenesisProgressSource(source)) return null;
  if (shouldClearBondingProgress(launchStatus)) return null;
  if (pct == null || !Number.isFinite(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}