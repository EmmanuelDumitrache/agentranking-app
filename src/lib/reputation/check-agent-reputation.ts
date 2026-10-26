import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { resolveOnChainIdsFromProfileUrl } from "@/lib/resolve-agent-from-link-url";
import { attachAgentScoringPayload } from "@/lib/agent-scoring-payload";
import { buildCovenantDetail } from "@/lib/covenant/snapshot";
import { buildHatcherDetail } from "@/lib/hatcher/snapshot";
import { lookupAgentDbIdByHatcherIdWithRetry } from "@/lib/hatcher/lookup";
import { getPublicSiteUrl } from "@/lib/site-url";
import { buildTrustOraclePayload, countReports, isBlocklisted } from "@/lib/trust-oracle";
import {
  computeRecommendation,
  verificationTier,
} from "@/lib/trust-oracle-logic";
import {
  buildHatcherCheckScores,
  buildUnknownCheckResponse,
  classifyRegistryType,
  covenantStatusLabel,
  DEFAULT_REPUTATION_CHECK_DISCLAIMER,
  deriveHatcherRecommendation,
  hatcherLinksFromDetail,
  hatcherVerificationBadge,
  HATCHER_REPUTATION_CHECK_DISCLAIMER,
  parseReputationCheckSearchParams,
  type CheckAgentRowForClassify,
} from "@/lib/reputation/check-agent-reputation-pure";
import type {
  AgentReputationCheckInput,
  AgentReputationCheckResponse,
  CheckRecommendation,
} from "@/lib/reputation/check-agent-reputation-types";
import { agentPublicPath, agentPublicUrl, toAgentUrlSlug } from "@/lib/agent-public-url";
export {
  InvalidCheckInputError,
  type AgentReputationCheckInput,
  type AgentReputationCheckResponse,
} from "@/lib/reputation/check-agent-reputation-types";
export {
  parseReputationCheckSearchParams,
  classifyRegistryType,
  buildUnknownCheckResponse,
  buildHatcherCheckScores,
} from "@/lib/reputation/check-agent-reputation-pure";
export { InvalidWalletError } from "@/lib/trust-oracle-logic";
const CHECK_AGENT_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  owner: true,
  description: true,
  image: true,
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
  score: true,
  rank: true,
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
  stars: true,
  totalFeedback: true,
  binanceCompatible: true,
  agentRankScore: true,
  activityScore: true,
  listingRegistrySource: true,
  metaplexAssetAddress: true,
  metaplexVerified: true,
  sapVerified: true,
  sapProtocols: true,
  sapCapabilities: true,
  sapAgentPda: true,
  sapOwnerWallet: true,
  agentURI: true,
  metadata: { select: { key: true, value: true } },
  services: { select: { name: true, endpoint: true } },
} satisfies Prisma.AgentSelect;
type CheckAgentRow = Prisma.AgentGetPayload<{ select: typeof CHECK_AGENT_SELECT }>;
function checkedAtIso(): string {
  return new Date().toISOString();
}
function profileUrlFor(chainId: number, agentId: number, name: string): string {
  return agentPublicUrl(getPublicSiteUrl(), { chainId, agentId, name });
}
function agentBlock(row: CheckAgentRow, registryType: string): AgentReputationCheckResponse["agent"] {
  const slug = toAgentUrlSlug(row.name);
  return {
    name: row.name,
    slug,
    chainId: row.chainId,
    agentId: row.agentId,
    owner: row.owner ?? "",
    profilePath: agentPublicPath(row),
    profileUrl: profileUrlFor(row.chainId, row.agentId, row.name),
    source: row.listingRegistrySource?.trim() || registryType,
  };
}
function daysSince(date: Date | null): number | null {
  if (!date) return null;
  const ms = Date.now() - date.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}
