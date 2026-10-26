import type { AgentDetail } from "@/types/agent-detail";
import { getChainByChainId } from "@/lib/chains";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import {
  COVENANT_VERIFICATION_SNAPSHOT_KEY,
  COVENANT_VERIFY_SPEC_VERSION,
} from "@/lib/covenant/config";
import type {
  CovenantDashboardAgentRow,
  CovenantDashboardPayload,
} from "@/lib/covenant/covenant-dashboard";
import { buildCovenantDetail, serializeCovenantVerificationSnapshot } from "@/lib/covenant/snapshot";
import { emptyChecks, isFullCovenantVerifiedStatus } from "@/lib/covenant/status";
import type { CovenantVerificationSnapshot } from "@/lib/covenant/types";
/** Dev-only SAP Covenant reference agents (not in Postgres until indexed on-chain). */
const PREVIEW_SPECS = [
  {
    agentId: 30_534,
    covenantSlug: "covenant",
    name: "Covenant",
    description:
      "Reference Covenant runtime agent (production PDA indexed on VPS). Dev preview when local development data has no covenant.runtime/v1 row.",
    protocols: ["covenant.runtime/v1", "a2a", "x402"] as const,
    capabilities: [
      { id: "tool.route", protocolId: "covenant.runtime/v1", version: "1", description: "Covenant runtime" },
    ],
    status: "identity_only" as const,
  },
  {
    agentId: 990_101,
    covenantSlug: "covenant-audit",
    name: "Covenant Audit",
    description:
      "Verifies Covenant audit roots and provenance envelopes. Public CLI; the agent that verifies other agents.",
    protocols: ["covenant.runtime/v1", "covenant.audit/v1"] as const,
    capabilities: [
      { id: "audit.verify", protocolId: "covenant.audit/v1", version: "1", description: "Verify audit-root attestation" },
      { id: "tool.attest", protocolId: "covenant.audit/v1", version: "1", description: "Produce provenance attestation envelope" },
    ],
    status: "identity_only" as const,
  },
  {
    agentId: 990_102,
    covenantSlug: "covenant-coder",
    name: "Covenant Coder",
    description: "Public Covenant coding agent. Hermes-compatible gateway, sandboxed, audit-rooted runs.",
    protocols: ["covenant.runtime/v1", "covenant.coding/v1", "x402"] as const,
    capabilities: [
      { id: "tool.code_exec", protocolId: "covenant.coding/v1", version: "1", description: "Execute code in sandbox" },
      { id: "tool.web_search", protocolId: "covenant.coding/v1", version: "1", description: "Web search tool" },
    ],
    status: "verified" as const,
  },
  {
    agentId: 990_103,
    covenantSlug: "covenant-router",
    name: "Covenant Router",
    description: "A2A intent router for cross-agent reputation and delegation.",
    protocols: ["covenant.runtime/v1", "covenant.a2a/v1"] as const,
    capabilities: [
      { id: "intent.route", protocolId: "covenant.a2a/v1", version: "1", description: "Route agent intent" },
    ],
    status: "indexed" as const,
  },
] as const;
export const DEV_COVENANT_PREVIEW_AGENT_IDS: ReadonlySet<number> = new Set(
  PREVIEW_SPECS.map((s) => s.agentId),
);
export function isDevCovenantPreviewEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}
export function isDevCovenantPreviewAgent(chainId: number, agentId: number): boolean {
  return isDevCovenantPreviewEnabled() && chainId === SOLANA_CHAIN_ID && DEV_COVENANT_PREVIEW_AGENT_IDS.has(agentId);
}
export function getDevCovenantPreviewRouteIdentity(
  chainId: number,
  agentId: number,
): { id: number; chainId: number; agentId: number; name: string } | null {
  if (!isDevCovenantPreviewAgent(chainId, agentId)) return null;
  const spec = PREVIEW_SPECS.find((candidate) => candidate.agentId === agentId);
  return spec ? { id: spec.agentId, chainId, agentId, name: spec.name } : null;
}
function snapshotForStatus(
  status: (typeof PREVIEW_SPECS)[number]["status"],
): CovenantVerificationSnapshot {
  const checks = emptyChecks();
  if (status === "identity_only") {
    checks.identity_binding = "pass";
    checks.manifest_binding = "pass";
  } else if (status === "verified") {
    for (const k of Object.keys(checks) as Array<keyof typeof checks>) {
      checks[k] = "pass";
    }
  }
  return {
    specVersion: COVENANT_VERIFY_SPEC_VERSION,
    checkedAt: "2026-05-30T12:00:00.000Z",
    checks,
    missingChecks: [],
    reasons: ["Covenant: dev preview agent (reference manifest — not yet indexed in Postgres)"],
    rootHashHex: status !== "indexed" ? "a1b2c3d4e5f6789012345678abcdef0123456789abcdef0123456789abcdef01" : undefined,
    rootSignedBy: status === "verified" ? "AdChcPreviewDevWallet111111111111111111111" : undefined,
  };
}
export function buildDevCovenantPreviewDetail(chainId: number, agentId: number): AgentDetail | null {
  if (!isDevCovenantPreviewAgent(chainId, agentId)) return null;
  const spec = PREVIEW_SPECS.find((s) => s.agentId === agentId);
  if (!spec) return null;
  const chain = getChainByChainId(SOLANA_CHAIN_ID);
  const snap = snapshotForStatus(spec.status);
  const metadata = [
    {
      key: "covenant_verification_snapshot",
      value: serializeCovenantVerificationSnapshot(snap),
    },
  ];
  const covenant = buildCovenantDetail(
    {
      sapProtocols: [...spec.protocols],
      sapAgentPda: `DevCovenantPda${spec.agentId}`,
      sapOwnerWallet: "DevCovenantOwner1111111111111111111111111111",
      sapCapabilities: spec.capabilities,
      agentURI: `https://covenant.tools/agents/${spec.covenantSlug.replace("covenant-", "")}/.well-known/agent.json`,
      isActive: true,
    },
    metadata,
  );
  const now = new Date().toISOString();
  const slug = toAgentUrlSlug(spec.name);
  const agentUri = `https://covenant.tools/agents/${spec.covenantSlug.replace("covenant-", "")}/.well-known/agent.json`;
  const detail = {
    id: spec.agentId,
    agentId: spec.agentId,
    chainId: SOLANA_CHAIN_ID,
    name: spec.name,
    slug,
    profilePath: agentPublicPath({ chainId: SOLANA_CHAIN_ID, agentId: spec.agentId, name: spec.name }),
    description: spec.description,
    image: "",
    owner: "DevCovenantOwner1111111111111111111111111111",
    agentURI: agentUri,
    isActive: true,
    isVerified: false,
    isPremiumVerified: false,
    binanceCompatible: false,
    score: 72,
    rank: 1,
    x402Support: spec.protocols.some((p) => p.toLowerCase() === "x402"),
    hasPublishedMcpOffers: false,
    stars: 0,
    totalFeedback: 0,
    totalMessages: 0,
    totalChats: 0,
    totalWatches: 0,
    scoreQuality: 0,
    scorePopularity: 0,
    scoreActivity: 0,
    scoreWallet: 0,
    scoreFreshness: 0,
    scoreMetadata: 0,
    supportedTrust: "",
    createdAt: now,
    lastActiveAt: now,
    organicRank: 1,
    agentRankScore: 72,
    protocolTrustScore: 72,
    executionScore: 0,
    hasDuplicateName: false,
    chain: {
      name: chain?.name ?? "Solana",
      shortName: chain?.shortName ?? "SOL",
      color: chain?.color ?? "#9945FF",
      icon: chain?.icon ?? "/chains/solana.svg",
      chainId: SOLANA_CHAIN_ID,
    },
    services: [],
    metadata: metadata.map((m, i) => ({ id: i + 1, key: m.key, value: m.value })),
    feedbacks: [],
    sapVerified: true,
    sapTwinMatch: false,
    sapAgentPda: `DevCovenantPda${spec.agentId}`,
    sapOwnerWallet: "DevCovenantOwner1111111111111111111111111111",
    sapProtocols: [...spec.protocols],
    sapCapabilities: spec.capabilities,
    sapPricingTiers: [],
    sapLastSyncedAt: now,
    sapRegisteredAt: now,
    listingRegistrySource: "sap",
    covenant,
  } satisfies AgentDetail;
  return detail;
}
const PREVIEW_SCORE: Record<(typeof PREVIEW_SPECS)[number]["status"], number> = {
  indexed: 60,
  identity_only: 72,
  verified: 88,
};
function devCovenantDashboardRow(spec: (typeof PREVIEW_SPECS)[number]): CovenantDashboardAgentRow {
  const now = new Date().toISOString();
  const snap = snapshotForStatus(spec.status);
  const metadata = [
    {
      key: COVENANT_VERIFICATION_SNAPSHOT_KEY,
      value: serializeCovenantVerificationSnapshot(snap),
    },
  ];
  const protocols = [...spec.protocols];
  const covenant = buildCovenantDetail(
    {
      sapProtocols: protocols,
      sapAgentPda: `DevCovenantPda${spec.agentId}`,
      isActive: true,
    },
    metadata,
  );
  const agentURI = `https://covenant.tools/agents/${spec.covenantSlug.replace("covenant-", "")}/.well-known/agent.json`;
  return {
    id: spec.agentId,
    chainId: SOLANA_CHAIN_ID,
    agentId: spec.agentId,
    name: spec.name,
    slug: toAgentUrlSlug(spec.name),
    profilePath: agentPublicPath({ chainId: SOLANA_CHAIN_ID, agentId: spec.agentId, name: spec.name }),
    agentRankScore: PREVIEW_SCORE[spec.status],
    image: "",
    sapAgentPda: `DevCovenantPda${spec.agentId}`,
    sapProtocols: protocols,
    x402Support: protocols.some((p) => p.toLowerCase() === "x402"),
    sapLastSyncedAt: now,
    agentURI,
    covenant,
  };
}
/** Local development fixture used only when the database contains no Covenant rows. */
export function buildDevCovenantDashboardPayload(): CovenantDashboardPayload {
  const agents = PREVIEW_SPECS.map(devCovenantDashboardRow);
  let verifiedCount = 0;
  let pendingCount = 0;
  let x402EnabledCount = 0;
  for (const row of agents) {
    if (isFullCovenantVerifiedStatus(row.covenant.status)) verifiedCount += 1;
    else if (row.covenant.isCovenant) pendingCount += 1;
    if (row.x402Support) x402EnabledCount += 1;
  }
  const now = new Date().toISOString();
  return {
    stats: {
      indexedCount: agents.length,
      verifiedCount,
      pendingCount,
      x402EnabledCount,
      lastIndexedAt: now,
      lastVerifiedAt: verifiedCount > 0 ? now : null,
    },
    agents,
    agentsHasMore: false,
    dashboardSource: "dev-preview",
  };
}
