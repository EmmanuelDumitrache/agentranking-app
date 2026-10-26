/** Format a number compactly: 0, 1.2k, 34.5k, 2.3M, etc. */
export function formatCompact(n: number): string {
  if (n === 0 || !Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return n.toLocaleString();
}

/** Format SOL lamports as a human-readable SOL string. Returns "0" if null. */
export function formatSol(lamports: number | null): string {
  if (lamports == null) return "0";
  const sol = lamports / 1_000_000_000;
  if (sol > 0 && sol < 0.0001) return sol.toFixed(6).replace(/\.?0+$/, "") || "0";
  return sol.toFixed(4).replace(/\.?0+$/, "") || "0";
}