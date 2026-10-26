import "server-only";

import { cache } from "react";
import { readPublicNetworkSummaries } from "@/lib/agent-directory/network-summaries.server";
import { getEcosystemExtensionCounts } from "@/lib/ecosystem-statistics";
import {
  getPublicApiCached,
  getPublicApiCacheNamespaceGeneration,
} from "@/lib/public-api-cache";
import { buildAgentsIndexHref } from "@/lib/ranking/agents-index-href";
import { readPublicRankingSummary } from "@/lib/ranking/public-ranking.server";
import { stringifyJsonCompatible } from "@/lib/json-compatible";
import { buildCorpusTiers } from "@/lib/public-site/agent-world-layout";
import {
  AGENT_WORLD_AR_CHAIN_ID,
  type AgentWorldAgentPreview,
  type AgentWorldArCluster,
  type AgentWorldChainCluster,
  type AgentWorldSnapshot,
} from "@/lib/public-site/world-types";
import { isFastLocal } from "@/lib/fast-local";
import {
  buildLocalAgentWorldMockSnapshot,
  isWorldMockEnabled,
} from "@/lib/public-site/world-mock-data.server";
import { loadWorldAgentPreviewsForSnapshot } from "@/lib/public-site/world-agent-previews.server";

const WORLD_FRESH_TTL_SECONDS = 300;
const WORLD_STALE_TTL_SECONDS = 900;
const WORLD_CACHE_MAX_PAYLOAD_BYTES = 384 * 1024;
const WORLD_CACHE_PAYLOAD_HEADROOM_BYTES = 64 * 1024;
const WORLD_SNAPSHOT_TARGET_PAYLOAD_BYTES =
  WORLD_CACHE_MAX_PAYLOAD_BYTES - WORLD_CACHE_PAYLOAD_HEADROOM_BYTES;

const readWorldCacheGeneration = cache(() =>
  getPublicApiCacheNamespaceGeneration("world"),
);

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isAgentWorldChainCluster(value: unknown): value is AgentWorldChainCluster {
  if (!value || typeof value !== "object") return false;
  const row = value as AgentWorldChainCluster;
  return (
    Number.isFinite(row.chainId) &&
    typeof row.name === "string" &&
    typeof row.shortName === "string" &&
    typeof row.color === "string" &&
    typeof row.icon === "string" &&
    isSafeNonNegativeInteger(row.listedCount) &&
    isSafeNonNegativeInteger(row.indexedCount) &&
    typeof row.weight === "number" &&
    row.weight >= 0 &&
    row.weight <= 1 &&
    typeof row.href === "string"
  );
}

function isPreviewSocials(
  value: unknown,
): value is AgentWorldAgentPreview["socials"] {
  if (!value || typeof value !== "object") return false;
  const socials = value as AgentWorldAgentPreview["socials"];
  return (
    (socials.twitter === null || typeof socials.twitter === "string") &&
    (socials.telegram === null || typeof socials.telegram === "string") &&
    (socials.website === null || typeof socials.website === "string")
  );
}

function isAgentWorldAgentPreview(value: unknown): value is AgentWorldAgentPreview {
  if (!value || typeof value !== "object") return false;
  const row = value as AgentWorldAgentPreview;
  return (
    Number.isFinite(row.chainId) &&
    Number.isFinite(row.agentId) &&
    typeof row.name === "string" &&
    typeof row.image === "string" &&
    typeof row.description === "string" &&
    typeof row.href === "string" &&
    typeof row.score === "number" &&
    Number.isFinite(row.score) &&
    typeof row.verified === "boolean" &&
    typeof row.live === "boolean" &&
    typeof row.registered === "boolean" &&
    typeof row.x402 === "boolean" &&
    (row.listedAt === null || typeof row.listedAt === "string") &&
    typeof row.chainShortName === "string" &&
    isPreviewSocials(row.socials)
  );
}

