import type { TrustDimensionValues } from "@/lib/agent-score";
import type { AgentDevProofPayload } from "@/lib/devproof-public";
import type { ScoreBreakdownHintKey } from "@/lib/signals/score-hints";
import type { SapMergeMeta } from "@/lib/agent-sap-merge";
import type { AgentChainCluster } from "@/lib/agent-chain-cluster";
import type { ProfileDeployment } from "@/lib/agent-profile-deployments";
import type { HatcherDetailPayload } from "@/lib/hatcher/types";
import type { MetaplexDetailPayload } from "@/lib/metaplex/types";
import type { AgentIdentityPayload } from "@/lib/agent-identity";
import type { AgentXPost } from "@/lib/agent-x-posts";
import type { XLatestPostsDisplaySource } from "@/lib/social/x-latest-posts-cache";
export type EtherscanEnrichmentStatus =
  | "ok"
  | "no_api_key"
  | "no_onchain_transfer_data"
  | "explorer_api_error";
export interface EtherscanEnrichmentData {
  mintTx: string | null;
  mintBlock: string | null;
  mintDate: string | null;
  transferCount: number;
  explorerUrl: string;
  explorerName: string;
  ensName: string | null;
  ownerAddress: string | null;
  enrichmentStatus?: EtherscanEnrichmentStatus;
}
export interface AgentDetail {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  hasDuplicateName?: boolean;
  slug: string;
  /** Current canonical public profile path. Mutable when the Agent name changes. */
  profilePath: string;
  description: string;
  image: string;
  agentURI: string;
  owner: string;
  isActive: boolean;
  isVerified: boolean;
  isPremiumVerified?: boolean;
  /** Review-queue workflow: unverified | submitted | in_review | verified | rejected */
  publicVerificationStatus?: string;
  binanceCompatible: boolean;
  score: number;
  rank: number;
  x402Support: boolean;
  /** Product flag; contributes to trust when enabled with other signals. */
  isSmartBatchEnabled?: boolean;
  /** Published Agent Dashboard MCP offers (server-computed count > 0). */
  hasPublishedMcpOffers?: boolean;
  stars: number;
  totalFeedback: number;
  totalMessages: number;
  totalChats: number;
  totalWatches: number;
  scoreQuality: number;
  scorePopularity: number;
  scoreActivity: number;
  scoreWallet: number;
  scoreFreshness: number;
  scoreMetadata: number;
  /** Persisted endpoint dimension (same as worker scoreEndpoints). */
  scoreServices?: number;
  scoreSocial?: number;
  supportedTrust: string;
  powerScore?: number;
  activeBoosts?: number;
  adminPowerAdjust?: number;
  /** True when an active AR holder `power_boost` perk row exists (server probe). */
  hasHolderPowerBoost?: boolean;
  hasHolderStakeBadge?: boolean;
  holderBadgeLabel?: string | null;
  holderStakeBadgeCount?: number;
  holderPowerBoostUnits?: number;
  holderPowerBoostBackerCount?: number;
  voteFireCount?: number;
  votePooCount?: number;
  tokenAddress?: string;
  createdAt: string;
  lastActiveAt: string;
  // Verified execution and revenue signals
  isVerifiedRevenue?: boolean;
  verifiedRevenueAt?: string | null;
  verifiedWallet?: string;
  verifiedWalletAt?: string | null;
  verifiedWalletChainId?: number | null;
  perfWinRate?: number | null;
  perfAvgPnlPercent?: number | null;
  perfBurnToEarnRatio?: number | null;
  perfTotalVolumeUsd?: number | null;
  perfMonthlyPnlUsd?: number | null;
  perfLastComputedAt?: string | null;
  perfTxCount?: number | null;
  // Recent on-chain activity cache
  recentActivity?: unknown;
  activityUpdatedAt?: string | null;
  /** Cluster sibling with latest on-chain activity (defaults to URL row). */
  activityChainId?: number;
  activityAgentId?: number;
  activeWinRate30d?: number | null;
  nativeVolume30d?: number | null;
  agentMode?: string;
  executionScore?: number | null;
  workReadyStatus?: string;
  featuredWorkReady?: boolean;
  workReadyReasons?: string[];
  agentRankScore?: number;
  profileScore?: number;
  protocolTrustScore?: number;
  reputationScore?: number;
  activityScore?: number;
  monetizationScore?: number;
  organicRank?: number;
  rankable?: boolean;
  rankSource?: "db" | "live" | "none";
  powerRank?: number | null;
  rankConfidence?: "Low" | "Medium" | "High" | "Verified";
  confidenceSummary?: string;
  scoreVersion?: number;
  scoreBreakdown?: {
    profile: { score: number; reasons: string[] };
    protocolTrust: { score: number; reasons: string[]; executionNote?: string };
    reputation: { score: number; reasons: string[] };
    activity: { score: number; reasons: string[] };
    monetization: { score: number; reasons: string[] };
  };
  chain: { name: string; shortName: string; color: string; icon: string; chainId: number };
  services: Array<{ id: number; name: string; endpoint: string; version: string }>;
  metadata: Array<{ id?: number; key: string; value: string }>;
  /** Server-computed 𝕏 cache for profile — avoids slow client /x-posts fetch on load. */
  xPostsPreview?: {
    readonly handle: string | null;
    readonly posts: AgentXPost[];
    readonly source?: XLatestPostsDisplaySource;
    readonly embedBlocked?: boolean;
  } | null;
  feedbacks: Array<{
    id: number;
    clientAddress: string;
    /** Set when synced from on-chain reputation registry. */
    feedbackIndex?: number | null;
    value: number;
    valueDecimals: number;
    tag1: string;
    tag2: string;
    comment: string;
    createdAt: string;
  }>;
  etherscanData?: EtherscanEnrichmentData | null;
  /** Chronological trust/rank snapshots from the rank-snapshot job (oldest first). */
  rankSnapshots?: Array<{ capturedAt: string; agentRankScore: number; rank: number; score: number }>;
  // SAP (Synapse Agent Protocol)
  /** Present when `sapVerified` — which display fields came from SAP snapshot vs AR. */
  sapMergeMeta?: SapMergeMeta | null;
  listingRegistrySource?: string;
  sapVerified?: boolean;
  sapAgentPda?: string | null;
  sapStatsPda?: string | null;
  sapCapabilities?: unknown;
  sapPricingTiers?: unknown;
  sapProtocols?: string[];
  sapX402Endpoint?: string | null;
  sapRegistrationTx?: string | null;
  sapLastSyncedAt?: string | null;
  sapStats?: unknown;
  sapOwnerWallet?: string | null;
  sapRegisteredAt?: string | null;
  /** True when SAP Overview data is merged from a unique Solana SAP listing with the same canonical slug (non-Solana profile). */
  sapTwinMatch?: boolean;
  /** Solana SAP agent used for graph API when `sapTwinMatch`. */
  sapGraphChainId?: number;
  sapGraphAgentId?: number;
  /** Agent DB id for SAP operator claim (Solana SAP row when `sapTwinMatch`). */
  sapClaimAgentDbId?: number;
  /** True if any AgentRanking user has claimed this SAP listing */
  sapOperatorClaimed?: boolean;
  /** True if the current session's profile holds the claim */
  sapClaimedByViewer?: boolean;
  /** Sanitized for public clients — admin per-dimension overrides (0–100), eight weighted trust rows. */
  trustDimensionOverrides?: Partial<TrustDimensionValues> | null;
  /** When true, the AR Score gauge uses the administratively pinned `agentRankScore`. */
  manualAgentRankScorePinned?: boolean;
  /** Public /ag-ref/:code referral (optional). */
  publicReferralCode?: string | null;
  publicReferralDestination?: string | null;
  publicReferralInfo?: string | null;
  /** Canonical identity summary and grouped on-chain registrations. */
  identity?: AgentIdentityPayload;
  /** Multi-chain ERC-8004 deployments (null when single-chain). */
  chainCluster?: AgentChainCluster | null;
  /** Unified EVM cluster + SAP Solana deployments for pill and Networks row. */
  profileDeployments?: ProfileDeployment[];
  /** Signal-backed trust tiles from Agent Dashboard verification model. */
  signalTrustSummary?: import("@/lib/signals/types").TrustSummaryTile[];
  /** Dashboard-derived public trust chips (x402, DevProof, official links). */
  publicTrustFlags?: import("@/lib/public-trust-flags").PublicTrustFlags;
  /** Endpoint health signals for public service rows (no internal probe errors). */
  endpointHealthSignals?: import("@/lib/public-service-health").PublicHealthSignal[];
  /** Verification signal hints merged into score breakdown rows. */
  signalScoreHints?: Partial<Record<ScoreBreakdownHintKey, string[]>>;
  /** Latest GitHub DevProof snapshot (stats only on public profile). */
  devProof?: AgentDevProofPayload | null;
  /** Owner-published paid x402 services (public profile). */
  publishedPaidServices?: Array<{
    id: number;
    title: string;
    description: string;
    serviceType: string;
    endpointUrl: string;
    priceUsd: number | null;
    priceLabel: string;
    paymentWallet?: string;
  }>;
  /** OpenCovenant runtime provenance (SAP agents with covenant.runtime/v1). */
  covenant?: {
    isCovenant: boolean;
    status:
      | "not_covenant"
      | "indexed"
      | "identity_only"
      | "verified"
      | "verified_attested";
    protocolVersion?: string;
    rootHashHex?: string;
    rootSignedBy?: string;
    rootSignedAt?: string;
    rootCheckedAt?: string;
    rootSource?: "self" | "sigstore";
    releaseTarget?: string | null;
    reasons: string[];
    missingChecks: string[];
    checks: Record<
      | "identity_binding"
      | "manifest_binding"
      | "audit_root_presence"
      | "signature_match"
      | "audit_root_recomputation",
      "pass" | "fail" | "pending"
    >;
  };
  /** Hatcher partner index (chain 990002 / listingRegistrySource hatcher). */
  hatcher?: HatcherDetailPayload;
  /** Metaplex Agent Registry (MPL Core + AgentIdentity). */
  metaplex?: MetaplexDetailPayload | null;
  /** Hatcher x402 readiness (metadata + published offers; not a paid listing). */
  hatcherX402Readiness?: import("@/lib/hatcher/x402-readiness").HatcherX402Readiness;
}
