import { POWER_BOOST_TIERS } from "./product-config";
export { POWER_BOOST_TIERS };
export function computePowerScore(
  _score: number,
  activeBoosts: number,
  voteFireCount: number,
  votePooCount: number
): number {
  const base = activeBoosts;
  void voteFireCount;
  void votePooCount;
  return Math.max(0, Math.round(base));
}
/**
 * Mirrors the rank-projection SQL (before rank reshuffle): power from boosts/votes plus additive admin knob.
 * Organic trust/directory quality is intentionally not a power baseline.
 */
export function previewPersistedListingPowerScore(agent: {
  score: number;
  activeBoosts: number;
  voteFireCount: number;
  votePooCount: number;
  adminPowerAdjust: number;
}): number {
  const base = computePowerScore(agent.score, agent.activeBoosts, agent.voteFireCount, agent.votePooCount);
  return Math.max(0, Math.round(base + Number(agent.adminPowerAdjust ?? 0)));
}
/**
 * Listing power pill only when `powerScore` is backed by paid boosts, admin adjust, or an active
 * AR holder power_boost (see `listingPowerAttributionWhere`). Hides stale rows where `powerScore`
 * was inflated from trust score without any of those signals.
 */
export function hasVisiblePower(agent: {
  powerScore?: number | null;
  activeBoosts?: number | null;
  adminPowerAdjust?: number | null;
  /** Set by list/detail APIs when a holder perk probe row exists. */
  hasHolderPowerBoost?: boolean | null;
}): boolean {
  const ps = Number(agent.powerScore ?? 0);
  if (ps <= 0) return false;
  if (Number(agent.activeBoosts ?? 0) > 0) return true;
  if (Number(agent.adminPowerAdjust ?? 0) !== 0) return true;
  if (agent.hasHolderPowerBoost === true) return true;
  return false;
}
const CHAIN_PAYMENT_LABELS: Record<number, string> = {
  56: "BNB Chain",
  1: "EVM (USDC)",
  137: "EVM (USDC)",
  8453: "EVM (USDC)",
  84532: "EVM (USDC)",
  11155111: "EVM (USDC)",
  100: "EVM (USDC)",
  42161: "EVM (USDC)",
  534352: "EVM (USDC)",
  59144: "EVM (USDC)",
  10: "EVM (USDC)",
  43114: "EVM (USDC)",
  42220: "EVM (USDC)",
  143: "EVM (USDC)",
  167000: "EVM (USDC)",
  9745: "EVM (XPL)",
  4326: "EVM (USDC)",
  2741: "EVM (USDC)",
  2046399126: "EVM (USDC)",
  5000: "EVM (USDC)",
  1868: "EVM (USDC)",
  45056: "EVM (USDC)",
  1776: "EVM (USDC)",
  4217: "EVM (USDC)",
  42: "EVM (USDC)",
  10088: "EVM (USDC)",
  5042002: "EVM (USDC)",
};
export function getPaymentLabel(agent: {
  x402Support?: boolean;
  scoreWallet?: number;
  chainId: number;
}): string | null {
  const chainLabel = CHAIN_PAYMENT_LABELS[agent.chainId] ?? null;
  if (agent.x402Support) {
    return chainLabel ? `x402 · ${chainLabel}` : "x402";
  }
  const hasWallet = (agent.scoreWallet ?? 0) > 0;
  if (!hasWallet) return null;
  return chainLabel ?? "Payment Supported";
}
