import type { RiskTier } from "./providers/types";

export type CardTierLimitTable = Record<RiskTier, number>;

const DEFAULT_TIER_LIMITS: CardTierLimitTable = {
  UNRATED: 0,
  BASIC: 250,
  STANDARD: 1_000,
  ELEVATED: 5_000,
  PRIVILEGED: 25_000,
};

/** Daily USD spend cap per risk tier — shared by mock, Stripe Issuing, and Bridge issuers. */
export function parseCardTierLimitTable(): CardTierLimitTable {
  const raw = process.env.CARD_ISSUER_TIER_LIMITS_JSON?.trim();
  if (!raw) return { ...DEFAULT_TIER_LIMITS };
  try {
    const parsed = JSON.parse(raw) as Partial<CardTierLimitTable>;
    return { ...DEFAULT_TIER_LIMITS, ...parsed };
  } catch {
    return { ...DEFAULT_TIER_LIMITS };
  }
}

export function maxDailyLimitUsdForTier(tier: RiskTier): number {
  const limits = parseCardTierLimitTable();
  return limits[tier] ?? 0;
}
