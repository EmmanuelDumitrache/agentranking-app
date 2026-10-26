import type { AgentDetail } from "@/types/agent-detail";
import {
  getPublicApiCached,
  getPublicApiCacheNamespaceGeneration,
} from "@/lib/public-api-cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { computeExecutionScore } from "@/lib/agent-score";
import { resolveAgentOrganicRank } from "@/lib/agent-organic-rank";
import { isAgentRankable, resolveOrganicRank } from "@/lib/agent-rankable";
import { attachAgentScoringPayload } from "@/lib/agent-scoring-payload";
import { hasVisiblePower } from "@/lib/agent-utils";
import { redactAgentExecutionForPublicViewer } from "@/lib/agents-api-shared";
import { getEtherscanEnrichment, getExplorerConfig } from "@/lib/etherscan-enrich";
import { getChainByChainId } from "@/lib/chains";
import { getDashboardUserProfile, hasDashboardIdentity } from "@/lib/dashboard/session-profile";
import { computeDashboardUnlocked } from "@/lib/dashboard/access";
import { isAgentBlocked } from "@/lib/agent-blocklist";
import { mergeSapVerifiedAgentRecord } from "@/lib/agent-sap-merge";
import { getCachedSapTwinIndex, resolveUniqueSapTwinForEvmRow } from "@/lib/sap-name-twin";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { agentHasPublicReferralLink } from "@/lib/agent-public-referral";
import {
  loadAgentPublicReferralScalars,
  mergePublicReferralScalarsIntoRecord,
} from "@/lib/agent-public-referral-db";
import { mergedTrustDimensionOverridesForAgent } from "@/lib/admin-trust-dimension-db";
import { stripInternalAgentMetadata } from "@/lib/admin-trust-dimension-overrides";
import { resolveAgentTwitterHandle } from "@/lib/agent-twitter-handle";
import { X_LATEST_POSTS_METADATA_KEY } from "@/lib/agent-x-posts";
import { getCachedXLatestPosts } from "@/lib/social/x-latest-posts-cache";
import { agentPayloadCacheDomain } from "@/lib/public-cache-domains";
import { buildCovenantDetail } from "@/lib/covenant/snapshot";
import { buildHatcherDetail } from "@/lib/hatcher/snapshot";
import { isHatcherChainId } from "@/lib/hatcher/detect";
import { METAPLEX_LISTING_REGISTRY_SOURCE } from "@/lib/metaplex/config";
import { hydrateMetaplexGenesisIfMissing } from "@/lib/metaplex/genesis-hydration";
import { buildMetaplexDetail } from "@/lib/metaplex/snapshot";
import { loadOnchainAgentIntelligence } from "@/lib/onchain-agent-intelligence";
import { buildHatcherX402Readiness } from "@/lib/hatcher/x402-readiness";
import type { HatcherX402Readiness } from "@/lib/hatcher/x402-readiness";
import {
  buildDevCovenantPreviewDetail,
  isDevCovenantPreviewAgent,
} from "@/lib/dev-covenant-preview-agent";
import { activeHolderPerksRelationFind, parseHolderPerkFlags } from "@/lib/leaderboard-filters";
import {
  buildAgentIdentity,
  parseRegistrationMetadata,
  shouldShowOwnerVerifyCta,
  type AgentIdentityPayload,
} from "@/lib/agent-identity";
import { loadClaimedSapAgentDbIds, loadRelatedSapIdentityRows } from "@/lib/agent-identity-load";
import {
  allowAgentDetailCacheInDev,
  limitFeedbackCount,
  limitRankSnapshots,
  skipExternalEnrichment,
} from "@/lib/fast-local";
import { devTimed } from "@/lib/dev-timing";
import { enrichTrustSummaryForProfile, getPublicTrustSummary } from "@/lib/signals/derive";
import { derivePublicTrustFlags } from "@/lib/public-trust-flags";
import { mergePushNotes, parseDevProofPayload } from "@/lib/devproof-public";
import { loadAgentGithubPushNotes } from "@/lib/dashboard/github-push-notes";
import { signalHintsForScoreBreakdown } from "@/lib/signals/score-hints";
import {
  enrichAgentFromClusterSiblings,
  loadClusterSiblingRows,
  loadSiblingRowsFromRegistrationRefs,
  mergeClusterSiblingRows,
  seedRowFromAgent,
  unionClusterRegistrationMeta,
} from "@/lib/agent-cluster-enrichment";
import { parseRegistrationRef, toPublicChainCluster } from "@/lib/agent-chain-cluster";
import {
  loadAgentChainClusterDeployments,
  loadDeploymentDbHints,
  loadExpandedRegistrationMeta,
} from "@/lib/agent-chain-cluster-server";
import { resolveAgentDeployments } from "@/lib/resolve-agent-deployments";
import { deriveAgentCapabilities } from "@/lib/inference-providers/derive-agent-capabilities";
import type { AgentCapabilitiesPayload } from "@/lib/inference-providers/types";
export type GetAgentDetailPayloadOptions = {
  /**
   * When true, always read the DB (skip the shared detail cache). Use for `GET /api/agents/...`
   * so the browser client gets fresh rows even if `revalidateTag` failed or is delayed;
   * RSC / ISR can keep the cached path for HTML.
   */
  readonly bypassUnstableCache?: boolean;
};
/**
 * Load full agent detail for RSC / server code without HTTP self-fetch.
 * Returns JSON-serializable payload (dates as ISO strings) matching GET /api/agents/[chainId]/[agentId].
 * Core agent row + enrichment is cached 300s; session claim flags and execution redaction are applied per-request.
 */
