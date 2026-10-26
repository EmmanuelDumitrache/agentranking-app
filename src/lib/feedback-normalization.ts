export type FeedbackSource = "site" | "onchain";
export interface NormalizedFeedbackValue {
  raw: number;
  normalizedRaw: number;
  displayScore: number;
  source: FeedbackSource;
  suspicious: boolean;
}
function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
/**
 * Converts mixed feedback sources into a consistent 0-100 display/scoring value.
 *
 * Website feedback is stored as 1-5 stars. `Feedback.value` is already the
 * decimal-adjusted compatibility projection for on-chain rows; `rawValue`,
 * `exactValue`, and `valueDecimals` retain the lossless protocol value. Applying
 * `valueDecimals` to `Feedback.value` again would scale the score twice.
 */
export function normalizeStoredFeedbackValue(
  value: number | null | undefined,
  _valueDecimals: number | null | undefined,
  source: FeedbackSource = "onchain"
): NormalizedFeedbackValue {
  const raw = Number(value ?? 0);
  const normalizedRaw = raw;
  const score = source === "site" ? (normalizedRaw / 5) * 100 : normalizedRaw;
  return {
    raw,
    normalizedRaw,
    displayScore: clampScore(score),
    source,
    suspicious: !Number.isFinite(normalizedRaw) || normalizedRaw < 0 || score > 100,
  };
}
export function feedbackSourceFromIndex(
  feedbackIndex: number | null | undefined,
  sourceRegistry?: string | null,
): FeedbackSource {
  return typeof feedbackIndex === "number" || Boolean(sourceRegistry?.trim())
    ? "onchain"
    : "site";
}
