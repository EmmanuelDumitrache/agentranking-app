import { Prisma } from "@/generated/prisma/client";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { computeProtocolTrustScoreFromAgentDimensions } from "@/lib/agent-score";
import { prisma } from "@/lib/db";
import { ORBIT_CURATED_MCP_VERSION } from "@/lib/orbit/orbit-api";
import {
  getOrbitMcpReadiness,
  type McpReadiness,
} from "@/lib/orbit/orbit-mcp-readiness";
import {
  getOrbitSkillById as getOrbitSkillByIdFromTaxonomy,
  getOrbitSkills as getOrbitSkillsFromTaxonomy,
  type OrbitSkill,
} from "@/lib/orbit/orbit-skill-taxonomy";
export type OrbitMatchType = "manual" | "exact" | "keyword" | "similar" | "fallback";
export type OrbitCuratedAgent = {
  rank: number;
  agentId: string;
  chainId: number;
  onChainAgentId: number;
  name: string;
  slug: string;
  profilePath: string;
  description: string;
  avatarUrl: string | null;
  websiteUrl: string | null;
  sourceProtocol: string;
  protocolTrustScore: number;
  verified: boolean;
  devProof: boolean;
  mcpReadiness: McpReadiness;
  mcpEndpoint?: string;
  paymentMethods: string[];
  matchedSkills: string[];
  matchType: OrbitMatchType;
  reason: string;
};
export type OrbitCuratedSkillResult = {
  version: typeof ORBIT_CURATED_MCP_VERSION;
  skill: OrbitSkill;
  supportedByAgentRanking: boolean;
  generatedAt: string;
  results: OrbitCuratedAgent[];
  fallbackResults: OrbitCuratedAgent[];
  notes: string[];
};
export type OrbitCuratedAgentOptions = {
  limit?: number;
  mcpOnly?: boolean;
  verifiedOnly?: boolean;
};
type ManualCuratedOverride = {
  agentId?: number;
  chainId?: number;
  nameIncludes?: string;
  boost: number;
  reason: string;
};
const ORBIT_AGENT_LIMIT = 750;
const DEFAULT_RESULT_LIMIT = 10;
const MANUAL_CURATED_OVERRIDES: Record<string, ManualCuratedOverride[]> = {};
const ORBIT_AGENT_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  description: true,
  image: true,
  agentURI: true,
  owner: true,
  isActive: true,
  isVerified: true,
  isPremiumVerified: true,
  publicVerificationStatus: true,
  x402Support: true,
  isSmartBatchEnabled: true,
  score: true,
  protocolTrustScore: true,
  executionScore: true,
  rank: true,
  agentRankScore: true,
  activityScore: true,
  scoreWallet: true,
  scoreMetadata: true,
  scoreServices: true,
  scoreQuality: true,
  scorePopularity: true,
  scoreFreshness: true,
  supportedTrust: true,
  archetype: true,
  agentMode: true,
  verifiedWallet: true,
  isVerifiedRevenue: true,
  perfWinRate: true,
  perfAvgPnlPercent: true,
  perfBurnToEarnRatio: true,
  perfTotalVolumeUsd: true,
  perfMonthlyPnlUsd: true,
  perfLastComputedAt: true,
  perfTxCount: true,
  activeWinRate30d: true,
  nativeVolume30d: true,
  activityUpdatedAt: true,
  lastActiveAt: true,
  listedAt: true,
  createdAt: true,
  listingRegistrySource: true,
  sapVerified: true,
  sapCapabilities: true,
  sapProtocols: true,
  sapX402Endpoint: true,
  metaplexVerified: true,
  metaplexSourceType: true,
  metaplexRawData: true,
  metaplexLastIndexedAt: true,
  chain: { select: { name: true, shortName: true } },
  services: { select: { name: true, endpoint: true, version: true } },
  metadata: { select: { key: true, value: true } },
  mcpOffers: {
    where: { isPublished: true },
    select: {
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
      title: true,
      description: true,
      serviceType: true,
      endpointUrl: true,
      isPublished: true,
    },
  },
  verificationSignals: {
    select: {
      signalType: true,
      status: true,
      source: true,
      confidence: true,
      value: true,
    },
  },
  githubConnections: {
    select: {
      status: true,
      repoFullName: true,
      lastSyncedAt: true,
    },
  },
  githubSnapshots: {
    orderBy: { capturedAt: "desc" },
    take: 1,
    select: {
      commitCount30d: true,
      releaseCount: true,
      contributorCount: true,
      lastCommitAt: true,
      capturedAt: true,
    },
  },
} satisfies Prisma.AgentSelect;
type OrbitAgentRow = Prisma.AgentGetPayload<{ select: typeof ORBIT_AGENT_SELECT }>;
type ScoredOrbitAgent = {
  row: OrbitAgentRow;
  score: number;
  matchType: OrbitMatchType;
  matchedSkills: string[];
  mcpReadiness: ReturnType<typeof getOrbitMcpReadiness>;
  manualReason: string | null;
  textHits: string[];
};
export function getOrbitSkills(): OrbitSkill[] {
  return getOrbitSkillsFromTaxonomy();
}
export function getOrbitSkillById(skillId: string): OrbitSkill | null {
  return getOrbitSkillByIdFromTaxonomy(skillId);
}
function normalize(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim();
}
function includesNormalized(corpus: string, term: string): boolean {
  const normalizedTerm = normalize(term);
  return Boolean(normalizedTerm) && corpus.includes(normalizedTerm);
}
function stringifyJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
function metadataValue(row: OrbitAgentRow, keys: string[]): string | null {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const item = row.metadata.find((entry) => wanted.has(entry.key.toLowerCase()));
  return item?.value?.trim() || null;
}
function structuredCorpus(row: OrbitAgentRow): string {
  const skillMetadataKeys = new Set([
    "skills",
    "skill",
    "capabilities",
    "capability",
    "tags",
    "tag",
    "mcpTools",
    "a2aSkills",
    "category",
    "categories",
    "archetype",
    "service",
    "services",
  ].map((key) => key.toLowerCase()));
  const skillMetadata = row.metadata.filter((item) => skillMetadataKeys.has(item.key.toLowerCase()));
  const parts = [
    row.archetype,
    row.agentMode,
    row.supportedTrust,
    row.listingRegistrySource,
    row.sapProtocols.join(" "),
    stringifyJson(row.sapCapabilities),
    ...row.services.map((service) => `${service.name} ${service.version}`),
    ...skillMetadata.map((item) => `${item.key} ${item.value}`),
    ...row.mcpOffers.map((offer) => `${offer.title} ${offer.summary}`),
    ...row.paidServices.map((service) => `${service.title} ${service.description} ${service.serviceType}`),
    ...row.verificationSignals.map((signal) => `${signal.signalType} ${signal.status} ${signal.value}`),
  ];
  return normalize(parts.join(" "));
}
function textCorpus(row: OrbitAgentRow): string {
  return normalize(`${row.name} ${row.description}`);
}
function manualOverrideForSkill(skill: OrbitSkill, row: OrbitAgentRow): ManualCuratedOverride | null {
  const overrides = MANUAL_CURATED_OVERRIDES[skill.id] ?? [];
  return (
    overrides.find((override) => {
      if (override.agentId != null && override.agentId !== row.agentId) return false;
      if (override.chainId != null && override.chainId !== row.chainId) return false;
      if (override.nameIncludes && !row.name.toLowerCase().includes(override.nameIncludes.toLowerCase())) {
        return false;
      }
      return true;
    }) ?? null
  );
}
function matchingTerms(skill: OrbitSkill, row: OrbitAgentRow): {
  exactHits: string[];
  keywordHits: string[];
  similarHits: string[];
} {
  const structured = structuredCorpus(row);
  const text = textCorpus(row);
  const exactTerms = [skill.id, skill.label, ...skill.aliases, ...skill.searchTerms];
  const similarTerms = skill.similarSkills.flatMap((similarId) => {
    const similar = getOrbitSkillByIdFromTaxonomy(similarId);
    return similar ? [similar.id, similar.label, ...similar.aliases, ...similar.searchTerms] : [similarId];
  });
  const exactHits = exactTerms.filter((term) => includesNormalized(structured, term));
  const keywordHits = exactTerms.filter((term) => includesNormalized(text, term));
  const similarHits = similarTerms.filter((term) => includesNormalized(`${structured} ${text}`, term));
  return {
    exactHits: [...new Set(exactHits)],
    keywordHits: [...new Set(keywordHits)],
    similarHits: [...new Set(similarHits)],
  };
}
function computeProtocolTrustScore(row: OrbitAgentRow): number {
  const computed = computeProtocolTrustScoreFromAgentDimensions({
    scoreMetadata: row.scoreMetadata,
    scoreServices: row.scoreServices,
    scoreWallet: row.scoreWallet,
    scoreQuality: row.scoreQuality,
    scorePopularity: row.scorePopularity,
    scoreFreshness: row.scoreFreshness,
    x402Support: row.x402Support,
    binanceCompatible: false,
    metadata: row.metadata,
    services: row.services,
  });
  const stored = row.protocolTrustScore > 0 ? row.protocolTrustScore : row.score;
  return Math.max(0, Math.min(100, Math.round(Math.max(stored, computed))));
}
function hasDevProof(row: OrbitAgentRow): boolean {
  const hasConnectedRepo = row.githubConnections.some((connection) =>
    ["active", "connected", "verified"].includes(connection.status.toLowerCase()),
  );
  const hasRecentSnapshot = row.githubSnapshots.some((snapshot) => {
    return snapshot.commitCount30d > 0 || snapshot.releaseCount > 0 || snapshot.contributorCount > 0;
  });
  const hasSignal = row.verificationSignals.some((signal) => {
    const type = signal.signalType.toLowerCase();
    const status = signal.status.toLowerCase();
    return (type === "devproof_active" || type === "repo_connected") && ["verified", "detected"].includes(status);
  });
  return hasConnectedRepo || hasRecentSnapshot || hasSignal;
}
function recentActivityScore(row: OrbitAgentRow): number {
  const candidates = [
    row.perfLastComputedAt,
    row.activityUpdatedAt,
    row.metaplexLastIndexedAt,
    row.lastActiveAt,
    row.listedAt,
    row.createdAt,
  ].filter((date): date is Date => date instanceof Date);
  const latest = candidates.sort((a, b) => b.getTime() - a.getTime())[0];
  if (!latest) return 0;
  const ageDays = (Date.now() - latest.getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays <= 7) return 12;
  if (ageDays <= 30) return 8;
  if (ageDays <= 90) return 4;
  return 0;
}
function scoreAgentForSkill(skill: OrbitSkill, row: OrbitAgentRow): ScoredOrbitAgent | null {
  const manual = manualOverrideForSkill(skill, row);
  const hits = matchingTerms(skill, row);
  const mcpReadiness = getOrbitMcpReadiness(row);
  const protocolTrustScore = computeProtocolTrustScore(row);
  const devProof = hasDevProof(row);
  const exact = hits.exactHits.length > 0;
  const keyword = hits.keywordHits.length > 0;
  const similar = hits.similarHits.length > 0;
  if (!manual && !exact && !keyword && !similar) return null;
  let score = 0;
  let matchType: OrbitMatchType = "fallback";
  if (manual) {
    score += 200 + manual.boost;
    matchType = "manual";
  } else if (exact) {
    score += 120 + hits.exactHits.length * 8;
    matchType = "exact";
  } else if (keyword) {
    score += 75 + hits.keywordHits.length * 6;
    matchType = "keyword";
  } else if (similar) {
    score += 45 + hits.similarHits.length * 4;
    matchType = "similar";
  }
  if (mcpReadiness.readiness === "mcp_ready") score += 35;
  if (mcpReadiness.readiness === "mcp_claimed") score += 15;
  if (row.isPremiumVerified || row.isVerifiedRevenue) score += 35;
  else if (row.isVerified || row.publicVerificationStatus === "verified") score += 24;
  score += protocolTrustScore * 0.45;
  if (devProof) score += 10;
  score += recentActivityScore(row);
  if (row.x402Support || row.sapX402Endpoint) score += 8;
  if (row.isVerifiedRevenue) score += 8;
  return {
    row,
    score,
    matchType,
    matchedSkills: [skill.id],
    mcpReadiness,
    manualReason: manual?.reason ?? null,
    textHits: [...hits.exactHits, ...hits.keywordHits, ...hits.similarHits].slice(0, 5),
  };
}
function sourceProtocol(row: OrbitAgentRow): string {
  if (row.sapVerified) return "sap";
  if (row.metaplexVerified) return "metaplex";
  const registry = row.listingRegistrySource.trim();
  if (registry && registry !== "default") return registry;
  if (row.metaplexSourceType?.trim()) return "metaplex";
  return row.chain.shortName || row.chain.name || "indexed";
}
function paymentMethods(row: OrbitAgentRow): string[] {
  const methods = new Set<string>();
  if (row.x402Support || row.sapX402Endpoint || row.paidServices.some((service) => service.serviceType === "x402")) {
    methods.add("x402");
  }
  if (row.paidServices.length > 0) methods.add("paid_service");
  return [...methods];
}
function websiteUrl(row: OrbitAgentRow): string | null {
  const official = row.officialLinks.find((link) => link.linkType.toLowerCase() === "website")?.url?.trim();
  if (official) return official;
  return metadataValue(row, ["website", "homepage", "url", "site"]);
}
function reasonForAgent(scored: ScoredOrbitAgent, protocolTrustScore: number, devProof: boolean): string {
  if (scored.manualReason) return scored.manualReason;
  const row = scored.row;
  const parts: string[] = [];
  if (scored.matchType === "exact") parts.push("matches structured skill/service metadata");
  else if (scored.matchType === "keyword") parts.push("matches name or description keywords");
  else if (scored.matchType === "similar") parts.push("matches a similar Orbit skill");
  if (row.isPremiumVerified || row.isVerifiedRevenue) parts.push("has a high verification tier");
  else if (row.isVerified || row.publicVerificationStatus === "verified") parts.push("is verified");
  if (scored.mcpReadiness.readiness === "mcp_ready") parts.push("has a confirmed MCP-like endpoint");
  if (row.x402Support || row.sapX402Endpoint) parts.push("supports x402-style payments");
  if (devProof) parts.push("has DevProof/GitHub evidence");
  parts.push(`protocol trust score ${protocolTrustScore}`);
  return `Recommended because it ${parts.join(", ")}.`;
}
function toOrbitCuratedAgent(scored: ScoredOrbitAgent, rank: number): OrbitCuratedAgent {
  const row = scored.row;
  const protocolTrustScore = computeProtocolTrustScore(row);
  const devProof = hasDevProof(row);
  const endpoint = scored.mcpReadiness.endpoint;
  return {
    rank,
    agentId: `${row.chainId}:${row.agentId}`,
    chainId: row.chainId,
    onChainAgentId: row.agentId,
    name: row.name,
    slug: toAgentUrlSlug(row.name),
    profilePath: agentPublicPath({ chainId: row.chainId, agentId: row.agentId, name: row.name }),
    description: row.description,
    avatarUrl: row.image || null,
    websiteUrl: websiteUrl(row),
    sourceProtocol: sourceProtocol(row),
    protocolTrustScore,
    verified: row.isVerified || row.isPremiumVerified || row.publicVerificationStatus === "verified",
    devProof,
    mcpReadiness: scored.mcpReadiness.readiness,
    ...(endpoint ? { mcpEndpoint: endpoint } : {}),
    paymentMethods: paymentMethods(row),
    matchedSkills: scored.matchedSkills,
    matchType: scored.matchType,
    reason: reasonForAgent(scored, protocolTrustScore, devProof),
  };
}
export function filterAndLimitOrbitResults(
  results: OrbitCuratedAgent[],
  options: OrbitCuratedAgentOptions = {},
): OrbitCuratedAgent[] {
  const limit = Math.max(1, Math.min(50, options.limit ?? DEFAULT_RESULT_LIMIT));
  return results
    .filter((agent) => (options.mcpOnly ? agent.mcpReadiness === "mcp_ready" : true))
    .filter((agent) => (options.verifiedOnly ? agent.verified : true))
    .slice(0, limit)
    .map((agent, index) => ({ ...agent, rank: index + 1 }));
}
async function loadCandidateAgents(): Promise<OrbitAgentRow[]> {
  return prisma.agent.findMany({
    where: { isActive: true },
    select: ORBIT_AGENT_SELECT,
    orderBy: [{ protocolTrustScore: "desc" }, { score: "desc" }, { lastActiveAt: "desc" }],
    take: ORBIT_AGENT_LIMIT,
  });
}
export function buildOrbitSkillResponse(
  skill: OrbitSkill,
  scoredAgents: ScoredOrbitAgent[],
  options: OrbitCuratedAgentOptions = {},
): OrbitCuratedSkillResult {
  const ranked = scoredAgents
    .sort((a, b) => b.score - a.score)
    .map((scored, index) => toOrbitCuratedAgent(scored, index + 1));
  const exactResults = ranked.filter((agent) => agent.matchType === "manual" || agent.matchType === "exact");
  const fallbackResults = ranked.filter((agent) => agent.matchType !== "manual" && agent.matchType !== "exact");
  return {
    version: ORBIT_CURATED_MCP_VERSION,
    skill,
    supportedByAgentRanking: skill.feasibility !== "NO",
    generatedAt: new Date().toISOString(),
    results: filterAndLimitOrbitResults(exactResults, options),
    fallbackResults: filterAndLimitOrbitResults(fallbackResults, options),
    notes: ["The integration provides discovery and curation only. Execution is handled by Orbit or the target agent."],
  };
}
export async function getCuratedAgentsForOrbitSkill(
  skillId: string,
  options: OrbitCuratedAgentOptions = {},
): Promise<OrbitCuratedSkillResult | null> {
  const skill = getOrbitSkillByIdFromTaxonomy(skillId);
  if (!skill) return null;
  const rows = await loadCandidateAgents();
  const scored = rows
    .map((row) => scoreAgentForSkill(skill, row))
    .filter((agent): agent is ScoredOrbitAgent => agent != null);
  return buildOrbitSkillResponse(skill, scored, options);
}
