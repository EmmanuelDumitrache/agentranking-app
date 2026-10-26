import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPublicSiteUrl } from "@/lib/site-url";
import { computeProtocolTrustScoreFromAgentDimensions, computeExecutionScore } from "@/lib/agent-score";
import { getAgentBlocklistRuleDelegate } from "@/lib/agent-blocklist";
import {
  normalizeWallet,
  computeRecommendation,
  verificationTier,
  type ReportCounts,
  type TrustOraclePayload,
} from "@/lib/trust-oracle-logic";
import { agentPublicPath, agentPublicUrl, toAgentUrlSlug } from "@/lib/agent-public-url";
// Re-export pure-logic types and helpers so callers don't need to know about
// the split (the server-only boundary is an implementation detail).
export {
  EVM_WALLET_RE,
  SOLANA_WALLET_RE,
  InvalidWalletError,
  classifyWallet,
  normalizeWallet,
  computeRecommendation,
  verificationTier,
} from "@/lib/trust-oracle-logic";
export type {
  WalletKind,
  Recommendation,
  VerificationTier,
  ReportCounts,
  RecommendationInput,
  VerificationFlags,
  TrustOraclePayload,
} from "@/lib/trust-oracle-logic";
/**
 * Trust Oracle — server-side orchestrator.
 *
 * Used by:
 *   - GET /api/v1/reputation/[wallet]
 *
 * Design notes:
 *   - Unregistered wallets do NOT throw: they return a well-formed payload with
 *     `isRegistered: false` and `recommendation: 'caution'` so LLM callers get
 *     a consistent signal to show humans and other agents.
 *   - Invalid wallet format throws `InvalidWalletError` — callers map to HTTP 400.
 *   - We never include PII or IP hashes from AgentReport rows.
 */
/** Columns needed to compute protocolTrustScore + recommendation without N+1 queries. */
const ORACLE_AGENT_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  owner: true,
  isActive: true,
  isVerified: true,
  isPremiumVerified: true,
  isVerifiedRevenue: true,
  verifiedWallet: true,
  verifiedWalletAt: true,
  lastActiveAt: true,
  activityUpdatedAt: true,
  x402Support: true,
  protocolTrustScore: true,
  executionScore: true,
  scoreWallet: true,
  scoreMetadata: true,
  scoreServices: true,
  scoreQuality: true,
  scorePopularity: true,
  scoreFreshness: true,
  perfWinRate: true,
  perfMonthlyPnlUsd: true,
  perfBurnToEarnRatio: true,
  perfTxCount: true,
  activeWinRate30d: true,
  nativeVolume30d: true,
  metadata: { select: { key: true, value: true } },
} satisfies Prisma.AgentSelect;
type OracleAgentRow = Prisma.AgentGetPayload<{ select: typeof ORACLE_AGENT_SELECT }>;
/**
 * Prefer an agent whose **execution wallet** matches (crypto-linked) over one
 * that only matches via `owner` (self-declared registration payer).
 */
export async function lookupAgentByWallet(wallet: string): Promise<OracleAgentRow | null> {
  const { normalized, kind } = normalizeWallet(wallet);
  // Case handling:
  //   EVM: DB may store mixed-case owners — use insensitive `equals`.
  //   Solana: base58 is case-sensitive; exact equality.
  const eqMode =
    kind === "evm"
      ? ({ equals: normalized, mode: "insensitive" as const })
      : { equals: normalized };
  const walletFilter: Prisma.StringFilter = eqMode;
  const verifiedMatch = await prisma.agent.findFirst({
    where: { isActive: true, verifiedWallet: walletFilter },
    orderBy: [{ executionScore: "desc" }, { score: "desc" }],
    select: ORACLE_AGENT_SELECT,
  });
  if (verifiedMatch) return verifiedMatch;
  const ownerMatch = await prisma.agent.findFirst({
    where: { isActive: true, owner: walletFilter },
    orderBy: [{ protocolTrustScore: "desc" }, { score: "desc" }],
    select: ORACLE_AGENT_SELECT,
  });
  return ownerMatch;
}
export async function countReports(agentDbId: number): Promise<ReportCounts> {
  const [open, reviewed] = await Promise.all([
    prisma.agentReport.count({ where: { agentDbId, status: "open" } }),
    prisma.agentReport.count({ where: { agentDbId, status: "reviewed" } }),
  ]);
  return { open, reviewed, total: open + reviewed };
}
/** Blocklist check — always safe when the generated Prisma client is stale. */
export async function isBlocklisted(wallet: string): Promise<boolean> {
  const { normalized, kind } = normalizeWallet(wallet);
  const delegate = getAgentBlocklistRuleDelegate();
  if (!delegate) return false;
  const rules = await delegate.findMany({
    where: { active: true, matchType: "owner_wallet" },
    select: { id: true, matchType: true, value: true, active: true },
  });
  if (rules.length === 0) return false;
  return rules.some((r) => {
    const v = r.value.trim();
    if (!v) return false;
    if (kind === "evm") return v.toLowerCase() === normalized;
    return v === normalized;
  });
}
function daysSince(date: Date | null): number | null {
  if (!date) return null;
  const ms = Date.now() - date.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}
