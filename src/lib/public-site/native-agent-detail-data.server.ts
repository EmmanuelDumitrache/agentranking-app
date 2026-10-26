import { notFound } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { computeNativeAgentScore } from "@/lib/public-site/native-agent-score";
import { withInheritedAgentVerification } from "@/lib/public-site/agent-verification";
import { toPublicAgentCredential, type PublicAgentCredential } from "@/lib/verification/public-agent-credential";
import type { NativeAgentScoreBreakdown } from "@/lib/public-site/native-agent-score";
import type { PublicTokenMarketViewModel } from "@/lib/public-site/market-view-model";
import { loadOnchainAgentIntelligence, type OnchainAgentIntelligence } from "@/lib/onchain-agent-intelligence";
import { buildAgentInstallInfo, type AgentInstallInfo } from "@/lib/public-site/agent-install-command";
import { resolveAgentTalkTarget, type AgentTalkTarget } from "@/lib/public-site/agent-talk-target";
import { agentPublicPath } from "@/lib/agent-public-url";
import { isAgentSolanaDirectoryListed } from "@/lib/agent-solana-registration/display";
import { fairscaleEnabled } from "@/lib/fairscale/config";
import { getFairscaleAssessmentForAgent } from "@/lib/fairscale/assess.server";
import { emptyFairscalePublicAssessment } from "@/lib/fairscale/serialize";
import type { FairscalePublicAssessment } from "@/lib/fairscale/types";
function resolveTokenSource(launchKind: string | null): AgentTokenSource {
  if (!launchKind) return "unknown";
  const kind = launchKind.toLowerCase();
  if (kind === "pumpfun" || kind === "pump.fun" || kind === "pump_fun") return "pumpfun";
  if (kind === "metaplex") return "metaplex";
  if (kind === "agentranking") return "agentranking";
  return "unknown";
}
export type NativeAgentPublicEvent = {
  label: string;
  description: string;
  date: string;
  kind: "created" | "wallet" | "token" | "verification" | "fee" | "metadata" | "other";
};
export type AgentTokenSource =
  | "pumpfun"
  | "metaplex"
  | "agentranking"
  | "unknown";