export async function getAgentDetailPayload(
  chainId: number,
  agentId: number,
  options?: GetAgentDetailPayloadOptions,
): Promise<AgentDetail | null> {
  /**
   * In `next dev`, `revalidateTag` / `revalidatePath` from Route Handlers often throw
   * ("static generation store missing") and our admin PATCH swallows that — so ISR tags
   * never bust. Skip the shared detail cache in development so profile edits show on refresh.
   */
  const bypassCache = options?.bypassUnstableCache === true;
  const devCovenantPreview =
    process.env.NODE_ENV === "development" && isDevCovenantPreviewAgent(chainId, agentId);
  // In `next dev`, ISR caching remains opt-in through FAST_LOCAL; the supported pnpm dev workflow stays fresh.
  const useDetailCache =
    !bypassCache &&
    !devCovenantPreview &&
    (process.env.NODE_ENV !== "development" || allowAgentDetailCacheInDev());
  const detailCacheNamespace = agentPayloadCacheDomain(chainId, agentId);
  const [detailCacheGeneration, rankHistoryCacheGeneration] = useDetailCache
    ? await Promise.all([
        getPublicApiCacheNamespaceGeneration(detailCacheNamespace),
        getPublicApiCacheNamespaceGeneration("agent:rank-history"),
      ])
    : [null, null];
  let core = useDetailCache
      ? (await getPublicApiCached<AgentDetail | null>({
          key: `${detailCacheNamespace}:g${detailCacheGeneration}:rh${rankHistoryCacheGeneration}`,
          freshTtlSeconds: 5 * 60,
          staleTtlSeconds: 60 * 60,
          maxPayloadBytes: 8 * 1024 * 1024,
          load: () => fetchAgentDetailCachedCore(chainId, agentId),
          validate: (value): value is AgentDetail | null => {
            if (value === null) return true;
            if (typeof value !== "object" || Array.isArray(value)) return false;
            const row = value as Record<string, unknown>;
            if (
              typeof row.id !== "number" || !Number.isSafeInteger(row.id) ||
              typeof row.agentId !== "number" || !Number.isSafeInteger(row.agentId) ||
              typeof row.chainId !== "number" || !Number.isSafeInteger(row.chainId) ||
              typeof row.name !== "string" ||
              typeof row.slug !== "string" ||
              typeof row.profilePath !== "string"
            ) {
              return false;
            }
            const canonicalLink = {
              chainId: row.chainId,
              agentId: row.agentId,
              name: row.name,
            };
            return (
              row.slug === toAgentUrlSlug(row.name) &&
              row.profilePath === agentPublicPath(canonicalLink)
            );
          },
        })).value
      : await fetchAgentDetailCachedCore(chainId, agentId);
  if (!core) return null;
  // Keep volatile visibility and global-rank state outside the expensive shared core.
  // This prevents each global rank projection from invalidating every Agent detail key,
  // while active state, blocklist rules, and the current name remain authoritative. A
  // committed rename may race durable cache invalidation, so rebuild the complete core
  // directly for that request instead of overlaying only the top-level profilePath and
  // leaving stale nested deployment/identity links behind.
  let currentRank = core.rank;
  let currentName = core.name;
  if (!devCovenantPreview) {
    const current = await prisma.agent.findUnique({
      where: { id: core.id },
      select: { rank: true, isActive: true, name: true },
    });
    if (!current?.isActive) return null;
    currentRank = current.rank;
    currentName = current.name;
    if (toAgentUrlSlug(current.name) !== core.slug) {
      const refreshed = await fetchAgentDetailCachedCore(chainId, agentId);
      if (!refreshed) return null;
      core = refreshed;
    }
    if (
      await isAgentBlocked({
        name: currentName,
        agentURI: core.agentURI,
        owner: core.owner,
        chainId: core.chainId,
        agentId: core.agentId,
      })
    ) {
      return null;
    }
  }
  let liveRank = {
    rank: core.rank,
    organicRank: core.organicRank ?? core.rank,
    rankSource: core.rankSource ?? (core.rank > 0 ? ("db" as const) : ("none" as const)),
    rankable: core.rankable ?? true,
  };
  if (!devCovenantPreview) {
    liveRank = await resolveAgentOrganicRank(prisma, {
      id: core.id,
      name: core.name,
      chainId: core.chainId,
      agentId: core.agentId,
      description: core.description,
      image: core.image,
      metadata: core.metadata,
      services: core.services,
      rank: currentRank,
    });
  }
  const session = await getServerSession(authOptions);
  let viewerHasPro = false;
  let sapOperatorClaimed = false;
  let sapClaimedByViewer = false;
  const claimDbAgentId = typeof core.sapClaimAgentDbId === "number" ? core.sapClaimAgentDbId : core.id;
  const claimRow = await prisma.sapAgentOperatorClaim.findUnique({
    where: { agentId: claimDbAgentId },
    select: { userProfileId: true },
  });
  sapOperatorClaimed = Boolean(claimRow);
  if (hasDashboardIdentity(session)) {
    const resolved = await getDashboardUserProfile(session);
    if (resolved) {
      sapClaimedByViewer = claimRow?.userProfileId === resolved.id;
      const profile = await prisma.userProfile.findUnique({
        where: { id: resolved.id },
        select: { subscriptionStatus: true, subscriptionExpiresAt: true, walletAddress: true, solanaWallet: true },
      });
      viewerHasPro = await computeDashboardUnlocked(profile, resolved.id);
    }
  }
  const redaction = viewerHasPro ? {} : redactAgentExecutionForPublicViewer(core.verifiedWallet, "null");
  const identity = core.identity
    ? {
        ...core.identity,
        summary: {
          ...core.identity.summary,
          showClaimCta: shouldShowOwnerVerifyCta({
            isPremiumVerified: core.isPremiumVerified,
            isVerified: core.isVerified,
            sapOperatorClaimed,
          }),
          verificationStatus:
            core.isPremiumVerified
              ? "Premium verified"
              : sapOperatorClaimed && core.isVerified
                ? "Verified owner"
                : core.isVerified || sapOperatorClaimed
                  ? "Partially verified"
                  : core.chainCluster?.clusterChainVerified
                    ? "Validator attested"
                    : "Unverified",
        },
        registrations: core.identity.registrations.map((reg) => ({
          ...reg,
          verifiedOwner:
            reg.verifiedOwner ||
            (sapOperatorClaimed && reg.agentDbId === claimDbAgentId),
        })),
      }
    : undefined;
  return {
    ...core,
    name: currentName,
    slug: toAgentUrlSlug(currentName),
    profilePath: agentPublicPath({
      chainId: core.chainId,
      agentId: core.agentId,
      name: currentName,
    }),
    ...liveRank,
    ...redaction,
    sapOperatorClaimed,
    sapClaimedByViewer,
    ...(identity ? { identity } : {}),
  };
}
async function fetchAgentDetailCachedCore(chainId: number, agentId: number): Promise<AgentDetail | null> {
  return devTimed(`agent-detail ${chainId}/${agentId}`, async () => {
  if (isDevCovenantPreviewAgent(chainId, agentId)) {
    return buildDevCovenantPreviewDetail(chainId, agentId);
  }
  let agent = await withTransientPoolRetry(() =>
    prisma.agent.findUnique({
      where: {
        agentId_chainId: {
          agentId,
          chainId,
        },
      },
      include: {
        chain: true,
        services: true,
        metadata: true,
        holderAgentPerks: activeHolderPerksRelationFind(new Date()),
        feedbacks: {
          orderBy: { createdAt: "desc" },
          take: limitFeedbackCount(50),
        },
        _count: {
          select: {
            mcpOffers: { where: { isPublished: true } },
          },
        },
      },
    }),
  );
  if (!agent) return null;
  if (agent.isActive !== true) return null;
  const referralScalarsRow = await loadAgentPublicReferralScalars(prisma, agent.id);
  agent = mergePublicReferralScalarsIntoRecord(agent, referralScalarsRow) as typeof agent;
  if (
    process.env.NODE_ENV !== "development" &&
    (await isAgentBlocked({
      name: agent.name,
      agentURI: agent.agentURI ?? "",
      owner: agent.owner ?? "",
      chainId: agent.chainId,
      agentId: agent.agentId,
    }))
  ) {
    return null;
  }
  const metadataPairs = agent.metadata.map((m) => ({ key: m.key, value: m.value }));
  const storedExecutionScore = typeof agent.executionScore === "number" ? agent.executionScore : 0;
  const liveExecutionScore = computeExecutionScore({
    isVerifiedRevenue: agent.isVerifiedRevenue ?? undefined,
    verifiedWallet: agent.verifiedWallet ?? undefined,
    scoreWallet: agent.scoreWallet ?? undefined,
    metadata: metadataPairs,
    perfWinRate: agent.perfWinRate ?? undefined,
    perfMonthlyPnlUsd: agent.perfMonthlyPnlUsd ?? undefined,
    perfBurnToEarnRatio: agent.perfBurnToEarnRatio ?? undefined,
    perfTxCount: agent.perfTxCount ?? undefined,
    activeWinRate30d: agent.activeWinRate30d ?? undefined,
    nativeVolume30d: agent.nativeVolume30d ?? undefined,
  });
  const executionScore = isHatcherChainId(agent.chainId)
    ? 0
    : Math.max(storedExecutionScore, liveExecutionScore);
  const rankSnapshotRows = await withTransientPoolRetry(() =>
    prisma.agentRankSnapshot.findMany({
      where: { agentId: agent.id },
      orderBy: { capturedAt: "desc" },
      take: limitRankSnapshots(90),
      select: { capturedAt: true, agentRankScore: true, rank: true, score: true },
    }),
  );
  const rankSnapshots = [...rankSnapshotRows]
    .reverse()
    .map((s) => ({
      capturedAt: s.capturedAt.toISOString(),
      agentRankScore: s.agentRankScore,
      rank: s.rank,
      score: s.score,
    }));
  const sapTwinIndex = await getCachedSapTwinIndex();
  let sapTwinRef =
    agent.sapVerified !== true && agent.chainId !== SOLANA_CHAIN_ID
      ? resolveUniqueSapTwinForEvmRow(
          {
            name: agent.name,
            chainId: agent.chainId,
            sapVerified: agent.sapVerified,
            agentURI: agent.agentURI,
            sapX402Endpoint: agent.sapX402Endpoint,
            services: agent.services,
          },
          sapTwinIndex,
        )
      : null;
  let twinSap: {
    id: number;
    agentId: number;
    chainId: number;
    name: string;
    agentURI: string | null;
    owner: string | null;
    sapAgentPda: string | null;
    sapStatsPda: string | null;
    sapCapabilities: unknown;
    sapPricingTiers: unknown;
    sapProtocols: string[];
    sapX402Endpoint: string | null;
    sapRegistrationTx: string | null;
    sapLastSyncedAt: Date | null;
    sapStats: unknown;
    sapOwnerWallet: string | null;
    sapRegisteredAt: Date | null;
    sapVerified: boolean;
    publicReferralCode: string | null;
    publicReferralDestination: string;
    publicReferralInfo: string;
  } | null = null;
  if (sapTwinRef) {
    const row = await withTransientPoolRetry(() =>
      prisma.agent.findUnique({
        where: { id: sapTwinRef!.id },
        select: {
          id: true,
          agentId: true,
          chainId: true,
          name: true,
          agentURI: true,
          owner: true,
          sapAgentPda: true,
          sapStatsPda: true,
          sapCapabilities: true,
          sapPricingTiers: true,
          sapProtocols: true,
          sapX402Endpoint: true,
          sapRegistrationTx: true,
          sapLastSyncedAt: true,
          sapStats: true,
          sapOwnerWallet: true,
          sapRegisteredAt: true,
          sapVerified: true,
          publicReferralCode: true,
          publicReferralDestination: true,
          publicReferralInfo: true,
        },
      }),
    );
    if (
      row &&
      row.sapVerified === true &&
      (process.env.NODE_ENV === "development" ||
        !(await isAgentBlocked({
          name: row.name,
          agentURI: row.agentURI ?? "",
          owner: row.owner ?? "",
          chainId: row.chainId,
          agentId: row.agentId,
        })))
    ) {
      twinSap = row;
    } else {
      sapTwinRef = null;
    }
  }
  const sapTwinMatch = Boolean(twinSap && sapTwinRef);
  const effectiveSapVerified = agent.sapVerified === true || sapTwinMatch;
  const chainClusterFull = await loadAgentChainClusterDeployments(
    agent.chainId,
    agent.agentId,
    agent.clusterKey ? { clusterKey: agent.clusterKey } : undefined,
  );
  const seedRow = seedRowFromAgent({
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    description: agent.description,
    image: agent.image,
    agentURI: agent.agentURI ?? "",
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified ?? false,
    totalFeedback: agent.totalFeedback,
    lastActiveAt: agent.lastActiveAt,
    recentActivity: agent.recentActivity,
    activityUpdatedAt: agent.activityUpdatedAt,
    metadata: agent.metadata.map((m) => ({ key: m.key, value: m.value })),
    services: agent.services.map((s) => ({
      id: s.id,
      name: s.name,
      endpoint: s.endpoint,
      version: s.version,
    })),
  });
  const expandedRegistrationMeta = await loadExpandedRegistrationMeta(
    agent.chainId,
    agent.agentId,
    seedRow.metadata,
    seedRow.agentURI,
  );
  const clusterSiblingsFromGraph = await loadClusterSiblingRows(
    chainClusterFull,
    agent.chainId,
    agent.agentId,
  );
  const refSiblings =
    expandedRegistrationMeta.length > 0
      ? await loadSiblingRowsFromRegistrationRefs(
          agent.chainId,
          agent.agentId,
          expandedRegistrationMeta,
        )
      : [];
  const clusterSiblings = mergeClusterSiblingRows(clusterSiblingsFromGraph, refSiblings);
  const clusterEnrichment = enrichAgentFromClusterSiblings(seedRow, clusterSiblings);
  const enrichedMetaByKey = new Map(
    clusterEnrichment.metadata.map((m) => [m.key.toLowerCase(), m.value]),
  );
  for (const m of agent.metadata) {
    const v = enrichedMetaByKey.get(m.key.toLowerCase());
    if (v != null) m.value = v;
  }
  for (const m of clusterEnrichment.metadata) {
    if (!agent.metadata.some((x) => x.key.toLowerCase() === m.key.toLowerCase())) {
      agent.metadata.push({
        id: 0,
        agentId: agent.id,
        key: m.key,
        value: m.value,
        sourceKind: null,
        sourceDigest: null,
        chainControlled: false,
      });
    }
  }
  agent.description = clusterEnrichment.description;
  agent.image = clusterEnrichment.image;
  agent.isVerified = clusterEnrichment.isVerified;
  agent.isPremiumVerified = clusterEnrichment.isPremiumVerified;
  agent.totalFeedback = clusterEnrichment.totalFeedback;
  agent.lastActiveAt = clusterEnrichment.lastActiveAt;
  agent.recentActivity = clusterEnrichment.recentActivity as typeof agent.recentActivity;
  agent.activityUpdatedAt = clusterEnrichment.activityUpdatedAt;
  agent.services = clusterEnrichment.services as typeof agent.services;
  const unionedRegistrations = unionClusterRegistrationMeta([seedRow, ...clusterSiblings]);
  if (unionedRegistrations !== "[]") {
    const regIdx = agent.metadata.findIndex((m) => m.key.toLowerCase() === "registrations");
    if (regIdx >= 0) agent.metadata[regIdx]!.value = unionedRegistrations;
    else
      agent.metadata.push({
        id: 0,
        agentId: agent.id,
        key: "registrations",
        value: unionedRegistrations,
        sourceKind: null,
        sourceDigest: null,
        chainControlled: false,
      });
  }
  const mergeAgentUri =
    twinSap?.agentURI && twinSap.agentURI.trim() ? twinSap.agentURI : agent.agentURI ?? "";
  const merged = mergeSapVerifiedAgentRecord({
    sapVerified: effectiveSapVerified,
    name: agent.name,
    description: agent.description,
    agentURI: mergeAgentUri,
    x402Support: agent.x402Support === true,
    sapX402Endpoint: twinSap?.sapX402Endpoint ?? agent.sapX402Endpoint,
    sapStats: twinSap?.sapStats ?? agent.sapStats,
    services: agent.services.map((s) => ({
      id: s.id,
      name: s.name,
      endpoint: s.endpoint,
      version: s.version,
    })),
  });
  const slug = toAgentUrlSlug(agent.name);
  let etherscanData: AgentDetail["etherscanData"] = null;
  const chainConfig = getChainByChainId(chainId);
  const explorerCfg = getExplorerConfig(chainId);
  if (explorerCfg && chainConfig?.identityRegistry && !skipExternalEnrichment()) {
    try {
      etherscanData = await getEtherscanEnrichment(
        chainId,
        chainConfig.identityRegistry,
        agentId
      );
    } catch {
      etherscanData = null;
    }
  }
  const agWithCount = agent as typeof agent & { _count?: { mcpOffers: number } };
  const {
    hasHolderPowerBoost,
    hasHolderStakeBadge,
    holderBadgeLabel,
    holderStakeBadgeCount,
    holderPowerBoostUnits,
    holderPowerBoostBackerCount,
  } = parseHolderPerkFlags(agent.holderAgentPerks);
  const publishedMcpOfferCount =
    typeof agWithCount._count?.mcpOffers === "number" ? agWithCount._count.mcpOffers : 0;
  const hasPublishedMcpOffers = publishedMcpOfferCount > 0;
  const { _count, holderAgentPerks: _holderPerkRows, ...agentWithoutCount } = agWithCount;
  void _count;
  void _holderPerkRows;
  const sapOverlay =
    twinSap != null
      ? {
          sapAgentPda: twinSap.sapAgentPda,
          sapStatsPda: twinSap.sapStatsPda,
          sapCapabilities: twinSap.sapCapabilities,
          sapPricingTiers: twinSap.sapPricingTiers,
          sapProtocols: twinSap.sapProtocols,
          sapX402Endpoint: twinSap.sapX402Endpoint,
          sapRegistrationTx: twinSap.sapRegistrationTx,
          sapLastSyncedAt: twinSap.sapLastSyncedAt,
          sapStats: twinSap.sapStats,
          sapOwnerWallet: twinSap.sapOwnerWallet,
          sapRegisteredAt: twinSap.sapRegisteredAt,
        }
      : {};
  let sapMergeMeta = merged.sapMergeMeta;
  if (sapMergeMeta && sapTwinMatch) {
    sapMergeMeta = { ...sapMergeMeta, viaNameTwin: true };
  }
  const referralFromSapTwin =
    twinSap != null &&
    !agentHasPublicReferralLink(agent) &&
    agentHasPublicReferralLink({
      publicReferralCode: twinSap.publicReferralCode,
      publicReferralDestination: twinSap.publicReferralDestination,
    })
      ? {
          publicReferralCode: twinSap.publicReferralCode,
          publicReferralDestination: twinSap.publicReferralDestination,
          publicReferralInfo: twinSap.publicReferralInfo,
        }
      : {};
  const trustDimensionOverrides = await mergedTrustDimensionOverridesForAgent(
    prisma,
    agent.id,
    agent.metadata,
  );
  const manualAgentRankScorePinned = agent.metadata.some(
    (m) =>
      m.key.trim().toLowerCase() === "admin_agent_rank_score_lock" &&
      typeof m.value === "string" &&
      m.value.trim().toLowerCase() === "1",
  );
  const publicMetadata = stripInternalAgentMetadata(agentWithoutCount.metadata);
  /** Same inputs as admin + scheduled jobs; merges metadata + raw-SQL trust dim rows. */
  const scoringAgent = {
    ...agentWithoutCount,
    name: merged.name,
    description: merged.description,
    agentURI: merged.agentURI,
    x402Support: merged.x402Support,
    services: merged.services,
    sapProtocols: twinSap?.sapProtocols ?? agent.sapProtocols,
    metadata: agent.metadata.map((m) => ({ key: m.key, value: m.value })),
  };
  // Covenant UI reads cached snapshot only — do not trigger RPC verification on agent detail.
  const covenantDetail = buildCovenantDetail(
    {
      sapProtocols: twinSap?.sapProtocols ?? agent.sapProtocols,
      sapAgentPda: twinSap?.sapAgentPda ?? agent.sapAgentPda,
      sapOwnerWallet: twinSap?.sapOwnerWallet ?? agent.sapOwnerWallet,
      sapCapabilities: twinSap?.sapCapabilities ?? agent.sapCapabilities,
      agentURI: merged.agentURI,
      isActive: agent.isActive,
    },
    agent.metadata.map((m) => ({ key: m.key, value: m.value })),
  );
  const hatcherDetail = buildHatcherDetail(
    {
      chainId: agent.chainId,
      listingRegistrySource: agent.listingRegistrySource ?? null,
    },
    agent.metadata.map((m) => ({ key: m.key, value: m.value })),
  );
  let metaplexGenesisHydrated: Awaited<ReturnType<typeof hydrateMetaplexGenesisIfMissing>> = null;
  try {
    metaplexGenesisHydrated = await hydrateMetaplexGenesisIfMissing({
      id: agent.id,
      metaplexAgentTokenMint: agent.metaplexAgentTokenMint,
      metaplexTradeUrl: agent.metaplexTradeUrl,
      metaplexLaunchAddress: agent.metaplexLaunchAddress,
      metaplexRawData: agent.metaplexRawData,
      metaplexHasDexPair: agent.metaplexHasDexPair,
    });
  } catch (genesisErr) {
    console.warn(
      "[agent-detail] Metaplex genesis hydration failed (non-fatal):",
      Error.isError(genesisErr) ? genesisErr.message : genesisErr,
    );
  }
  const metaplexDetail = buildMetaplexDetail({
    owner: agent.owner,
    listingRegistrySource: agent.listingRegistrySource ?? null,
    metaplexSourceType: agent.metaplexSourceType,
    metaplexAssetAddress: agent.metaplexAssetAddress,
    metaplexAgentIdentityPda: agent.metaplexAgentIdentityPda,
    metaplexAgentRegistrationUri: agent.metaplexAgentRegistrationUri,
    metaplexAgentTokenMint: agent.metaplexAgentTokenMint,
    metaplexAssetSignerPda: agent.metaplexAssetSignerPda,
    metaplexVerified: agent.metaplexVerified,
    metaplexTokenBindingStatus: agent.metaplexTokenBindingStatus,
    metaplexSupportedTrust: agent.metaplexSupportedTrust,
    metaplexActive: agent.metaplexActive,
    metaplexLastIndexedAt: agent.metaplexLastIndexedAt,
    metaplexRawData:
      metaplexGenesisHydrated?.metaplexRawData ?? agent.metaplexRawData,
    metaplexLaunchAddress:
      metaplexGenesisHydrated?.metaplexLaunchAddress ??
      agent.metaplexLaunchAddress,
    metaplexLaunchType:
      metaplexGenesisHydrated?.metaplexLaunchType ?? agent.metaplexLaunchType,
    metaplexLaunchStatus:
      metaplexGenesisHydrated?.metaplexLaunchStatus ??
      agent.metaplexLaunchStatus,
    metaplexTradeUrl:
      metaplexGenesisHydrated?.metaplexTradeUrl ?? agent.metaplexTradeUrl,
    metaplexBondingProgressPct:
      metaplexGenesisHydrated?.metaplexBondingProgressPct ??
      agent.metaplexBondingProgressPct,
    metaplexBondingProgressSource:
      metaplexGenesisHydrated?.metaplexBondingProgressSource ??
      agent.metaplexBondingProgressSource,
    metaplexBondingProgressUpdatedAt:
      metaplexGenesisHydrated?.metaplexBondingProgressUpdatedAt ??
      agent.metaplexBondingProgressUpdatedAt,
    metaplexHasDexPair:
      metaplexGenesisHydrated?.metaplexHasDexPair ?? agent.metaplexHasDexPair,
  });
  const onchainIntelligence = await loadOnchainAgentIntelligence({
    id: agent.id,
    chainId: agent.chainId,
    agentId: agent.agentId,
    protocolAgentId: agent.protocolAgentId,
    agentURI: agent.agentURI,
    listingRegistrySource: agent.listingRegistrySource,
    services: agent.services,
    sapVerified: twinSap?.sapVerified ?? agent.sapVerified,
    sapAgentPda: twinSap?.sapAgentPda ?? agent.sapAgentPda,
    sapStatsPda: twinSap?.sapStatsPda ?? agent.sapStatsPda,
    sapCapabilities: twinSap?.sapCapabilities ?? agent.sapCapabilities,
    sapPricingTiers: twinSap?.sapPricingTiers ?? agent.sapPricingTiers,
    sapProtocols: twinSap?.sapProtocols ?? agent.sapProtocols,
    sapX402Endpoint: twinSap?.sapX402Endpoint ?? agent.sapX402Endpoint,
    sapRegistrationTx: twinSap?.sapRegistrationTx ?? agent.sapRegistrationTx,
    sapLastSyncedAt: twinSap?.sapLastSyncedAt ?? agent.sapLastSyncedAt,
    sapStats: twinSap?.sapStats ?? agent.sapStats,
    sapOwnerWallet: twinSap?.sapOwnerWallet ?? agent.sapOwnerWallet,
    sapRegisteredAt: twinSap?.sapRegisteredAt ?? agent.sapRegisteredAt,
    metaplexVerified: agent.metaplexVerified,
    metaplexRawData: metaplexGenesisHydrated?.metaplexRawData ?? agent.metaplexRawData,
    metaplexAssetAddress: agent.metaplexAssetAddress,
    metaplexAgentIdentityPda: agent.metaplexAgentIdentityPda,
    metaplexAgentRegistrationUri: agent.metaplexAgentRegistrationUri,
    metaplexAssetSignerPda: agent.metaplexAssetSignerPda,
    metaplexAgentTokenMint: agent.metaplexAgentTokenMint,
    metaplexSupportedTrust: agent.metaplexSupportedTrust,
    metaplexLastIndexedAt: agent.metaplexLastIndexedAt,
    solanaAssetAddress: agent.solanaAssetAddress,
  });
  let hatcherX402Readiness: HatcherX402Readiness | undefined;
  if (hatcherDetail?.isHatcher && hatcherDetail.hatcher) {
    hatcherX402Readiness = buildHatcherX402Readiness({
      hatcher: hatcherDetail.hatcher,
      publishedOfferCount: publishedMcpOfferCount,
      x402Support: merged.x402Support ?? agent.x402Support ?? false,
      services: merged.services.map((s) => ({ endpoint: s.endpoint })),
    });
  }
  if (process.env.COVENANT_DEBUG?.trim() === "1") {
    const pda = (twinSap?.sapAgentPda ?? agent.sapAgentPda)?.trim();
    const debugPda = process.env.COVENANT_DEBUG_PDA?.trim();
    if (!debugPda || pda === debugPda) {
      console.info("[covenant-debug] agent detail", {
        agentDbId: agent.id,
        chainId: agent.chainId,
        agentId: agent.agentId,
        sapAgentPda: pda,
        sapProtocols: twinSap?.sapProtocols ?? agent.sapProtocols,
        isCovenant: covenantDetail.isCovenant,
        status: covenantDetail.status,
        hasSnapshot: agent.metadata.some(
          (m) => m.key.trim().toLowerCase() === "covenant_verification_snapshot",
        ),
      });
    }
  }
  const storedAgentRankScore =
    typeof agentWithoutCount.agentRankScore === "number" &&
    Number.isFinite(agentWithoutCount.agentRankScore)
      ? agentWithoutCount.agentRankScore
      : 0;
  const registrationMeta =
    expandedRegistrationMeta.length > 0
      ? expandedRegistrationMeta
      : (() => {
          const registrationsMetaRaw = publicMetadata.find((m) => m.key === "registrations")?.value;
          return registrationsMetaRaw ? parseRegistrationMetadata(registrationsMetaRaw) : [];
        })();
  const agentWalletMeta = publicMetadata.find((m) => m.key === "agentWallet")?.value?.trim();
  const relatedSapRows = await loadRelatedSapIdentityRows({
    agentDbId: agent.id,
    name: merged.name,
    agentURI: merged.agentURI,
    sapX402Endpoint: twinSap?.sapX402Endpoint ?? agent.sapX402Endpoint,
    sapOwnerWallet: twinSap?.sapOwnerWallet ?? agent.sapOwnerWallet,
    owner: agent.owner,
    services: merged.services,
    sapTwinDbId: sapTwinRef?.id ?? null,
  });
  const relatedDbIds = [
    agent.id,
    ...relatedSapRows.map((r) => r.id),
    ...(sapTwinRef ? [sapTwinRef.id] : []),
  ];
  const claimedAgentDbIds = await loadClaimedSapAgentDbIds(relatedDbIds);
  const [signalTrustSummary, publishedPaidServices, githubConnection, githubSnapshot, githubPushNotes] =
    await Promise.all([
      getPublicTrustSummary(agent.id),
      prisma.agentPaidService.findMany({
        where: { agentId: agent.id, isPublished: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          serviceType: true,
          endpointUrl: true,
          priceUsd: true,
          priceLabel: true,
          paymentWallet: true,
        },
      }),
      prisma.agentGithubConnection.findFirst({
        where: { agentId: agent.id, status: "active" },
        orderBy: { createdAt: "desc" },
        select: { repoFullName: true, visibility: true, lastSyncedAt: true },
      }),
      prisma.agentGithubSnapshot.findFirst({
        where: { agentId: agent.id },
        orderBy: { capturedAt: "desc" },
        select: {
          commitCount30d: true,
          releaseCount: true,
          contributorCount: true,
          lastCommitAt: true,
          capturedAt: true,
          payloadJson: true,
        },
      }),
      loadAgentGithubPushNotes(agent.id),
    ]);
  const enrichedTrustSummary = enrichTrustSummaryForProfile(signalTrustSummary, {
    sapVerified: effectiveSapVerified,
    sapTwinMatch,
    sapAgentPda: twinSap?.sapAgentPda ?? agent.sapAgentPda,
    x402Support: merged.x402Support,
    hasPublishedMcpOffers,
    services: merged.services,
  });
  const signalScoreHints = signalHintsForScoreBreakdown(enrichedTrustSummary.signals);
  const publicTrustFlags = derivePublicTrustFlags(enrichedTrustSummary.signals);
  const endpointHealthSignals = enrichedTrustSummary.signals
    .filter(
      (s) => s.signalType === "endpoint_live" || s.signalType === "endpoint_failing",
    )
    .map((s) => {
      const raw = s as typeof s & { expiresAt?: Date | null };
      return {
        signalType: s.signalType,
        status: s.status,
        value: s.value ?? "",
        payloadJson: s.payloadJson ?? null,
        lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
        expiresAt: raw.expiresAt?.toISOString() ?? null,
      };
    });
  const identity: AgentIdentityPayload = buildAgentIdentity({
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    chainName: agent.chain.name,
    name: agent.name,
    owner: agent.owner ?? "",
    agentWallet: agentWalletMeta || null,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified ?? false,
    sapVerified: agent.sapVerified === true,
    sapTwinMatch,
    sapAgentPda: twinSap?.sapAgentPda ?? agent.sapAgentPda,
    sapOwnerWallet: twinSap?.sapOwnerWallet ?? agent.sapOwnerWallet,
    sapLastSyncedAt:
      (twinSap?.sapLastSyncedAt ?? agent.sapLastSyncedAt)?.toISOString?.() ??
      (typeof twinSap?.sapLastSyncedAt === "string" ? twinSap.sapLastSyncedAt : null) ??
      (typeof agent.sapLastSyncedAt === "string"
        ? agent.sapLastSyncedAt
        : agent.sapLastSyncedAt?.toISOString() ?? null),
    sapOperatorClaimed: false,
    sapClaimedByViewer: false,
    listingRegistrySource: agent.listingRegistrySource ?? null,
    metaplexVerified: agent.metaplexVerified,
    metaplexAssetAddress: agent.metaplexAssetAddress,
    agentURI: merged.agentURI,
    x402Support: merged.x402Support,
    hasPublishedMcpOffers,
    hasDuplicateName: agent.hasDuplicateName ?? false,
    services: merged.services,
    metadata: publicMetadata,
    etherscanExplorerUrl: etherscanData?.explorerUrl ?? null,
    relatedSapRows,
    registrationMeta,
    claimedAgentDbIds,
    clusterDeployments: chainClusterFull?.deployments.map((d) => ({
      agentDbId: d.agentDbId,
      chainId: d.chainId,
      agentId: d.agentId,
      name: d.name,
      slug: d.slug,
      profilePath: d.profilePath,
      isVerified: d.rawChainVerified,
    })),
  });
  const agentCapabilities: AgentCapabilitiesPayload = deriveAgentCapabilities({
    metadata: publicMetadata,
    services: merged.services,
    x402Support: merged.x402Support,
    sapX402Endpoint: twinSap?.sapX402Endpoint ?? agent.sapX402Endpoint,
    sapProtocols: twinSap?.sapProtocols ?? agent.sapProtocols,
    publicTrustFlags,
    identity,
  });
  let daoPowerRank: number | null = null;
  if (
    hasVisiblePower({
      powerScore: agent.powerScore,
      activeBoosts: agent.activeBoosts,
      adminPowerAdjust: agent.adminPowerAdjust,
      hasHolderPowerBoost,
    })
  ) {
    const daoRow = await prisma.daoLeaderboardLive.findUnique({
      where: { agentId: agent.id },
      select: { rank: true },
    });
    daoPowerRank = daoRow?.rank ?? null;
  }
  const scoringPayload = attachAgentScoringPayload(
    {
      ...scoringAgent,
      rank: agent.rank,
      score: agent.score,
      protocolTrustScore: agent.protocolTrustScore,
      agentRankScore:
        manualAgentRankScorePinned && storedAgentRankScore > 0
          ? storedAgentRankScore
          : agent.agentRankScore,
      activityScore: agent.activityScore,
      executionScore,
      sapVerified: effectiveSapVerified,
      sapStats: twinSap?.sapStats ?? agent.sapStats,
      hasDuplicateName: agent.hasDuplicateName ?? false,
    },
    { powerRank: daoPowerRank },
  );
  const resolvedRank = resolveOrganicRank({
    dbRank: agent.rank,
    liveRank: 0,
    rankable: isAgentRankable({
      name: merged.name,
      chainId: agent.chainId,
      agentId: agent.agentId,
      description: merged.description,
      image: agent.image,
      metadata: publicMetadata,
      services: merged.services,
    }),
  });
  const xPostsHandle = resolveAgentTwitterHandle({
    chainId: agent.chainId,
    agentId: agent.agentId,
    metadata: agent.metadata.map((m) => ({ key: m.key, value: m.value })),
    services: merged.services,
  });
  const xPostsPostsMeta = agent.metadata.find((m) => m.key === X_LATEST_POSTS_METADATA_KEY)?.value;
  const xPostsCached = xPostsHandle
    ? getCachedXLatestPosts(xPostsHandle, xPostsPostsMeta)
    : null;
  const xPostsPreview =
    xPostsHandle && xPostsCached
      ? {
          handle: xPostsHandle,
          posts: xPostsCached.posts,
          source: xPostsCached.source,
          embedBlocked: xPostsCached.embedBlocked,
        }
      : null;
  const chainCluster = toPublicChainCluster(chainClusterFull);
  const inMultiChainCluster = (chainClusterFull?.deploymentCount ?? 0) > 1;
  const deploymentHandleMap = new Map<string, { chainId: number; agentId: number }>();
  const addDeploymentHandle = (chainId: number, agentId: number) => {
    deploymentHandleMap.set(`${chainId}:${agentId}`, { chainId, agentId });
  };
  addDeploymentHandle(agent.chainId, agent.agentId);
  for (const entry of registrationMeta) {
    const ref = parseRegistrationRef(entry);
    if (ref) addDeploymentHandle(ref.chainId, ref.agentId);
  }
  for (const d of chainClusterFull?.deployments ?? []) {
    addDeploymentHandle(d.chainId, d.agentId);
  }
  if (sapTwinMatch && sapTwinRef) {
    addDeploymentHandle(sapTwinRef.chainId, sapTwinRef.agentId);
  }
  const deploymentDbHints = await loadDeploymentDbHints([...deploymentHandleMap.values()]);
  const metaplexAttached = Boolean(
    metaplexDetail?.isMetaplex && agent.metaplexAssetAddress?.trim(),
  );
  const metaplexPrimary =
    agent.listingRegistrySource === METAPLEX_LISTING_REGISTRY_SOURCE ||
    (metaplexAttached && agent.chainId === SOLANA_CHAIN_ID);
  const { profileDeployments } = await resolveAgentDeployments({
    chainId: agent.chainId,
    agentId: agent.agentId,
    slug,
    profilePath: agentPublicPath(agent),
    clusterKey: agent.clusterKey,
    chainClusterFull,
    sapTwinMatch,
    sapGraphChainId: sapTwinMatch && sapTwinRef ? sapTwinRef.chainId : undefined,
    sapGraphAgentId: sapTwinMatch && sapTwinRef ? sapTwinRef.agentId : undefined,
    sapGraphSlug: twinSap?.name ? toAgentUrlSlug(twinSap.name) : null,
    sapVerified: effectiveSapVerified,
    metaplexAttached,
    metaplexPrimary,
    metaplexAssetAddress: agent.metaplexAssetAddress,
    metaplexGraphChainId: metaplexPrimary ? agent.chainId : SOLANA_CHAIN_ID,
    metaplexGraphAgentId: metaplexPrimary ? agent.agentId : undefined,
    metaplexGraphSlug: slug,
    linkedRegistrations: identity.registrations
      .filter((r) => r.status !== "primary")
      .map((r) => ({
        status: r.status,
        protocol: r.protocol,
        chainId: r.chainId,
        registrationId: r.registrationId,
        profilePath: r.profilePath,
      })),
    registrationMeta,
    deploymentDbHints,
  });
  const payload = {
    ...agentWithoutCount,
    ...sapOverlay,
    ...referralFromSapTwin,
    name: merged.name,
    description: merged.description,
    agentURI: merged.agentURI,
    x402Support: merged.x402Support,
    services: merged.services,
    sapMergeMeta,
    hasPublishedMcpOffers,
    hasHolderPowerBoost,
    hasHolderStakeBadge,
    holderBadgeLabel,
    holderStakeBadgeCount,
    holderPowerBoostUnits,
    holderPowerBoostBackerCount,
    executionScore,
    rank: resolvedRank.rank,
    organicRank: resolvedRank.organicRank,
    rankSource: resolvedRank.rankSource,
    rankable: resolvedRank.rankable,
    hasDuplicateName: inMultiChainCluster ? false : agent.hasDuplicateName,
    chainCluster,
    profileDeployments,
    slug,
    profilePath: agentPublicPath(agent),
    rankSnapshots,
    etherscanData: etherscanData ?? null,
    sapTwinMatch,
    sapGraphChainId: sapTwinMatch && sapTwinRef ? sapTwinRef.chainId : agent.chainId,
    sapGraphAgentId: sapTwinMatch && sapTwinRef ? sapTwinRef.agentId : agent.agentId,
    sapClaimAgentDbId: sapTwinMatch && sapTwinRef ? sapTwinRef.id : agent.id,
    metadata: publicMetadata,
    manualAgentRankScorePinned,
    agentRankScore: scoringPayload.agentRankScore,
    monetizationScore: scoringPayload.monetizationScore,
    protocolTrustScore: scoringPayload.protocolTrustScore,
    profileScore: scoringPayload.profileScore,
    reputationScore: scoringPayload.reputationScore,
    activityScore: scoringPayload.activityScore,
    rankConfidence: scoringPayload.rankConfidence,
    confidenceSummary: scoringPayload.confidenceSummary,
    scoreBreakdown: scoringPayload.scoreBreakdown,
    scoreVersion: scoringPayload.scoreVersion,
    ...(scoringPayload.powerRank != null && scoringPayload.powerRank > 0
      ? { powerRank: scoringPayload.powerRank }
      : {}),
    identity,
    signalTrustSummary: enrichedTrustSummary.tiles,
    signalScoreHints,
    publicTrustFlags,
    agentCapabilities,
    endpointHealthSignals,
    publishedPaidServices,
    devProof:
      githubConnection && githubSnapshot
        ? (() => {
            const base = parseDevProofPayload(githubConnection, githubSnapshot);
            const recentCommits = mergePushNotes(base.recentCommits ?? [], githubPushNotes, {
              includeHidden: false,
            });
            return { ...base, recentCommits };
          })()
        : null,
    covenant: covenantDetail,
    hatcher: hatcherDetail,
    metaplex: metaplexDetail,
    onchain: onchainIntelligence,
    ...(hatcherX402Readiness ? { hatcherX402Readiness } : {}),
    ...(Object.keys(trustDimensionOverrides).length > 0 ? { trustDimensionOverrides } : {}),
    xPostsPreview,
    activityChainId: clusterEnrichment.activityChainId,
    activityAgentId: clusterEnrichment.activityAgentId,
  };
  return JSON.parse(JSON.stringify(payload)) as AgentDetail;
  });
}