function pickLastActivity(agent: OracleAgentRow): Date | null {
  const candidates = [agent.activityUpdatedAt, agent.verifiedWalletAt, agent.lastActiveAt];
  let latest: Date | null = null;
  for (const d of candidates) {
    if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
  }
  return latest;
}
function resolveTrustScore(agent: OracleAgentRow): number {
  // Prefer the stored protocolTrustScore (backfill + live pipeline); fall back to a live
  // compute so freshly-indexed agents still get a usable score.
  const base = agent.protocolTrustScore > 0
    ? agent.protocolTrustScore
    : computeProtocolTrustScoreFromAgentDimensions({
        scoreMetadata: agent.scoreMetadata,
        scoreServices: agent.scoreServices,
        scoreWallet: agent.scoreWallet,
        scoreQuality: agent.scoreQuality,
        scorePopularity: agent.scorePopularity,
        scoreFreshness: agent.scoreFreshness,
        x402Support: agent.x402Support,
        binanceCompatible: false,
        metadata: agent.metadata,
        services: [],
      });
  const live = computeExecutionScore({
    isVerifiedRevenue: agent.isVerifiedRevenue,
    perfWinRate: agent.perfWinRate,
    perfMonthlyPnlUsd: agent.perfMonthlyPnlUsd,
    perfBurnToEarnRatio: agent.perfBurnToEarnRatio,
    activeWinRate30d: agent.activeWinRate30d,
    nativeVolume30d: agent.nativeVolume30d,
    verifiedWallet: agent.verifiedWallet,
    scoreWallet: agent.scoreWallet,
    perfTxCount: agent.perfTxCount,
    metadata: agent.metadata,
  });
  const onchain = Math.max(agent.executionScore ?? 0, live);
  // Blend: identity/profile dominates baseline, onchain nudges upward.
  // Clamp to [0, 100] — agent-score pipeline already clamps the inputs.
  const blended = Math.round(base * 0.8 + onchain * 0.2);
  return Math.max(0, Math.min(100, blended));
}
/**
 * Build the public Trust Oracle payload for a wallet.
 *
 * Throws `InvalidWalletError` for malformed input. Unregistered wallets return
 * `isRegistered: false` with `recommendation: 'caution'` (never 404).
 */
export async function buildTrustOraclePayload(rawWallet: string): Promise<TrustOraclePayload> {
  const { normalized } = normalizeWallet(rawWallet);
  const [agent, blocklisted] = await Promise.all([
    lookupAgentByWallet(normalized),
    isBlocklisted(normalized),
  ]);
  const reports: ReportCounts = agent
    ? await countReports(agent.id)
    : { open: 0, reviewed: 0, total: 0 };
  const protocolTrustScore = agent ? resolveTrustScore(agent) : 0;
  const lastActivity = agent ? pickLastActivity(agent) : null;
  const lastActivityAgeDays = daysSince(lastActivity);
  const tier = verificationTier(agent);
  const isVerified = tier !== "unverified";
  const recommendation = computeRecommendation({
    protocolTrustScore,
    isRegistered: Boolean(agent),
    isVerified,
    isPremiumVerified: agent?.isPremiumVerified ?? false,
    isVerifiedRevenue: agent?.isVerifiedRevenue ?? false,
    reviewedReports: reports.reviewed,
    openReports: reports.open,
    blocklisted,
    lastActivityAgeDays,
  });
  const profileUrl = agent
    ? agentPublicUrl(getPublicSiteUrl(), agent)
    : null;
  return {
    wallet: normalized,
    isRegistered: Boolean(agent),
    isVerified,
    verificationTier: tier,
    protocolTrustScore,
    reports,
    lastActivity: lastActivity ? lastActivity.toISOString() : null,
    recommendation,
    agent: agent
      ? {
          chainId: agent.chainId,
          agentId: agent.agentId,
          name: agent.name,
          slug: toAgentUrlSlug(agent.name),
          profilePath: agentPublicPath(agent),
        }
      : null,
    evidence: { profileUrl },
  };
}
