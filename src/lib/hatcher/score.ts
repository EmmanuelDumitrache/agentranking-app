import type { HatcherExploreAgent, HatcherMetadata, HatcherPartnerScoreResult } from "@/lib/hatcher/types";
function clampScore(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}
function hasNonEmptyObject(v: unknown): boolean {
  return v != null && typeof v === "object" && Object.keys(v as object).length > 0;
}
/**
 * Partner/discovery score for Hatcher-indexed agents (not on-chain trust).
 * Weights: active +25, public chat +15, messages up to +20, passport +15, MCP +15, profile +10.
 */
export function computeHatcherPartnerScore(input: {
  meta: HatcherMetadata;
  explore?: HatcherExploreAgent;
}): HatcherPartnerScoreResult {
  const { meta, explore } = input;
  const breakdown: Record<string, number> = {};
  const status = meta.status.toLowerCase();
  if (status === "active" || status === "running") {
    breakdown.activeStatus = 25;
  } else if (status === "sleeping" || status === "dormant") {
    breakdown.activeStatus = 8;
  } else {
    breakdown.activeStatus = 0;
  }
  breakdown.publicChat = meta.publicChatEnabled ? 15 : 0;
  const messages = meta.messageCount ?? explore?.messageCount ?? 0;
  let messagePts = 0;
  if (messages > 0) messagePts += 5;
  if (messages >= 50) messagePts += 5;
  if (messages >= 200) messagePts += 10;
  breakdown.messageActivity = Math.min(20, messagePts);
  const passport = meta.passportSnapshot;
  const mcp = meta.mcpManifestSnapshot;
  breakdown.passport = hasNonEmptyObject(passport) ? 15 : 0;
  breakdown.mcpManifest = hasNonEmptyObject(mcp) ? 15 : 0;
  let profile = 0;
  const name = explore?.name ?? "";
  const desc = explore?.description ?? "";
  const avatar = explore?.avatarUrl ?? "";
  if (name.trim()) profile += 3;
  if (desc && String(desc).trim()) profile += 3;
  if (avatar && String(avatar).trim()) profile += 2;
  if (meta.framework.trim()) profile += 1;
  if (meta.template.trim()) profile += 1;
  breakdown.profileCompleteness = Math.min(10, profile);
  if (meta.badge === "verified" || meta.source === "partner_feed") {
    breakdown.partnerFeed = 5;
  } else {
    breakdown.partnerFeed = 0;
  }
  const score = clampScore(Object.values(breakdown).reduce((a, b) => a + b, 0));
  return { score, breakdown };
}
