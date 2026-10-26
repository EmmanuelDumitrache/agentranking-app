/**
 * Canonical agent scoring module.
 * erc8004-sync, register/custom-listing routes, worker sync, and recompute scripts
 * consumes the pure shared implementation from packages/agent-domain.
 *
 * Weights: use AGENT_SCORE_WEIGHTS (substance-first: lower popularity/freshness).
 * Compliance points inside each dimension: wallet(25) + x402(35) + binanceCompatible(25).
 */
import {
  applyParsedTrustDimensionOverrides,
  parseAdminTrustDimensionOverrides,
  type AdminTrustDimensionKey,
} from "@/lib/admin-trust-dimension-overrides";
import {
  AGENT_SCORE_WEIGHTS,
  computeAgentScore,
  computeSocialScore,
  protocolTrustScoreFromDimensions,
  scoreComplianceDimension,
  scoreEndpointsDimension,
  scoreMetadataDimension,
  scoreVerifiedRevenueDimension,
  scoreWeightPercent,
  type AgentScoreInput,
  type AgentScoreResult,
  type AgentScoreWeightKey,
  type TrustDimensionValues,
} from "../../packages/agent-domain/src/agent-score";
export {
  AGENT_SCORE_WEIGHTS,
  computeAgentScore,
  computeSocialScore,
  protocolTrustScoreFromDimensions,
  scoreComplianceDimension,
  scoreEndpointsDimension,
  scoreMetadataDimension,
  scoreVerifiedRevenueDimension,
  scoreWeightPercent,
};
export type { AgentScoreInput, AgentScoreResult, AgentScoreWeightKey, TrustDimensionValues };
/** Minimal agent shape for trust breakdown (matches agent detail + list rows). */
export type TrustBreakdownAgentInput = {
  scoreMetadata?: number | null;
  scoreServices?: number | null;
  scoreSocial?: number | null;
  scoreWallet?: number | null;
  scoreQuality?: number | null;
  scorePopularity?: number | null;
  scoreFreshness?: number | null;
  x402Support?: boolean | null;
  binanceCompatible?: boolean | null;
  metadata?: Array<{ key: string; value: string }> | null;
  services?: Array<{ name: string; endpoint?: string | null }> | null;
  isVerifiedRevenue?: boolean | null;
  perfWinRate?: number | null;
  perfMonthlyPnlUsd?: number | null;
  perfBurnToEarnRatio?: number | null;
};
/**
 * Eight trust dimensions exactly as on the agent profile breakdown (incl. endpoint live fallback
 * and verified-revenue dimension when perf fields are present).
 */
export function computeTrustBreakdownDimensions(agent: TrustBreakdownAgentInput): TrustDimensionValues {
  const socialLive = computeSocialScore(
    agent.metadata ?? [],
    (agent.services ?? []).map((s) => ({ name: s.name, endpoint: s.endpoint ?? "" })),
  );
  const compliancePts = scoreComplianceDimension(
    agent.scoreWallet ?? 0,
    agent.x402Support ?? false,
    agent.binanceCompatible ?? false,
  );
  const svcForEndpoints = (agent.services ?? []).map((s) => ({
    name: s.name,
    endpoint: s.endpoint ?? "",
  }));
  const scoreSvc = agent.scoreServices;
  const endpointDb =
    scoreSvc != null && scoreSvc > 0
      ? Math.min(100, scoreSvc)
      : scoreEndpointsDimension(svcForEndpoints);
  const verifiedRevenue = scoreVerifiedRevenueDimension({
    isVerifiedRevenue: agent.isVerifiedRevenue ?? undefined,
    perfWinRate: agent.perfWinRate ?? undefined,
    perfMonthlyPnlUsd: agent.perfMonthlyPnlUsd ?? undefined,
    perfBurnToEarnRatio: agent.perfBurnToEarnRatio ?? undefined,
  });
  return {
    metadata: Math.min(100, agent.scoreMetadata ?? 0),
    endpoints: endpointDb,
    social: Math.min(100, agent.scoreSocial ?? socialLive.score),
    compliance: compliancePts,
    quality: Math.min(100, agent.scoreQuality ?? 0),
    popularity: Math.min(100, agent.scorePopularity ?? 0),
    freshness: Math.min(100, agent.scoreFreshness ?? 0),
    verifiedRevenue,
  };
}
/**
 * Canonical protocol-trust score from the agent's stored and derived dimensions.
 * This matches the agent detail breakdown and applies administrative per-dimension overrides.
 * Pass `trustDimMerged` when overrides were loaded separately from the metadata relation.
 */
