import { prisma } from "@/lib/db";
import { appendOrbitLaunchTrustTile } from "@/lib/orbit/trust-tile";
import type { DerivedSignal, TrustSummaryTile } from "@/lib/signals/types";
import { upsertAgentSignals, listAgentSignals } from "@/lib/signals/store";
type AgentForDerive = {
  id: number;
  isVerified: boolean;
  isPremiumVerified: boolean;
  isVerifiedRevenue: boolean;
  sapVerified: boolean;
  sapTwinMatch?: boolean;
  x402Support: boolean;
  tokenAddress: string;
  verifiedWallet: string;
  publicVerificationStatus: string;
  owner: string;
  services: Array<{ name: string; endpoint: string }>;
  metadata: Array<{ key: string; value: string }>;
  verificationRequests: Array<{ verificationStatus: string }>;
};
function metaValue(metadata: Array<{ key: string; value: string }>, key: string): string {
  return metadata.find((m) => m.key === key)?.value?.trim() ?? "";
}
export function deriveSignalsFromAgent(agent: AgentForDerive): DerivedSignal[] {
  const signals: DerivedSignal[] = [];
  const now = new Date();
  if (agent.isPremiumVerified || agent.isVerified) {
    signals.push({
      signalType: "agentranking_verified",
      status: "verified",
      source: "admin",
      confidence: "high",
      value: agent.isPremiumVerified ? "premium" : "standard",
      verifiedAt: now,
    });
    signals.push({
      signalType: "claimed_by_team",
      status: "verified",
      source: "wallet_signature",
      confidence: "high",
      value: agent.owner || "claimed",
      verifiedAt: now,
    });
  } else if (agent.publicVerificationStatus === "submitted" || agent.publicVerificationStatus === "in_review") {
    signals.push({
      signalType: "claimed_by_team",
      status: "submitted",
      source: "user_submission",
      confidence: "medium",
    });
  }
  if (agent.sapVerified || agent.sapTwinMatch) {
    signals.push({
      signalType: "sap_registered",
      status: "partner_registered",
      source: "sap",
      confidence: "high",
      value: "Registered",
    });
    signals.push({
      signalType: "partner_registered",
      status: "partner_registered",
      source: "protocol_index",
      confidence: "high",
      value: "SAP",
    });
  }
  if (agent.verifiedWallet?.trim()) {
    signals.push({
      signalType: "payment_wallet_verified",
      status: agent.isVerifiedRevenue ? "verified" : "detected",
      source: "wallet_signature",
      confidence: agent.isVerifiedRevenue ? "high" : "medium",
      value: agent.verifiedWallet,
    });
  }
  if (agent.x402Support) {
    signals.push({
      signalType: "x402_detected",
      status: "detected",
      source: "x402",
      confidence: "medium",
      value: "supported",
    });
  }
  const twitter = metaValue(agent.metadata, "twitter");
  const github = metaValue(agent.metadata, "github");
  const website = metaValue(agent.metadata, "website");
  if (twitter) {
    signals.push({
      signalType: "x_verified",
      status: "detected",
      source: "user_submission",
      confidence: "low",
      value: twitter,
    });
  }
  if (github) {
    signals.push({
      signalType: "github_verified",
      status: "detected",
      source: "user_submission",
      confidence: "low",
      value: github,
    });
  }
  if (website) {
    signals.push({
      signalType: "domain_verified",
      status: "detected",
      source: "user_submission",
      confidence: "low",
      value: website,
    });
  }
  if (agent.tokenAddress?.trim()) {
    signals.push({
      signalType: "token_verified",
      status: "submitted",
      source: "user_submission",
      confidence: "medium",
      value: agent.tokenAddress,
    });
  }
  for (const svc of agent.services) {
    const name = svc.name.toUpperCase();
    if (name === "MCP") {
      signals.push({
        signalType: "mcp_detected",
        status: "detected",
        source: "mcp",
        confidence: "medium",
        value: svc.endpoint,
        lastCheckedAt: now,
      });
    }
    if (name === "A2A") {
      signals.push({
        signalType: "a2a_detected",
        status: "detected",
        source: "protocol_index",
        confidence: "medium",
        value: svc.endpoint,
        lastCheckedAt: now,
      });
    }
    if (svc.endpoint?.trim()) {
      signals.push({
        signalType: "endpoint_live",
        status: "detected",
        source: "endpoint_check",
        confidence: "low",
        value: `${svc.name}:${svc.endpoint}`,
        lastCheckedAt: now,
      });
    }
  }
  const locked = metaValue(agent.metadata, "officialLinksLocked");
  if (locked === "true" || locked === "1") {
    signals.push({
      signalType: "official_links_locked",
      status: "verified",
      source: "user_submission",
      confidence: "high",
      verifiedAt: now,
    });
  }
  return signals;
}
export async function syncDerivedSignalsForAgent(agentId: number) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      isVerified: true,
      isPremiumVerified: true,
      isVerifiedRevenue: true,
      sapVerified: true,
      x402Support: true,
      tokenAddress: true,
      verifiedWallet: true,
      publicVerificationStatus: true,
      owner: true,
      services: { select: { name: true, endpoint: true } },
      metadata: { select: { key: true, value: true } },
      verificationRequests: {
        select: { verificationStatus: true },
        orderBy: { submittedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!agent) return [];
  const derived = deriveSignalsFromAgent(agent);
  await upsertAgentSignals(agentId, derived);
  return derived;
}
export function buildTrustSummaryTiles(
  signals: ReadonlyArray<Pick<DerivedSignal, "signalType" | "status" | "value">>,
): TrustSummaryTile[] {
  const byType = new Map<string, Pick<DerivedSignal, "signalType" | "status" | "value">>(
    signals.map((s) => [String(s.signalType), s]),
  );
  const tile = (
    key: string,
    label: string,
    signalType: string,
    fallback = "—",
  ): TrustSummaryTile => {
    const s = byType.get(signalType);
    return {
      key,
      label,
      value: s?.value || (s?.status === "verified" ? "Yes" : fallback),
      status: (s?.status as TrustSummaryTile["status"]) ?? "unknown",
      title: s?.value || undefined,
    };
  };
  return [
    tile("verified", "AgentRanking", "agentranking_verified", "Not verified"),
    tile("claimed", "Claimed", "claimed_by_team", "Unclaimed"),
    tile("sap", "SAP registered", "sap_registered", "—"),
    tile("mcp", "MCP", "mcp_detected", "Off"),
    tile("x402", "x402", "x402_detected", "Off"),
    tile("endpoint", "Endpoints", "endpoint_live", "—"),
    tile("links", "Official links", "official_links_locked", "Unlocked"),
    tile("devproof", "DevProof", "devproof_active", "Inactive"),
  ];
}
/** Read-only trust summary for public agent profiles (no derive pass on page load). */
export async function getPublicTrustSummary(agentId: number) {
  const signals = (await listAgentSignals(agentId)) as DerivedSignal[];
  const metadata = await prisma.agentMetadata.findMany({
    where: { agentId },
    select: { key: true, value: true },
  });
  return {
    signals,
    tiles: appendOrbitLaunchTrustTile(buildTrustSummaryTiles(signals), metadata),
  };
}
export type ProfileTrustEnrichment = {
  sapVerified?: boolean;
  sapTwinMatch?: boolean;
  sapAgentPda?: string | null;
  x402Support?: boolean;
  hasPublishedMcpOffers?: boolean;
  services?: ReadonlyArray<{ name: string; endpoint: string }>;
};
function upsertSignal(
  signals: DerivedSignal[],
  signal: DerivedSignal,
): DerivedSignal[] {
  const idx = signals.findIndex((s) => s.signalType === signal.signalType);
  if (idx === -1) return [...signals, signal];
  const next = [...signals];
  next[idx] = signal;
  return next;
}
function upsertTile(tiles: TrustSummaryTile[], tile: TrustSummaryTile): TrustSummaryTile[] {
  const idx = tiles.findIndex((t) => t.key === tile.key);
  if (idx === -1) return [...tiles, tile];
  const next = [...tiles];
  next[idx] = tile;
  return next;
}
/** Merge live profile fields (SAP twin, x402, MCP) into stored signal tiles for SSR/API. */
export function enrichTrustSummaryForProfile(
  summary: { signals: DerivedSignal[]; tiles: TrustSummaryTile[] },
  enrichment: ProfileTrustEnrichment,
): { signals: DerivedSignal[]; tiles: TrustSummaryTile[] } {
  let { signals, tiles } = summary;
  const sapBacked =
    enrichment.sapVerified === true ||
    enrichment.sapTwinMatch === true ||
    Boolean(enrichment.sapAgentPda?.trim());
  if (sapBacked) {
    signals = upsertSignal(signals, {
      signalType: "sap_registered",
      status: "partner_registered",
      source: "sap",
      confidence: "high",
      value: "Registered",
    });
    tiles = upsertTile(tiles, {
      key: "sap",
      label: "SAP registered",
      value: "Registered",
      status: "partner_registered",
      title: "SAP on-chain identity",
    });
  }
  if (enrichment.x402Support) {
    signals = upsertSignal(signals, {
      signalType: "x402_detected",
      status: "detected",
      source: "x402",
      confidence: "medium",
      value: "On",
    });
    tiles = upsertTile(tiles, {
      key: "x402",
      label: "x402",
      value: "On",
      status: "detected",
    });
  }
  const mcpFromServices = enrichment.services?.some((s) => s.name.toUpperCase() === "MCP");
  if (enrichment.hasPublishedMcpOffers || mcpFromServices) {
    const endpoint = enrichment.services?.find((s) => s.name.toUpperCase() === "MCP")?.endpoint;
    signals = upsertSignal(signals, {
      signalType: "mcp_detected",
      status: "detected",
      source: "mcp",
      confidence: "medium",
      value: endpoint || "On",
    });
    tiles = upsertTile(tiles, {
      key: "mcp",
      label: "MCP",
      value: "On",
      status: "detected",
      title: endpoint || undefined,
    });
  }
  return { signals, tiles };
}