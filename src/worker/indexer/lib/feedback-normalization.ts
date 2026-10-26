export type FeedbackSource = "site" | "onchain";
function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
export function normalizeFeedbackValue(
  value: number | null | undefined,
  valueDecimals: number | null | undefined,
  source: FeedbackSource = "onchain"
): { displayScore: number; suspicious: boolean; normalizedRaw: number } {
  const raw = Number(value ?? 0);
  const decimals = Math.max(0, Number(valueDecimals ?? 0));
  const normalizedRaw = decimals > 0 ? raw / Math.pow(10, decimals) : raw;
  const score = source === "site" ? (normalizedRaw / 5) * 100 : normalizedRaw;
  return {
    normalizedRaw,
    displayScore: clampScore(score),
    suspicious: !Number.isFinite(normalizedRaw) || normalizedRaw < 0 || score > 100,
  };
}
export function feedbackSourceFromIndex(feedbackIndex: number | null | undefined): FeedbackSource {
  return typeof feedbackIndex === "number" ? "onchain" : "site";
}