export type NativeAgentTokenSummary = {
  launchId: string;
  mint: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  network: string;
  source: AgentTokenSource;
  marketView: PublicTokenMarketViewModel | null;
};
export type NativeAgentCapability = {
  label: string;
  kind: "service" | "mcp" | "x402" | "sap" | "archetype" | "mode" | "inference" | "protocol";
};
export type NativeAgentSocialLink = {
  kind: "website" | "twitter" | "telegram" | "github";
  url: string;
};
export type NativeAgentDetailData = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  profilePath: string;
  description: string;
  image: string;
  owner: string;
  isActive: boolean;
  isVerified: boolean;
  isSolanaDirectoryListed: boolean;
  credential: PublicAgentCredential;
  verifiedAt: string | null;
  solanaRegisteredAt: string | null;
  publicVerificationStatus: string;
  arVerificationStatus: string;
  chain: { chainId: number; name: string; shortName: string };
  listingRegistrySource: string;
  /** Native AR Agent Score (derived, not stored). */
  nativeScore: NativeAgentScoreBreakdown;
  /** Agent wallet (custodial). */
  agentWalletPublicKey: string | null;
  /** Social links (from AgentLaunch profile fields or agent metadata). */
  socials: NativeAgentSocialLink[];
  /** Linked tokens launched through AgentRanking. */
  linkedTokens: NativeAgentTokenSummary[];
  /** Capabilities from services, MCP offers, SAP, archetype/mode. */
  capabilities: NativeAgentCapability[];
  /** Real public events for the activity timeline. */
  events: NativeAgentPublicEvent[];
  /** Token fee distribution totals. */
  onchain: OnchainAgentIntelligence;
  feeTotals: {
    totalFeesDistributedLamports: string;
    totalCreatorFeesLamports: string;
    totalArFeesLamports: string;
    lastDistributionAt: string | null;
  } | null;
  createdAt: string;
  lastActiveAt: string;
  /** Independent FairScale trust assessment (cached). */
  fairscaleAssessment: FairscalePublicAssessment | null;
  /** Public talk availability for the agent's own HTTPS endpoint. */
  talk: AgentTalkTarget;
  /** Per-agent MCP install commands when a usable endpoint exists. */
  install: AgentInstallInfo;
};
const AGENT_DETAIL_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  description: true,
  image: true,
  owner: true,
  protocolAgentId: true,
  agentURI: true,
  solanaAssetAddress: true,
  solanaCanonicalStatus: true,
  metaplexAssetAddress: true,
  metaplexRawData: true,
  isActive: true,
  isVerified: true,
  publicVerificationStatus: true,
  arVerificationStatus: true,
  arVerifiedAt: true,
  solanaBlockTime: true,
  solanaIndexerUpdatedAt: true,
  ownerAccount: {
    select: {
      publicId: true,
      verificationLevel: true,
      verificationStatus: true,
      verificationExpiresAt: true,
      verifiedAt: true,
    },
  },
  listingRegistrySource: true,
  sapVerified: true,
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
  sapCapabilityCount: true,
  metaplexVerified: true,
  metaplexAgentIdentityPda: true,
  metaplexAgentRegistrationUri: true,
  metaplexAssetSignerPda: true,
  metaplexSupportedTrust: true,
  metaplexLastIndexedAt: true,
  agentMode: true,
  archetype: true,
  x402Support: true,
  verifiedWallet: true,
  tokenAddress: true,
  metaplexAgentTokenMint: true,
  createdAt: true,
  lastActiveAt: true,
  chain: { select: { chainId: true, name: true, shortName: true } },
  agentWallet: { select: { publicKey: true } },
  services: { select: { id: true, name: true, endpoint: true, version: true, sourceName: true, normalizedType: true, sourceEndpoint: true, endpointKind: true, endpointValid: true, sourceVersion: true, sourceDigest: true, sourceKind: true, skills: true, domains: true, capabilities: true, extensions: true } },
  mcpOffers: {
    select: {
      id: true,
      title: true,
      summary: true,
      ctaUrl: true,
      isPublished: true,
      linkedService: { select: { name: true, endpoint: true } },
    },
  },
  officialLinks: {
    select: {
      linkType: true,
      url: true,
      status: true,
      lockedByVerifiedOwner: true,
    },
  },
  paidServices: {
    where: { isPublished: true },
    select: {
      serviceType: true,
      endpointUrl: true,
      isPublished: true,
    },
  },
  metadata: {
    select: { key: true, value: true },
    take: 24,
  },
  verificationSignals: {
    where: { signalType: { in: ["endpoint_live", "endpoint_failing"] as string[] } },
    select: {
      signalType: true,
      status: true,
      value: true,
      payloadJson: true,
      lastCheckedAt: true,
      expiresAt: true,
    },
  },
  githubConnections: { select: { id: true } },
  solanaRegistryMemberships: {
    where: { isCurrent: true },
    select: { source: true, firstSeenAt: true },
    orderBy: { firstSeenAt: "asc" },
    take: 5,
  },
  agentLaunches: {
    where: { mint: { not: null } },
    select: {
      id: true,
      mint: true,
      tokenSymbol: true,
      tokenName: true,
      tokenImageUrl: true,
      network: true,
      launchStatus: true,
      launchKind: true,
      feeSharingStatus: true,
      profileWebsite: true,
      profileTwitter: true,
      profileTelegram: true,
      profileGithub: true,
      profileTags: true,
      totalFeesDistributedLamports: true,
      totalCreatorFeesLamports: true,
      totalArFeesLamports: true,
      lastDistributionAt: true,
      createdAt: true,
      creationTx: true,
    },
  },
} as const;
type AgentRow = Prisma.AgentGetPayload<{ select: typeof AGENT_DETAIL_SELECT }>;
function normalizeSocialUrl(raw: string | null | undefined, kind: NativeAgentSocialLink["kind"]): string | null {
  if (!raw || raw.trim().length === 0) return null;
  const trimmed = raw.trim().toLowerCase().replaceAll("@", "");
  // Filter out self-referential / internal URLs
  if (
    trimmed.includes("agentranking.io") ||
    trimmed.includes("localhost") ||
    trimmed.includes("127.0.0.1") ||
    trimmed.startsWith("/")
  ) return null;
  switch (kind) {
    case "twitter":
      return trimmed.startsWith("http")
        ? trimmed
        : `https://x.com/${trimmed}`;
    case "telegram":
      return trimmed.startsWith("http")
        ? trimmed
        : `https://t.me/${trimmed}`;
    case "github":
      return trimmed.startsWith("http")
        ? trimmed
        : `https://github.com/${trimmed}`;
    default:
      return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  }
}
function buildSocials(row: AgentRow): NativeAgentSocialLink[] {
  const links: NativeAgentSocialLink[] = [];
  // Prefer AgentLaunch profile fields, fall back to token-level data
  const primaryLaunch = row.agentLaunches?.[0];
  const website = normalizeSocialUrl(primaryLaunch?.profileWebsite, "website");
  if (website) links.push({ kind: "website", url: website });
  const twitter = normalizeSocialUrl(primaryLaunch?.profileTwitter, "twitter");
  if (twitter) links.push({ kind: "twitter", url: twitter });
  const telegram = normalizeSocialUrl(primaryLaunch?.profileTelegram, "telegram");
  if (telegram) links.push({ kind: "telegram", url: telegram });
  const github = normalizeSocialUrl(primaryLaunch?.profileGithub, "github");
  if (github) links.push({ kind: "github", url: github });
  return links;
}
function buildCapabilities(row: AgentRow): NativeAgentCapability[] {
  const caps: NativeAgentCapability[] = [];
  for (const svc of row.services ?? []) {
    caps.push({ label: svc.normalizedType || svc.name, kind: "service" });
    for (const value of [svc.skills, svc.capabilities]) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (typeof item === "string" && item.trim()) caps.push({ label: item.trim(), kind: "service" });
      }
    }
  }
  for (const offer of row.mcpOffers ?? []) {
    caps.push({ label: offer.title, kind: "mcp" });
  }
  if (row.x402Support) {
    caps.push({ label: "x402 payments", kind: "x402" });
  }
  // SAP capabilities
  const sapCaps = row.sapCapabilities;
  if (Array.isArray(sapCaps)) {
    for (const cap of sapCaps) {
      if (typeof cap === "string" && cap.trim().length > 0) {
        caps.push({ label: cap.trim(), kind: "sap" });
      }
    }
  }
  if (row.archetype && row.archetype !== "" && row.archetype !== "unknown") {
    caps.push({ label: row.archetype.replaceAll("_", " "), kind: "archetype" });
  }
  if (row.agentMode && row.agentMode !== "unknown" && row.agentMode !== "") {
    caps.push({ label: row.agentMode, kind: "mode" });
  }
  // Deduplicate and truncate
  const seen = new Set<string>();
  const unique: NativeAgentCapability[] = [];
  for (const cap of caps) {
    const key = cap.label.toLowerCase().trim();
    if (!key || key.length < 2) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cap);
  }
  return unique.slice(0, 20);
}

