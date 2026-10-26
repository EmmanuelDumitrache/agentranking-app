import "server-only";
import { fetchEcosystemTimeseries } from "@/lib/agent-directory/ecosystem-timeseries";
import type { EcosystemSeriesPoint, EcosystemTimeseries } from "@/lib/agent-directory/ecosystem-series";
import type { DirectoryEcosystemStats } from "@/lib/agent-directory/types";
import { prisma } from "@/lib/db";
import {
  getPublicApiCached,
  type CachePolicy,
  type PublicApiCacheResult,
} from "@/lib/public-api-cache";
import {
  combineCacheResults,
  getCountersPayload,
} from "@/lib/public-statistics/service";
export type EcosystemTopChain = {
  chainId: number;
  name: string;
  shortName: string;
  agentCount: number;
};
export type EcosystemExtensionCounts = {
  x402Agents: number;
  mcpAgents: number;
  a2aAgents: number;
  oasfAgents: number;
  topChains: EcosystemTopChain[];
};
export type EcosystemStatsPayload = DirectoryEcosystemStats & {
  totalChains: number;
  a2aAgents: number;
  oasfAgents: number;
  topChains: EcosystemTopChain[];
};
export const ECOSYSTEM_STATISTICS_CACHE_POLICIES = {
  extensions: {
    namespace: "ecosystem:extensions",
    freshTtlSeconds: 60,
    staleTtlSeconds: 60,
    maxPayloadBytes: 64 * 1_024,
    invalidation: "ttl",
  },
  timeseries: {
    namespace: "ecosystem:timeseries",
    freshTtlSeconds: 15 * 60,
    staleTtlSeconds: 24 * 60 * 60,
    maxPayloadBytes: 256 * 1_024,
    invalidation: "ttl",
  },
} as const satisfies Record<string, CachePolicy>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function isSeriesPoint(value: unknown): value is EcosystemSeriesPoint {
  if (!isRecord(value)) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value.date)) && isNonNegativeInteger(value.value);
}
function isSeries(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 31 && value.every(isSeriesPoint);
}
function isEcosystemTimeseries(value: unknown): value is EcosystemTimeseries {
  if (!isRecord(value)) return false;
  return (
    isSeries(value.total) &&
    isSeries(value.verified) &&
    isSeries(value.mcp) &&
    isSeries(value.x402) &&
    isSeries(value.feedback) &&
    isSeries(value.networks)
  );
}
async function loadEcosystemExtensionCounts(): Promise<EcosystemExtensionCounts> {
  const [row] = await prisma.$queryRaw<Array<{
    x402Agents: bigint;
    mcpAgents: bigint;
    a2aAgents: bigint;
    oasfAgents: bigint;
    topChains: unknown;
  }>>`
    WITH active_agents AS MATERIALIZED (
      SELECT id, "chainId", "x402Support"
      FROM "Agent"
      WHERE "isActive" = TRUE
    ),
    capability_counts AS (
      SELECT
        COUNT(*) FILTER (WHERE aa."x402Support" = TRUE)::bigint AS "x402Agents",
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "AgentMetadata" am WHERE am."agentId" = aa.id AND am.key = 'mcpTools'
        ))::bigint AS "mcpAgents",
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "AgentMetadata" am WHERE am."agentId" = aa.id AND am.key = 'a2aSkills'
        ))::bigint AS "a2aAgents",
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "AgentMetadata" am WHERE am."agentId" = aa.id AND am.key = 'oasfSkills'
        ))::bigint AS "oasfAgents"
      FROM active_agents aa
    ),
    top_chain_counts AS (
      SELECT aa."chainId", COUNT(*)::bigint AS "agentCount"
      FROM active_agents aa
      GROUP BY aa."chainId"
      ORDER BY COUNT(*) DESC, aa."chainId" ASC
      LIMIT 10
    )
    SELECT
      cc."x402Agents",
      cc."mcpAgents",
      cc."a2aAgents",
      cc."oasfAgents",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'chainId', tcc."chainId",
          'name', COALESCE(c.name, tcc."chainId"::text),
          'shortName', COALESCE(c."shortName", tcc."chainId"::text),
          'agentCount', tcc."agentCount"
        ) ORDER BY tcc."agentCount" DESC, tcc."chainId" ASC)
        FROM top_chain_counts tcc
        LEFT JOIN "Chain" c ON c."chainId" = tcc."chainId"
      ), '[]'::jsonb) AS "topChains"
    FROM capability_counts cc
  `;
  if (!row) throw new Error("Ecosystem extension query returned no row");
  const topChainsRaw = Array.isArray(row.topChains) ? row.topChains : [];
  const topChains = topChainsRaw.map((entry) => {
    const value = entry as Record<string, unknown>;
    return {
      chainId: Number(value.chainId),
      name: String(value.name ?? value.chainId ?? ""),
      shortName: String(value.shortName ?? value.chainId ?? ""),
      agentCount: Number(value.agentCount ?? 0),
    };
  });
  return {
    x402Agents: Number(row.x402Agents),
    mcpAgents: Number(row.mcpAgents),
    a2aAgents: Number(row.a2aAgents),
    oasfAgents: Number(row.oasfAgents),
    topChains,
  };
}
export async function getEcosystemExtensionCounts(): Promise<PublicApiCacheResult<EcosystemExtensionCounts>> {
  return {
    value: await loadEcosystemExtensionCounts(),
    generatedAt: new Date().toISOString(),
    status: "origin",
  };
}
export function getEcosystemTimeseries(): Promise<PublicApiCacheResult<EcosystemTimeseries>> {
  const policy = ECOSYSTEM_STATISTICS_CACHE_POLICIES.timeseries;
  return getPublicApiCached({
    key: policy.namespace,
    freshTtlSeconds: policy.freshTtlSeconds,
    staleTtlSeconds: policy.staleTtlSeconds,
    maxPayloadBytes: policy.maxPayloadBytes,
    leaseTtlMs: 120_000,
    leaseWaitMs: 55_000,
    load: fetchEcosystemTimeseries,
    validate: isEcosystemTimeseries,
  });
}
export async function getEcosystemStatsPayload(): Promise<PublicApiCacheResult<EcosystemStatsPayload>> {
  const [counters, extensions, timeseries] = await Promise.all([
    getCountersPayload(),
    getEcosystemExtensionCounts(),
    getEcosystemTimeseries(),
  ]);
  const combined = combineCacheResults(
    {
      totalAgents: counters.value.totalAgents,
      verifiedAgents: counters.value.verifiedAgents,
      totalFeedback: counters.value.totalFeedback,
      totalChains: counters.value.totalChains,
      x402Agents: extensions.value.x402Agents,
      mcpAgents: extensions.value.mcpAgents,
      a2aAgents: extensions.value.a2aAgents,
      oasfAgents: extensions.value.oasfAgents,
      topChains: extensions.value.topChains,
      series: timeseries.value,
      updatedAt: "",
    },
    [counters, extensions, timeseries],
  );
  combined.value.updatedAt = combined.generatedAt;
  return combined;
}
export async function getDiscoveryEcosystemStats(): Promise<DirectoryEcosystemStats> {
  const result = await getEcosystemStatsPayload();
  return {
    totalAgents: result.value.totalAgents,
    verifiedAgents: result.value.verifiedAgents,
    x402Agents: result.value.x402Agents,
    mcpAgents: result.value.mcpAgents,
    totalFeedback: result.value.totalFeedback,
    totalChains: result.value.totalChains,
    series: result.value.series,
    updatedAt: result.value.updatedAt,
  };
}
export async function invalidateEcosystemExtensionCounts(): Promise<void> {
  // Direct PostgreSQL read; HTTP/CDN freshness is the only cache boundary.
}
