import type { CSSProperties } from "react";
import {
  computeSocialScore,
  scoreComplianceDimension,
  scoreEndpointsDimension,
  scoreWeightPercent,
} from "@/lib/agent-score";
/** Agent shape returned by GET /api/agents in listView + compare=1 mode */
export interface CompareAgent {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  description?: string;
  image: string;
  score: number;
  rank?: number;
  totalFeedback: number;
  scoreMetadata?: number;
  scoreServices?: number;
  scoreQuality?: number;
  scorePopularity?: number;
  scoreActivity?: number;
  scoreWallet?: number;
  scoreFreshness?: number;
  x402Support?: boolean;
  binanceCompatible?: boolean;
  isVerified?: boolean;
  isPremiumVerified?: boolean;
  isVerifiedRevenue?: boolean;
  slug?: string | null;
  profilePath: string;
  agentMode?: string;
  agentRankScore?: number;
  protocolTrustScore?: number;
  executionScore?: number;
  perfWinRate?: number | null;
  perfMonthlyPnlUsd?: number | null;
  perfBurnToEarnRatio?: number | null;
  perfTotalVolumeUsd?: number | null;
  activeWinRate30d?: number | null;
  nativeVolume30d?: number | null;
  perfTxCount?: number | null;
  perfLastComputedAt?: string | null;
  owner?: string;
  verifiedWallet?: string | null;
  chain: { name: string; shortName: string; color: string; icon: string };
  services?: Array<{ name: string; endpoint: string }>;
  metadata?: Array<{ key: string; value: string }>;
}

export type CompareAgentReference = {
  chainId: number;
  agentId: number;
};
export function parseCompareAgentReference(value: string | null | undefined): CompareAgentReference | null {
  const match = /^(\d+):(\d+)$/.exec((value ?? "").trim());
  if (!match) return null;
  const chainId = Number.parseInt(match[1], 10);
  const agentId = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return null;
  if (!Number.isSafeInteger(agentId) || agentId < 0) return null;
  return { chainId, agentId };
}
export function compareAgentReference(agent: Pick<CompareAgent, "chainId" | "agentId">): string {
  return `${agent.chainId}:${agent.agentId}`;
}
export type TrustDimKey =
  | "metadata"
  | "endpoints"
  | "social"
  | "compliance"
  | "quality"
  | "popularity"
  | "freshness";
export function trustDimensionValue(agent: CompareAgent, dim: TrustDimKey): number {
  const meta = agent.metadata ?? [];
  const svcs = (agent.services ?? []).map((s) => ({
    name: s.name,
    endpoint: s.endpoint ?? "",
  }));
  switch (dim) {
    case "metadata":
      return Math.min(100, agent.scoreMetadata ?? 0);
    case "endpoints": {
      const db = agent.scoreServices;
      if (db != null && db > 0) return Math.min(100, db);
      return scoreEndpointsDimension(svcs);
    }
    case "social":
      return Math.min(100, computeSocialScore(meta, svcs).score);
    case "compliance":
      return scoreComplianceDimension(
        agent.scoreWallet ?? 0,
        agent.x402Support ?? false,
        agent.binanceCompatible ?? false,
      );
    case "quality":
      return Math.min(100, agent.scoreQuality ?? 0);
    case "popularity":
      return Math.min(100, agent.scorePopularity ?? 0);
    case "freshness":
      return Math.min(100, agent.scoreFreshness ?? 0);
    default:
      return 0;
  }
}
export const TRUST_COMPARE_ROWS: Array<{ label: string; dim: TrustDimKey }> = [
  { label: `Metadata (${scoreWeightPercent("metadata")})`, dim: "metadata" },
  { label: `Endpoints (${scoreWeightPercent("endpoints")})`, dim: "endpoints" },
  { label: `Social (${scoreWeightPercent("social")})`, dim: "social" },
  { label: `Compliance (${scoreWeightPercent("compliance")})`, dim: "compliance" },
  { label: `Feedback quality (${scoreWeightPercent("quality")})`, dim: "quality" },
  { label: `Popularity (${scoreWeightPercent("popularity")})`, dim: "popularity" },
  { label: `Freshness (${scoreWeightPercent("freshness")})`, dim: "freshness" },
];
/** Gradient text for premium-verified names (inline style object) */
export const COMPARE_PREMIUM_NAME_STYLE: CSSProperties = {
  background: "linear-gradient(90deg,#f59e0b,#fbbf24,#f59e0b)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  fontWeight: 700,
};