export function computeProtocolTrustScoreFromAgentDimensions(
  agent: TrustBreakdownAgentInput,
  trustDimMerged?: Partial<Record<AdminTrustDimensionKey, number>> | null,
): number {
  const base = computeTrustBreakdownDimensions(agent);
  const fromMeta = parseAdminTrustDimensionOverrides(agent.metadata);
  const merged =
    trustDimMerged != null && Object.keys(trustDimMerged).length > 0
      ? { ...fromMeta, ...trustDimMerged }
      : fromMeta;
  return protocolTrustScoreFromDimensions(applyParsedTrustDimensionOverrides(base, merged));
}
/** Linked execution wallet (product / challenge path). */
function hasLinkedVerifiedWallet(w: string | null | undefined): boolean {
  return (w ?? "").trim().length > 0;
}
/**
 * `agentWallet` from ERC-8004 registration JSON / metadata (EVM or Solana-shaped).
 * Used for execution evidence when `verifiedWallet` is not set.
 */
export function parseAgentWalletFromMetadata(
  metadata: Array<{ key: string; value: string }> | null | undefined
): string | undefined {
  if (!metadata?.length) return undefined;
  const raw = metadata.find((m) => m.key === "agentWallet")?.value?.trim();
  if (!raw) return undefined;
  if (/^0x[a-fA-F0-9]{40}$/i.test(raw)) return raw;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) return raw;
  return undefined;
}
export type ComputeExecutionScoreInput = {
  isVerifiedRevenue?: boolean;
  perfWinRate?: number | null;
  perfMonthlyPnlUsd?: number | null;
  perfBurnToEarnRatio?: number | null;
  activeWinRate30d?: number | null;
  nativeVolume30d?: number | null;
  /** Linked execution wallet (verified). */
  verifiedWallet?: string | null;
  /** Registry dimension: on-chain `agentWallet` set on identity (0–100 in sync). */
  scoreWallet?: number | null;
  /** Denormalized transfer / snapshot tx count. */
  perfTxCount?: number | null;
  metadata?: Array<{ key: string; value: string }> | null;
};
/**
 * Execution tier (0–100): perf pipeline + heuristic swap rollups.
 */
function computeExecutionPerformanceTier(agent: ComputeExecutionScoreInput): number {
  const winRate = agent.perfWinRate ?? agent.activeWinRate30d ?? 0;
  const hasVol =
    agent.nativeVolume30d != null &&
    Number.isFinite(agent.nativeVolume30d) &&
    agent.nativeVolume30d > 0;
  if (!agent.isVerifiedRevenue && winRate === 0 && !hasVol) return 0;
  const winPts = Math.min(50, winRate * 100 * 0.5);
  const pnlPts = (agent.perfMonthlyPnlUsd ?? 0) > 0 ? 30 : 0;
  const burnRatio = agent.perfBurnToEarnRatio ?? null;
  const burnPts = burnRatio != null ? Math.max(0, 20 - burnRatio * 6) : 0;
  return Math.min(100, Math.round(winPts + pnlPts + burnPts));
}
/**
 * Metadata tier (0–42): real on-chain signals without requiring USD PnL —
 * verified execution wallet, registry `agentWallet`, perf tx volume proxy, verified-revenue flag.
 */
function computeExecutionEvidenceTier(agent: ComputeExecutionScoreInput): number {
  let pts = 0;
  if (hasLinkedVerifiedWallet(agent.verifiedWallet)) pts += 22;
  else if (parseAgentWalletFromMetadata(agent.metadata)) pts += 16;
  const sw = Math.min(100, Math.max(0, agent.scoreWallet ?? 0));
  if (sw > 0) pts += Math.round(sw * 0.16);
  const tx = agent.perfTxCount ?? 0;
  if (tx > 0) pts += Math.min(14, 5 + Math.min(9, Math.floor(tx / 4)));
  if (agent.isVerifiedRevenue) pts += 8;
  return Math.min(42, pts);
}
/**
 * Execution Score (0–100): max(performance tier, evidence tier), capped at 100.
 * - **Execution**: win rate / volume / PnL / burn from perf* and heuristic activity.
 * - **Metadata**: linked wallets, registry wallet field, tx-count proxy, verified revenue.
 * Stored as Agent.executionScore; refresh via backfill + compute-perf-snapshots + list API live merge.
 */
export function computeExecutionScore(agent: ComputeExecutionScoreInput): number {
  const execution = computeExecutionPerformanceTier(agent);
  const metadata = computeExecutionEvidenceTier(agent);
  return Math.min(100, Math.max(execution, metadata));
}
