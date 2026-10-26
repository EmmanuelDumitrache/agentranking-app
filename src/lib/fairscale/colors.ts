/** FairScale tier chrome — metallic badges, never inject raw API color strings. */

export type FairscaleTierKind = "bronze" | "silver" | "gold" | "platinum";

export function resolveFairscaleTierKind(
  tier: string | null | undefined,
): FairscaleTierKind | null {
  const t = (tier ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("platinum")) return "platinum";
  if (t.includes("gold")) return "gold";
  if (t.includes("silver")) return "silver";
  if (t.includes("bronze")) return "bronze";
  return null;
}

const TIER_BADGE_BASE =
  "inline-flex h-5 items-center rounded px-2 text-[10px] font-semibold uppercase tracking-[0.08em] leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_1px_2px_rgba(0,0,0,0.35)]";

/** Metallic pill for FairScale bronze / silver / gold / platinum. */
export function fairscaleTierBadgeClassName(tier: string | null | undefined): string {
  const kind = resolveFairscaleTierKind(tier);
  switch (kind) {
    case "bronze":
      return `${TIER_BADGE_BASE} border border-[#f5c9a0]/55 bg-gradient-to-br from-[#ffc48a] via-[#d98a45] to-[#9a5520] text-[#2a1408]`;
    case "silver":
      return `${TIER_BADGE_BASE} border border-white/60 bg-gradient-to-br from-[#ffffff] via-[#d4d8e0] to-[#9399a5] text-[#1a1c20]`;
    case "gold":
      return `${TIER_BADGE_BASE} border border-[#ffeeb8]/60 bg-gradient-to-br from-[#ffe97a] via-[#e0bc40] to-[#a07a18] text-[#2a1f05]`;
    case "platinum":
      return `${TIER_BADGE_BASE} border border-white/70 bg-gradient-to-br from-[#ffffff] via-[#e8f0f8] to-[#9aadc0] text-[#15202b]`;
    default:
      return `${TIER_BADGE_BASE} border border-border/70 bg-muted/60 text-foreground/80`;
  }
}

/** @deprecated Prefer fairscaleTierBadgeClassName for scored tiers. */
export function fairscaleRecommendationClassName(input: {
  recommendationTier?: string | null;
  recommendationLabel?: string | null;
}): string {
  const kind = resolveFairscaleTierKind(input.recommendationTier);
  switch (kind) {
    case "gold":
    case "platinum":
      return "text-amber-300";
    case "silver":
      return "text-slate-300";
    case "bronze":
      return "text-orange-400";
    default: {
      const label = (input.recommendationLabel ?? "").toLowerCase();
      if (label.includes("trusted")) return "text-emerald-400";
      if (label.includes("caution")) return "text-amber-400";
      if (label.includes("high risk")) return "text-orange-400";
      if (label.includes("unverified")) return "text-muted-foreground";
      return "text-foreground/80";
    }
  }
}