function pickLastActivity(agent: CheckAgentRow): Date | null {
  const candidates = [agent.activityUpdatedAt, agent.verifiedWalletAt, agent.lastActiveAt];
  let latest: Date | null = null;
  for (const d of candidates) {
    if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
  }
  return latest;
}
async function loadAgentByDbId(dbId: number): Promise<CheckAgentRow | null> {
  return withTransientPoolRetry(() =>
    prisma.agent.findUnique({
      where: { id: dbId },
      select: CHECK_AGENT_SELECT,
    }),
  );
}
async function loadAgentByChainAgent(
  chainId: number,
  agentId: number,
): Promise<CheckAgentRow | null> {
  return withTransientPoolRetry(() =>
    prisma.agent.findUnique({
      where: { agentId_chainId: { agentId, chainId } },
      select: CHECK_AGENT_SELECT,
    }),
  );
}
async function buildRegisteredResponse(row: CheckAgentRow): Promise<AgentReputationCheckResponse> {
  const checkedAt = checkedAtIso();
  const registryType = classifyRegistryType(row as CheckAgentRowForClassify);
  const profileUrl = profileUrlFor(row.chainId, row.agentId, row.name);
  const warnings: string[] = [];
  const reasons: string[] = [];
  if (!row.isActive) {
    warnings.push("Agent listing is inactive on AgentRanking.");
  }
  const hatcherDetail = buildHatcherDetail(
    { chainId: row.chainId, listingRegistrySource: row.listingRegistrySource },
    row.metadata,
  );
  const covenantDetail = buildCovenantDetail(
    {
      sapProtocols: row.sapProtocols,
      sapAgentPda: row.sapAgentPda,
      sapOwnerWallet: row.sapOwnerWallet,
      sapCapabilities: row.sapCapabilities,
      agentURI: row.agentURI,
      isActive: row.isActive,
    },
    row.metadata,
  );
  const tier = verificationTier({
    isVerified: row.isVerified,
    isPremiumVerified: row.isPremiumVerified,
    isVerifiedRevenue: row.isVerifiedRevenue,
  });
  const kyaVerified = tier === "founding_partner";
  if (registryType === "hatcher") {
    const scores = buildHatcherCheckScores(hatcherDetail);
    if (scores.partnerDiscoveryScore != null && scores.partnerDiscoveryScore > 0) {
      reasons.push(
        `Hatcher discovery score ${scores.partnerDiscoveryScore}/100 (partner metadata, not KYA).`,
      );
    } else {
      reasons.push("Hatcher-indexed agent with no discovery score yet.");
    }
    const snap = hatcherDetail.hatcher;
    if (snap) {
      const passportOk =
        (snap.passportSnapshot) != null &&
        typeof (snap.passportSnapshot) === "object";
      const mcpOk =
        snap.mcpManifestSnapshot != null &&
        typeof snap.mcpManifestSnapshot === "object";
      if (!passportOk) warnings.push("No Hatcher passport snapshot indexed.");
      if (!mcpOk) warnings.push("No Hatcher MCP manifest snapshot indexed.");
    }
    reasons.push("Protocol trust and on-chain scores are not applicable for Hatcher partner agents.");
    const recommendation = deriveHatcherRecommendation(hatcherDetail, warnings);
    return {
      ok: true,
      isRegistered: true,
      registryType: "hatcher",
      recommendation,
      agent: agentBlock(row, "hatcher"),
      scores,
      verification: {
        kyaVerified: false,
        sapVerified: false,
        covenantStatus: null,
        hatcherBadge: hatcherVerificationBadge(hatcherDetail),
      },
      warnings,
      reasons,
      links: hatcherLinksFromDetail(hatcherDetail, profileUrl),
      disclaimer: HATCHER_REPUTATION_CHECK_DISCLAIMER,
      checkedAt,
    };
  }
  const scoring = attachAgentScoringPayload({
    name: row.name,
    description: row.description,
    image: row.image,
    metadata: row.metadata,
    services: row.services,
    scoreWallet: row.scoreWallet,
    x402Support: row.x402Support,
    binanceCompatible: row.binanceCompatible ?? false,
    totalFeedback: row.totalFeedback,
    stars: row.stars,
    scoreQuality: row.scoreQuality,
    scoreMetadata: row.scoreMetadata,
    scoreServices: row.scoreServices,
    scoreFreshness: row.scoreFreshness,
    scorePopularity: row.scorePopularity,
    lastActiveAt: row.lastActiveAt,
    isVerified: row.isVerified,
    isPremiumVerified: row.isPremiumVerified,
    isVerifiedRevenue: row.isVerifiedRevenue,
    verifiedWallet: row.verifiedWallet,
    perfWinRate: row.perfWinRate,
    perfMonthlyPnlUsd: row.perfMonthlyPnlUsd,
    perfBurnToEarnRatio: row.perfBurnToEarnRatio,
    perfTxCount: row.perfTxCount,
    activeWinRate30d: row.activeWinRate30d,
    nativeVolume30d: row.nativeVolume30d,
    rank: row.rank,
    score: row.score,
    protocolTrustScore: row.protocolTrustScore,
    agentRankScore: row.agentRankScore,
    activityScore: row.activityScore,
    executionScore: row.executionScore,
    sapVerified: row.sapVerified === true,
  });
  const [reports, blocklisted] = await Promise.all([
    countReports(row.id),
    row.owner ? isBlocklisted(row.owner) : Promise.resolve(false),
  ]);
  if (reports.open > 0) {
    warnings.push(`${reports.open} open community report(s).`);
  }
  if (reports.reviewed > 0) {
    warnings.push(`${reports.reviewed} reviewed community report(s).`);
  }
  if (blocklisted) {
    warnings.push("Owner wallet matches an active blocklist rule.");
  }
  const protocolTrust = scoring.protocolTrustScore;
  const lastActivity = pickLastActivity(row);
  const recommendation = computeRecommendation({
    protocolTrustScore: protocolTrust,
    isRegistered: true,
    isVerified: row.isVerified,
    isPremiumVerified: row.isPremiumVerified ?? false,
    isVerifiedRevenue: row.isVerifiedRevenue ?? false,
    reviewedReports: reports.reviewed,
    openReports: reports.open,
    blocklisted,
    lastActivityAgeDays: daysSince(lastActivity),
  }) as CheckRecommendation;
  reasons.push(`Protocol trust score ${protocolTrust}/100.`);
  if (registryType === "sap") {
    reasons.push("SAP-verified agent on AgentRanking.");
  }
  if (registryType === "covenant") {
    reasons.push(`Covenant status: ${covenantDetail.status}.`);
    if (covenantDetail.status !== "verified" && covenantDetail.status !== "verified_attested") {
      warnings.push("Covenant audit verification is incomplete.");
    }
  }
  if (kyaVerified) {
    reasons.push("Founding partner (KYA) verified on AgentRanking.");
  } else if (row.isVerified) {
    reasons.push("Community verified on AgentRanking.");
  }
  let disclaimer = DEFAULT_REPUTATION_CHECK_DISCLAIMER;
  if (registryType === "sap") {
    disclaimer =
      "SAP reputation reflects Synapse Agent Protocol indexing on AgentRanking. Not Hatcher partner discovery or Covenant audit attestation.";
  } else if (registryType === "covenant") {
    disclaimer =
      "Covenant status reflects OpenCovenant verification snapshots on AgentRanking. See agent profile for audit details.";
  }
  return {
    ok: true,
    isRegistered: true,
    registryType,
    recommendation,
    agent: agentBlock(row, registryType),
    scores: {
      agentRankScore: scoring.agentRankScore,
      protocolTrustScore: scoring.protocolTrustScore,
      reputationScore: scoring.reputationScore,
      partnerDiscoveryScore: null,
      confidence: scoring.confidenceSummary,
    },
    verification: {
      kyaVerified,
      sapVerified: row.sapVerified === true,
      covenantStatus: covenantStatusLabel(covenantDetail),
      hatcherBadge: null,
    },
    warnings,
    reasons,
    links: { agentRankingProfile: profileUrl },
    disclaimer,
    checkedAt,
  };
}
async function mapWalletOracleToCheckResponse(
  wallet: string,
): Promise<AgentReputationCheckResponse> {
  const oracle = await buildTrustOraclePayload(wallet);
  const checkedAt = checkedAtIso();
  if (!oracle.isRegistered || !oracle.agent) {
    return {
      ...buildUnknownCheckResponse({ mode: "wallet", wallet }, checkedAt),
      reasons: [
        `Wallet ${oracle.wallet} is not linked to an active AgentRanking agent.`,
        "Treat unregistered wallets as unverified before x402 or agent payments.",
      ],
    };
  }
  const row = await loadAgentByChainAgent(oracle.agent.chainId, oracle.agent.agentId);
  if (row) {
    const registryType = classifyRegistryType(row as CheckAgentRowForClassify);
    if (registryType === "hatcher") {
      return buildRegisteredResponse(row);
    }
  }
  const profileUrl = oracle.evidence.profileUrl ?? profileUrlFor(
    oracle.agent.chainId,
    oracle.agent.agentId,
    oracle.agent.name,
  );
  return {
    ok: true,
    isRegistered: true,
    registryType: "erc8004",
    recommendation: oracle.recommendation as CheckRecommendation,
    agent: {
      name: oracle.agent.name,
      slug: oracle.agent.slug,
      chainId: oracle.agent.chainId,
      agentId: oracle.agent.agentId,
      owner: "",
      profilePath: agentPublicPath(oracle.agent),
      profileUrl,
      source: "erc8004",
    },
    scores: {
      agentRankScore: null,
      protocolTrustScore: oracle.protocolTrustScore,
      reputationScore: null,
      partnerDiscoveryScore: null,
      confidence: null,
    },
    verification: {
      kyaVerified: oracle.verificationTier === "founding_partner",
      sapVerified: false,
      covenantStatus: null,
      hatcherBadge: null,
    },
    warnings: oracle.reports.open > 0 ? [`${oracle.reports.open} open community report(s).`] : [],
    reasons: [
      `Wallet matched AgentRanking agent via trust oracle (score ${oracle.protocolTrustScore}/100).`,
    ],
    links: { agentRankingProfile: profileUrl },
    disclaimer: DEFAULT_REPUTATION_CHECK_DISCLAIMER,
    checkedAt,
  };
}
export async function checkAgentReputation(
  input: AgentReputationCheckInput,
): Promise<AgentReputationCheckResponse> {
  if (input.mode === "wallet") {
    return mapWalletOracleToCheckResponse(input.wallet);
  }
  let row: CheckAgentRow | null = null;
  if (input.mode === "hatcherId") {
    const dbId = await lookupAgentDbIdByHatcherIdWithRetry(input.hatcherId);
    if (dbId != null) row = await loadAgentByDbId(dbId);
  } else if (input.mode === "chainAgentId") {
    row = await loadAgentByChainAgent(input.chainId, input.agentId);
  } else if (input.mode === "profileUrl") {
    const resolved = await resolveOnChainIdsFromProfileUrl(input.url);
    if (resolved) row = await loadAgentByChainAgent(resolved.chainId, resolved.agentId);
  }
  if (!row || !row.isActive) {
    if (row && !row.isActive) {
      return {
        ...buildUnknownCheckResponse(input, checkedAtIso()),
        warnings: ["Agent exists but is inactive on AgentRanking."],
        reasons: ["Inactive agents are treated as not registered for trust checks."],
      };
    }
    return buildUnknownCheckResponse(input, checkedAtIso());
  }
  return buildRegisteredResponse(row);
}
export async function checkAgentReputationFromSearchParams(
  searchParams: URLSearchParams,
): Promise<AgentReputationCheckResponse> {
  const input = parseReputationCheckSearchParams(searchParams);
  return checkAgentReputation(input);
}
