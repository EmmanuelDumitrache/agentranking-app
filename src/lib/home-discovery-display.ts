/**
 * Homepage discovery table display helpers — AR vs protocol trust vs organic rank.
 */
import { protocolTrustBand } from "@/lib/agent-rankable";
export const HOME_AR_SCORE_TOOLTIP =
  "Composite score from profile quality, protocol trust, reputation, and activity.";
export const HOME_TRUST_TOOLTIP =
  "Trust level from verification and protocol signals — not the same as AR Score.";
export const HOME_RANK_TOOLTIP_ORGANIC =
  "Organic rank by AR Score. Rank appears after the next organic ranking snapshot.";
export const HOME_RANK_TOOLTIP_NEW =
  "Recently listed — organic rank pending the next ranking snapshot.";
export const HOME_RANK_TOOLTIP_UNRANKED =
  "Unranked or not yet in the organic ranking cohort.";
const DEFAULT_LISTED_WITHIN_DAYS = 7;
const COMPACT_RANK_THRESHOLD = 1_000;
export type HomeDiscoveryAgent = {
  rank?: number | null;
  organicRank?: number | null;
  agentRankScore?: number | null;
  protocolTrustScore?: number | null;
  isVerified?: boolean | null;
  isPremiumVerified?: boolean | null;
  listedAt?: string | Date | null;
  createdAt?: string | Date | null;
};
/** Public AR composite (0–100). Never use protocolTrustScore or DB protocolTrustScore alone. */
export function homeArScore(agent: HomeDiscoveryAgent): number {
  const raw = Math.round(agent.agentRankScore ?? 0);
  return Math.max(0, Math.min(100, raw));
}
/** True when no composite score fields are present. */
export function homeArScoreIsEmpty(agent: HomeDiscoveryAgent): boolean {
  return (agent.agentRankScore ?? 0) <= 0;
}
/** Protocol trust sub-score for Trust band (0–100). */
export function homeProtocolTrustScore(agent: HomeDiscoveryAgent): number {
  const raw = Math.round(agent.protocolTrustScore ?? 0);
  return Math.max(0, Math.min(100, raw));
}
export type HomeTrustLabel = "Verified" | "Low" | "Medium" | "High";
/** Table Trust column: Verified for KYA, else protocol trust band. */
export function homeTrustDisplayLabel(agent: HomeDiscoveryAgent): HomeTrustLabel {
  if (agent.isVerified || agent.isPremiumVerified) return "Verified";
  return protocolTrustBand(homeProtocolTrustScore(agent));
}
function parseListedAt(agent: HomeDiscoveryAgent): Date | null {
  const raw = agent.listedAt ?? agent.createdAt;
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function isListedWithinDays(
  agent: HomeDiscoveryAgent,
  withinDays = DEFAULT_LISTED_WITHIN_DAYS,
  now = Date.now(),
): boolean {
  const listed = parseListedAt(agent);
  if (!listed) return false;
  const ms = withinDays * 24 * 60 * 60 * 1000;
  return now - listed.getTime() <= ms;
}
const HOME_HERO_METRIC_K_THRESHOLD = 1_000;
/** Compact hero stat (e.g. 174k agents). Full value should go in `title`. */
export function formatHomeHeroMetric(value: number): { display: string; full: string } {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const full = n.toLocaleString("en-US");
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    const display =
      m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`;
    return { display, full };
  }
  if (n >= HOME_HERO_METRIC_K_THRESHOLD) {
    const k = n / 1000;
    const display =
      k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, "")}k`;
    return { display, full };
  }
  return { display: String(n), full };
}
/** Compact display for large global ranks (e.g. #184k, #6.1k). */
export function formatCompactOrganicRank(rank: number): string {
  const n = Math.max(1, Math.round(rank));
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `#${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (n >= COMPACT_RANK_THRESHOLD) {
    const k = n / 1000;
    return `#${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `#${n.toLocaleString("en-US")}`;
}
export type HomeOrganicRankLabelResult = {
  label: string;
  title: string;
  /** Muted styling for huge rank numbers */
  compact?: boolean;
};
/**
 * Organic rank display for homepage rows — never use list index as rank.
 */
export function homeOrganicRankLabel(
  agent: HomeDiscoveryAgent,
  options?: { listedWithinDays?: number; now?: number },
): HomeOrganicRankLabelResult {
  const rank = Math.max(0, Math.round(Number(agent.organicRank ?? agent.rank ?? 0)));
  if (rank > 0) {
    const compact = rank >= COMPACT_RANK_THRESHOLD;
    return {
      label: formatCompactOrganicRank(rank),
      title: HOME_RANK_TOOLTIP_ORGANIC,
      compact,
    };
  }
  const withinDays = options?.listedWithinDays ?? DEFAULT_LISTED_WITHIN_DAYS;
  if (isListedWithinDays(agent, withinDays, options?.now)) {
    return {
      label: "New",
      title: HOME_RANK_TOOLTIP_NEW,
    };
  }
  return {
    label: "—",
    title: HOME_RANK_TOOLTIP_UNRANKED,
  };
}