function isAgentWorldSnapshot(value: unknown): value is AgentWorldSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as AgentWorldSnapshot;
  return (
    typeof snapshot.generatedAt === "string" &&
    snapshot.totals &&
    typeof snapshot.totals === "object" &&
    isSafeNonNegativeInteger(snapshot.totals.indexedAgents) &&
    isSafeNonNegativeInteger(snapshot.totals.listedAgents) &&
    isSafeNonNegativeInteger(snapshot.totals.verifiedAgents) &&
    isSafeNonNegativeInteger(snapshot.totals.deadOrSpamAgents) &&
    isSafeNonNegativeInteger(snapshot.totals.activeUnrankedAgents) &&
    isSafeNonNegativeInteger(snapshot.totals.x402Agents) &&
    isSafeNonNegativeInteger(snapshot.totals.mppAgents) &&
    isSafeNonNegativeInteger(snapshot.totals.mcpAgents) &&
    isSafeNonNegativeInteger(snapshot.totals.totalChains) &&
    Array.isArray(snapshot.chains) &&
    snapshot.chains.every(isAgentWorldChainCluster) &&
    isAgentWorldChainCluster(snapshot.arCluster) &&
    snapshot.arCluster.chainId === AGENT_WORLD_AR_CHAIN_ID &&
    Array.isArray(snapshot.previews) &&
    snapshot.previews.every(isAgentWorldAgentPreview) &&
    Array.isArray(snapshot.corpusTiers) &&
    snapshot.corpusTiers.length === 4
  );
}

function buildArClusterRow(listedCount: number, maxListed: number): AgentWorldArCluster {
  return {
    chainId: AGENT_WORLD_AR_CHAIN_ID,
    name: "AgentRanking",
    shortName: "AR",
    color: "#6366f1",
    icon: "/ar-mark.png",
    listedCount,
    indexedCount: Math.max(listedCount, Math.round(listedCount * 1.06)),
    weight: Math.min(1, Math.max(0.14, listedCount / Math.max(maxListed, 1))),
    href: buildAgentsIndexHref({
      query: "",
      chainId: AGENT_WORLD_AR_CHAIN_ID,
      verifiedOnly: false,
      x402Only: false,
      mppOnly: false,
    }),
  };
}

function serializedSnapshotBytes(snapshot: AgentWorldSnapshot): number {
  return Buffer.byteLength(stringifyJsonCompatible(snapshot), "utf8");
}

function fitSnapshotToPayloadBudget(snapshot: AgentWorldSnapshot): AgentWorldSnapshot {
  const fullBytes = serializedSnapshotBytes(snapshot);
  if (fullBytes <= WORLD_SNAPSHOT_TARGET_PAYLOAD_BYTES) return snapshot;

  const withoutPreviews: AgentWorldSnapshot = { ...snapshot, previews: [] };
  const baseBytes = serializedSnapshotBytes(withoutPreviews);
  if (baseBytes > WORLD_CACHE_MAX_PAYLOAD_BYTES) {
    throw new RangeError(
      `World snapshot base payload exceeded ${WORLD_CACHE_MAX_PAYLOAD_BYTES} bytes`,
    );
  }
  if (baseBytes > WORLD_SNAPSHOT_TARGET_PAYLOAD_BYTES) {
    console.warn("[world] snapshot metadata exhausted preview payload budget", {
      payloadBytes: baseBytes,
      targetPayloadBytes: WORLD_SNAPSHOT_TARGET_PAYLOAD_BYTES,
    });
    return withoutPreviews;
  }

  let low = 0;
  let high = snapshot.previews.length;
  while (low < high) {
    const candidateCount = Math.ceil((low + high) / 2);
    const candidate: AgentWorldSnapshot = {
      ...snapshot,
      previews: snapshot.previews.slice(0, candidateCount),
    };
    if (serializedSnapshotBytes(candidate) <= WORLD_SNAPSHOT_TARGET_PAYLOAD_BYTES) {
      low = candidateCount;
    } else {
      high = candidateCount - 1;
    }
  }

  const fitted: AgentWorldSnapshot = {
    ...snapshot,
    previews: snapshot.previews.slice(0, low),
  };
  console.info("[world] trimmed snapshot previews to payload budget", {
    previewsBefore: snapshot.previews.length,
    previewsAfter: fitted.previews.length,
    payloadBytesBefore: fullBytes,
    payloadBytesAfter: serializedSnapshotBytes(fitted),
    targetPayloadBytes: WORLD_SNAPSHOT_TARGET_PAYLOAD_BYTES,
  });
  return fitted;
}

