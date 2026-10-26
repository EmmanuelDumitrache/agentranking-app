/** Clamp to [0, 100] and round to one decimal so list UIs can separate near-perfect agents. */
export function clampTrustScore(raw: number): number {
  const x = Math.max(0, Math.min(100, raw));
  return Math.round(x * 10) / 10;
}
