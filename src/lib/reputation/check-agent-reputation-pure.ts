/**
 * Pure helpers for reputation check — no Prisma / server-only.
 */
import { normalizeWallet } from "@/lib/trust-oracle-logic";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
import { isCovenantAgent, metadataIndicatesCovenant } from "@/lib/covenant/detect";
import { isHatcherAgent } from "@/lib/hatcher/detect";
import { isMetaplexAgent } from "@/lib/metaplex/detect";
import { hatcherBadgeLabel } from "@/lib/hatcher/labels";
import type { HatcherDetailPayload } from "@/lib/hatcher/types";
import type { CovenantDetailPayload } from "@/lib/covenant/types";
import {
  type AgentReputationCheckInput,
  type AgentReputationCheckResponse,
  type AgentReputationCheckScores,
  type CheckRecommendation,
  type RegistryType,
  DEFAULT_REPUTATION_CHECK_DISCLAIMER,
  HATCHER_REPUTATION_CHECK_DISCLAIMER,
  InvalidCheckInputError,
} from "@/lib/reputation/check-agent-reputation-types";
export type CheckAgentRowForClassify = {
  chainId: number;
  listingRegistrySource?: string | null;
  metaplexAssetAddress?: string | null;
  metaplexVerified?: boolean | null;
  sapVerified?: boolean | null;
  sapProtocols?: string[] | null;
  sapCapabilities?: unknown;
  metadata?: Array<{ key: string; value: string }>;
};
export function parseReputationCheckSearchParams(
  searchParams: URLSearchParams,
): AgentReputationCheckInput {
  const wallet = searchParams.get("wallet")?.trim() ?? "";
  const hatcherId = searchParams.get("hatcherId")?.trim() ?? "";
  const chainIdRaw = searchParams.get("chainId")?.trim() ?? "";
  const agentIdRaw = searchParams.get("agentId")?.trim() ?? "";
  const profileUrl = searchParams.get("profileUrl")?.trim() ?? "";
  const modes = [
    wallet.length > 0,
    hatcherId.length > 0,
    chainIdRaw.length > 0 && agentIdRaw.length > 0,
    profileUrl.length > 0,
  ].filter(Boolean).length;
  if (modes === 0) {
    throw new InvalidCheckInputError(
      "Provide exactly one lookup: wallet, hatcherId, chainId+agentId, or profileUrl.",
    );
  }
  if (modes > 1) {
    throw new InvalidCheckInputError(
      "Provide only one lookup mode at a time (wallet, hatcherId, chainId+agentId, or profileUrl).",
    );
  }
  if (wallet) {
    normalizeWallet(wallet);
    return { mode: "wallet", wallet };
  }
  if (hatcherId) return { mode: "hatcherId", hatcherId };
  if (profileUrl) return { mode: "profileUrl", url: profileUrl };

  const chainId = parsePublicChainId(chainIdRaw);
  const agentId = parsePublicAgentId(agentIdRaw);
  if (chainId == null) {
    throw new InvalidCheckInputError("chainId must be a canonical positive PostgreSQL integer.");
  }
  if (agentId == null) {
    throw new InvalidCheckInputError("agentId must be a canonical signed PostgreSQL integer.");
  }
  return { mode: "chainAgentId", chainId, agentId };
}

export function classifyRegistryType(row: CheckAgentRowForClassify): RegistryType {
  if (
    isHatcherAgent({
      chainId: row.chainId,
      listingRegistrySource: row.listingRegistrySource,
      metadata: row.metadata,
    })
  ) {
    return "hatcher";
  }
  if (
    isMetaplexAgent({
      listingRegistrySource: row.listingRegistrySource,
      metaplexAssetAddress: row.metaplexAssetAddress,
      metaplexVerified: row.metaplexVerified,
    })
  ) {
    return "metaplex";
  }
  if (
    isCovenantAgent(row.sapProtocols, row.sapCapabilities) ||
    metadataIndicatesCovenant(row.metadata)
  ) {
    return "covenant";
  }
  if (row.sapVerified === true) {
    return "sap";
  }
  return "erc8004";
}
export function buildUnknownCheckResponse(
  input: AgentReputationCheckInput,
  checkedAt: string,
): AgentReputationCheckResponse {
  const hint =
    input.mode === "wallet"
      ? input.wallet
      : input.mode === "hatcherId"
        ? input.hatcherId
        : input.mode === "profileUrl"
          ? input.url
          : input.mode === "chainAgentId"
            ? `${input.chainId}/${input.agentId}`
            : "unknown";
  return {
    ok: true,
    isRegistered: false,
    registryType: "unknown",
    recommendation: "caution",
    agent: null,
    scores: {
      agentRankScore: null,
      protocolTrustScore: null,
      reputationScore: null,
      partnerDiscoveryScore: null,
      confidence: null,
    },
    verification: {
      kyaVerified: false,
      sapVerified: false,
      covenantStatus: null,
      hatcherBadge: null,
    },
    warnings: ["Agent not found on AgentRanking."],
    reasons: [`No registered agent matched lookup: ${hint}`],
    links: {},
    disclaimer: DEFAULT_REPUTATION_CHECK_DISCLAIMER,
    checkedAt,
  };
}
export function buildHatcherCheckScores(hatcher: HatcherDetailPayload): AgentReputationCheckScores {
  const partnerDiscoveryScore = hatcher.isHatcher
    ? Math.max(0, Math.min(100, Math.round(hatcher.partnerScore)))
    : null;
  return {
    agentRankScore: null,
    protocolTrustScore: null,
    reputationScore: null,
    partnerDiscoveryScore,
    confidence: "partner_discovery",
  };
}
export function deriveHatcherRecommendation(
  hatcher: HatcherDetailPayload,
  warnings: string[],
): CheckRecommendation {
  if (!hatcher.isHatcher || !hatcher.hatcher) return "caution";
  const snap = hatcher.hatcher;
  const passportOk =
    (snap.passportSnapshot) != null &&
    typeof (snap.passportSnapshot) === "object";
  const mcpOk =
    snap.mcpManifestSnapshot != null &&
    typeof snap.mcpManifestSnapshot === "object";
  if (warnings.some((w) => w.toLowerCase().includes("inactive"))) return "high_risk";
  if (hatcher.partnerScore < 25 && !passportOk && !mcpOk) return "high_risk";
  return "caution";
}
export function hatcherVerificationBadge(hatcher: HatcherDetailPayload): string | null {
  if (!hatcher.isHatcher || !hatcher.hatcher) return null;
  return hatcherBadgeLabel(hatcher.hatcher);
}
export function covenantStatusLabel(covenant: CovenantDetailPayload): string | null {
  if (!covenant.isCovenant) return null;
  return covenant.status;
}
export function hatcherLinksFromDetail(
  hatcher: HatcherDetailPayload,
  agentRankingProfileUrl: string,
): AgentReputationCheckResponse["links"] {
  const links = hatcher.hatcher?.links;
  if (!links) {
    return { agentRankingProfile: agentRankingProfileUrl };
  }
  return {
    profile: links.profile,
    chat: links.chat,
    room: links.room,
    status: links.status,
    passport: links.passport,
    mcpManifest: links.mcpManifest,
    agentRankingProfile: agentRankingProfileUrl,
  };
}
export {
  HATCHER_REPUTATION_CHECK_DISCLAIMER,
  DEFAULT_REPUTATION_CHECK_DISCLAIMER,
};