async function composeAgentWorldSnapshot(): Promise<AgentWorldSnapshot> {
  const [summary, networks, extensionsResult] = await Promise.all([
    readPublicRankingSummary(),
    readPublicNetworkSummaries(),
    getEcosystemExtensionCounts(),
  ]);
  const extensions = extensionsResult.value;
  const networkByChainId = new Map(networks.map((network) => [network.chainId, network]));
  const listedByChainId = new Map(summary.chains.map((chain) => [chain.chainId, chain.agentCount]));
  const maxListed = Math.max(
    1,
    ...summary.chains.map((chain) => chain.agentCount),
    ...networks.map((network) => network.agentCount),
  );

  const chains = summary.chains
    .filter((chain) => chain.chainId !== AGENT_WORLD_AR_CHAIN_ID)
    .map((chain) => {
      const network = networkByChainId.get(chain.chainId);
      const listedCount = listedByChainId.get(chain.chainId) ?? chain.agentCount;
      const indexedCount = network?.agentCount ?? listedCount;
      const sizingCount = listedCount > 0 ? listedCount : indexedCount;
      return {
        chainId: chain.chainId,
        name: chain.name,
        shortName: chain.shortName,
        color: network?.color ?? "#888888",
        icon: network?.icon ?? "",
        listedCount,
        indexedCount,
        weight: sizingCount / maxListed,
        href: buildAgentsIndexHref({
          query: "",
          chainId: chain.chainId,
          verifiedOnly: false,
          x402Only: false,
          mppOnly: false,
        }),
      } satisfies AgentWorldChainCluster;
    })
    .sort((a, b) => b.listedCount - a.listedCount || b.indexedCount - a.indexedCount);

  const arListed =
    listedByChainId.get(AGENT_WORLD_AR_CHAIN_ID) ??
    networkByChainId.get(AGENT_WORLD_AR_CHAIN_ID)?.agentCount ??
    0;
  const arCluster = buildArClusterRow(arListed, maxListed);
  const previewChainIds = [arCluster.chainId, ...chains.map((chain) => chain.chainId)];
  const previews = await loadWorldAgentPreviewsForSnapshot(previewChainIds);

  return fitSnapshotToPayloadBudget({
    generatedAt: new Date().toISOString(),
    totals: {
      indexedAgents: summary.indexedAgents,
      listedAgents: summary.totalAgents,
      verifiedAgents: summary.verifiedAgents,
      deadOrSpamAgents: summary.deadOrSpamAgents,
      activeUnrankedAgents: summary.activeUnrankedAgents,
      x402Agents: summary.x402Agents,
      mppAgents: summary.mppAgents,
      mcpAgents: extensions.mcpAgents,
      totalChains: chains.length,
    },
    arCluster,
    chains,
    previews,
    corpusTiers: buildCorpusTiers({
      indexedAgents: summary.indexedAgents,
      listedAgents: summary.totalAgents,
      verifiedAgents: summary.verifiedAgents,
      deadOrSpamAgents: summary.deadOrSpamAgents,
      activeUnrankedAgents: summary.activeUnrankedAgents,
    }),
  });
}

export async function loadAgentWorldSnapshot(): Promise<AgentWorldSnapshot> {
  if (isWorldMockEnabled()) {
    return buildLocalAgentWorldMockSnapshot();
  }

  try {
    const generation = await readWorldCacheGeneration();
    const result = await getPublicApiCached({
      key: `world:g${generation}:snapshot:v9`,
      freshTtlSeconds: WORLD_FRESH_TTL_SECONDS,
      staleTtlSeconds: WORLD_STALE_TTL_SECONDS,
      maxPayloadBytes: WORLD_CACHE_MAX_PAYLOAD_BYTES,
      leaseTtlMs: 45_000,
      leaseWaitMs: 15_000,
      load: composeAgentWorldSnapshot,
      validate: isAgentWorldSnapshot,
    });
    return result.value;
  } catch (error) {
    if (!isFastLocal()) throw error;
    console.warn("[world] live snapshot unavailable; using local mock", error);
    return buildLocalAgentWorldMockSnapshot();
  }
}