function resolveVerifiedAt(
  row: AgentRow,
  inherited: ReturnType<typeof withInheritedAgentVerification>,
): string | null {
  if (row.arVerifiedAt) return row.arVerifiedAt.toISOString();
  if (inherited.ownerAccountVerified && row.ownerAccount?.verifiedAt) {
    return row.ownerAccount.verifiedAt.toISOString();
  }
  return null;
}

function resolveSolanaRegisteredAt(row: AgentRow): string | null {
  if (row.solanaBlockTime) return row.solanaBlockTime.toISOString();
  const membership = row.solanaRegistryMemberships?.[0];
  if (membership?.firstSeenAt) return membership.firstSeenAt.toISOString();
  if (row.solanaCanonicalStatus === "registered" && row.solanaIndexerUpdatedAt) {
    return row.solanaIndexerUpdatedAt.toISOString();
  }
  return null;
}

function buildEvents(row: AgentRow): NativeAgentPublicEvent[] {
  const events: NativeAgentPublicEvent[] = [];
  const fmt = (d: Date | string): string =>
    new Date(d).toISOString().slice(0, 10);
  // Agent created
  if (row.createdAt) {
    events.push({
      label: "Agent created",
      description: `${row.name} registered on AgentRanking`,
      date: fmt(row.createdAt),
      kind: "created",
    });
  }
  // Agent wallet generated
  if (row.agentWallet?.publicKey) {
    events.push({
      label: "Agent wallet generated",
      description: `Wallet ${row.agentWallet.publicKey.slice(0, 6)}...${row.agentWallet.publicKey.slice(-4)}`,
      date: fmt(row.createdAt), // approximate — wallet audit events date would be better
      kind: "wallet",
    });
  }
  // Token launches
  for (const launch of row.agentLaunches ?? []) {
    if (launch.createdAt) {
      const sym = launch.tokenSymbol ? `$${launch.tokenSymbol}` : "Token";
      events.push({
        label: `${sym} launched`,
        description: `Mint: ${launch.mint?.slice(0, 6)}...${launch.mint?.slice(-4)}`,
        date: fmt(launch.createdAt),
        kind: "token",
      });
    }
  }
  // Verification
  const inheritedVerification = withInheritedAgentVerification({
    arVerificationStatus: row.arVerificationStatus,
    publicVerificationStatus: row.publicVerificationStatus,
    isVerified: row.isVerified,
    ownerAccount: row.ownerAccount,
  });
  if (
    inheritedVerification.arVerificationStatus === "verified" ||
    row.publicVerificationStatus === "verified"
  ) {
    const credentialId = row.ownerAccount?.publicId?.trim();
    events.push({
      label: "Verification complete",
      description:
        inheritedVerification.ownerAccountVerified && credentialId
          ? `Operator credential ${credentialId}`
          : "AgentRanking verification approved",
      date: fmt(row.lastActiveAt || row.createdAt),
      kind: "verification",
    });
  } else if (row.arVerificationStatus === "pending" || row.publicVerificationStatus === "in_review") {
    events.push({
      label: "Verification submitted",
      description: "Awaiting AgentRanking review",
      date: fmt(row.lastActiveAt || row.createdAt),
      kind: "verification",
    });
  }
  // Fee distributions
  const primaryLaunch = row.agentLaunches?.[0];
  if (primaryLaunch?.lastDistributionAt) {
    events.push({
      label: "Creator fees distributed",
      description: `Fees distributed to creator wallet`,
      date: fmt(primaryLaunch.lastDistributionAt),
      kind: "fee",
    });
  }
  // Sort most recent first
  events.sort((a, b) => b.date.localeCompare(a.date));
  return events;
}
function buildFeeTotals(row: AgentRow): NativeAgentDetailData["feeTotals"] {
  const primaryLaunch = row.agentLaunches?.[0];
  if (!primaryLaunch) return null;
  const hasFees =
    primaryLaunch.totalFeesDistributedLamports ||
    primaryLaunch.totalCreatorFeesLamports ||
    primaryLaunch.totalArFeesLamports;
  if (!hasFees) return null;
  return {
    totalFeesDistributedLamports: String(primaryLaunch.totalFeesDistributedLamports ?? 0),
    totalCreatorFeesLamports: String(primaryLaunch.totalCreatorFeesLamports ?? 0),
    totalArFeesLamports: String(primaryLaunch.totalArFeesLamports ?? 0),
    lastDistributionAt: primaryLaunch.lastDistributionAt?.toISOString() ?? null,
  };
}
async function rowToDetailData(row: AgentRow): Promise<NativeAgentDetailData> {
  // Resolve market view models for linked tokens
  const marketViewModels: Map<string, PublicTokenMarketViewModel> = new Map();
  try {
    const { getDexscreenerMarketForMint } = await import("@/lib/public-site/dexscreener");
    const { getPumpFunBondingData } = await import("@/lib/public-site/pumpfun-bonding");
    const { resolveMarketViewModel } = await import("@/lib/public-site/market-view-model");
    for (const launch of row.agentLaunches ?? []) {
      if (!launch.mint) continue;
      const network = launch.network?.trim().toLowerCase() ?? "devnet";
      const isMainnet = network === "mainnet-beta" || network === "mainnet";
      const market = isMainnet ? await getDexscreenerMarketForMint(launch.mint) : null;
      const pumpFun =
        isMainnet && !market ? await getPumpFunBondingData(launch.mint) : null;
      marketViewModels.set(
        launch.mint,
        resolveMarketViewModel({ isMainnet, mint: launch.mint, market, pumpFun }),
      );
    }
  } catch {
    // Market data is best-effort
  }
  const socials = buildSocials(row);
  const capabilities = buildCapabilities(row);
  const events = buildEvents(row);
  const feeTotals = buildFeeTotals(row);
  const onchain = await loadOnchainAgentIntelligence({
    id: row.id,
    chainId: row.chainId,
    agentId: row.agentId,
    protocolAgentId: row.protocolAgentId,
    agentURI: row.agentURI,
    listingRegistrySource: row.listingRegistrySource,
    services: row.services,
    sapVerified: row.sapVerified,
    sapAgentPda: row.sapAgentPda,
    sapStatsPda: row.sapStatsPda,
    sapCapabilities: row.sapCapabilities,
    sapPricingTiers: row.sapPricingTiers,
    sapProtocols: row.sapProtocols,
    sapX402Endpoint: row.sapX402Endpoint,
    sapRegistrationTx: row.sapRegistrationTx,
    sapLastSyncedAt: row.sapLastSyncedAt,
    sapStats: row.sapStats,
    sapOwnerWallet: row.sapOwnerWallet,
    sapRegisteredAt: row.sapRegisteredAt,
    metaplexVerified: row.metaplexVerified,
    metaplexRawData: row.metaplexRawData,
    metaplexAssetAddress: row.metaplexAssetAddress,
    metaplexAgentIdentityPda: row.metaplexAgentIdentityPda,
    metaplexAgentRegistrationUri: row.metaplexAgentRegistrationUri,
    metaplexAssetSignerPda: row.metaplexAssetSignerPda,
    metaplexAgentTokenMint: row.metaplexAgentTokenMint,
    metaplexSupportedTrust: row.metaplexSupportedTrust,
    metaplexLastIndexedAt: row.metaplexLastIndexedAt,
    solanaAssetAddress: row.solanaAssetAddress,
  });
  const now = Date.now();
  const dayMs = 86_400_000;
  const inherited = withInheritedAgentVerification({
    publicVerificationStatus: row.publicVerificationStatus,
    isVerified: row.isVerified,
    arVerificationStatus: row.arVerificationStatus,
    ownerAccount: row.ownerAccount,
  });
  const verifiedAt = resolveVerifiedAt(row, inherited);
  const solanaRegisteredAt = resolveSolanaRegisteredAt(row);
  const nativeScore = computeNativeAgentScore({
    name: row.name,
    description: row.description,
    image: row.image,
    hasWebsite: socials.some((s) => s.kind === "website"),
    hasTwitter: socials.some((s) => s.kind === "twitter"),
    hasTelegram: socials.some((s) => s.kind === "telegram"),
    hasGithub: socials.some((s) => s.kind === "github"),
    agentMode: row.agentMode,
    archetype: row.archetype,
    publicVerificationStatus: inherited.publicVerificationStatus,
    isVerified: inherited.isVerified,
    arVerificationStatus: inherited.arVerificationStatus,
    hasAgentWallet: Boolean(row.agentWallet?.publicKey),
    agentWalletPublicKey: row.agentWallet?.publicKey ?? null,
    hasTokenLaunched: (row.agentLaunches?.length ?? 0) > 0,
    tokenMint: row.agentLaunches?.[0]?.mint ?? null,
    tokenName: row.agentLaunches?.[0]?.tokenName ?? null,
    tokenSymbol: row.agentLaunches?.[0]?.tokenSymbol ?? null,
    tokenImageUrl: row.agentLaunches?.[0]?.tokenImageUrl ?? null,
    tokenHasMetadata: Boolean(
      row.agentLaunches?.[0]?.tokenName &&
      row.agentLaunches?.[0]?.tokenSymbol &&
      row.agentLaunches?.[0]?.tokenImageUrl,
    ),
    tokenHasMarketLinks: (row.agentLaunches?.length ?? 0) > 0,
    capabilitiesCount: capabilities.length,
    mcpOffersCount: row.mcpOffers?.length ?? 0,
    x402Support: row.x402Support,
    sapCapabilitiesCount: row.sapCapabilityCount,
    hasRecentActivity: new Date(row.lastActiveAt).getTime() > now - 7 * dayMs,
    hasRecentLaunch: (row.agentLaunches ?? []).some(
      (l) => new Date(l.createdAt).getTime() > now - 30 * dayMs,
    ),
    hasGithubConnection: (row.githubConnections?.length ?? 0) > 0,
  });
  const talk = resolveAgentTalkTarget(row.services, row.verificationSignals);
  const install = buildAgentInstallInfo(row.chain.shortName, row.agentId, {
    name: row.name,
    description: row.description,
    agentURI: row.agentURI,
    services: row.services,
    metadata: row.metadata.filter(
      (item) =>
        /mcp|protocol/i.test(item.key) ||
        /mcp|protocol/i.test(item.value) ||
        ["mcpTools", "mcpEndpoint", "mcp_endpoint", "protocols"].includes(item.key),
    ),
    mcpOffers: row.mcpOffers,
    officialLinks: row.officialLinks,
    paidServices: row.paidServices,
    verificationSignals: row.verificationSignals,
    sapProtocols: row.sapProtocols,
  });
  return {
    id: row.id,
    agentId: row.agentId,
    chainId: row.chainId,
    name: row.name,
    profilePath: agentPublicPath(row),
    description: row.description,
    image: row.image,
    owner: row.owner,
    isActive: row.isActive,
    isVerified: inherited.isVerified,
    isSolanaDirectoryListed: isAgentSolanaDirectoryListed(row),
    credential: toPublicAgentCredential(row.ownerAccount),
    verifiedAt,
    solanaRegisteredAt,
    publicVerificationStatus: row.publicVerificationStatus,
    arVerificationStatus: inherited.arVerificationStatus ?? row.arVerificationStatus,
    chain: row.chain,
    listingRegistrySource: row.listingRegistrySource,
    nativeScore,
    agentWalletPublicKey: row.agentWallet?.publicKey ?? null,
    socials,
    linkedTokens: (row.agentLaunches ?? []).map((l) => ({
      launchId: l.id,
      mint: l.mint!,
      symbol: l.tokenSymbol,
      name: l.tokenName,
      imageUrl: l.tokenImageUrl,
      network: l.network,
      source: resolveTokenSource(l.launchKind),
      marketView: l.mint ? marketViewModels.get(l.mint) ?? null : null,
    })),
    capabilities,
    events,
    onchain,
    feeTotals,
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    fairscaleAssessment: null,
    talk,
    install,
  };
}
/** Lookup by on-chain (chainId, agentId) pair. */
export async function loadNativeAgentDetailData(
  chainId: number,
  agentId: number,
): Promise<NativeAgentDetailData> {
  if (!Number.isFinite(chainId) || !Number.isFinite(agentId)) notFound();
  const agent = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: AGENT_DETAIL_SELECT,
  });
  if (!agent) notFound();
  const data = await rowToDetailData(agent);
  let fairscaleAssessment: FairscalePublicAssessment | null = null;
  if (fairscaleEnabled()) {
    try {
      fairscaleAssessment = await getFairscaleAssessmentForAgent(agent.id);
    } catch (e) {
      console.warn("[fairscale] load failed", agent.id, e);
      fairscaleAssessment = emptyFairscalePublicAssessment("temporarily_unavailable");
    }
  }
  return { ...data, fairscaleAssessment };
}
