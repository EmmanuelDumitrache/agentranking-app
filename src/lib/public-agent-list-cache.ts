import "server-only";
import { normalizeAgentListSearch } from "@/lib/agents-search-scope";
import {
  shouldCachePublicAgentListPayload,
  type PublicAgentListEndpoint,
} from "@/lib/public-agent-list-cache-key";
export type { PublicAgentListEndpoint } from "@/lib/public-agent-list-cache-key";
import {
  getPublicApiCached,
  getPublicApiCacheNamespaceGeneration,
  invalidatePublicApiCacheNamespace,
  publicApiCacheKey,
  type CachePolicy,
  type PublicApiCacheResult,
} from "@/lib/public-api-cache";
import { AGENT_PUBLIC_CONTENT_CACHE_DOMAIN } from "@/lib/public-cache-domains";
export type PublicAgentListBody = object;
export const PUBLIC_AGENT_LIST_CACHE_POLICIES = {
  web: {
    namespace: "agents:list:web",
    freshTtlSeconds: 60,
    staleTtlSeconds: 600,
    maxPayloadBytes: 4 * 1_024 * 1_024,
    invalidation: "namespace-generation",
  },
  v1: {
    namespace: "agents:list:v1",
    freshTtlSeconds: 120,
    staleTtlSeconds: 600,
    maxPayloadBytes: 2 * 1_024 * 1_024,
    invalidation: "namespace-generation",
  },
  v2: {
    namespace: "agents:list:v2",
    freshTtlSeconds: 60,
    staleTtlSeconds: 600,
    maxPayloadBytes: 3 * 1_024 * 1_024,
    invalidation: "namespace-generation",
  },
} as const satisfies Record<PublicAgentListEndpoint, CachePolicy>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}
function isNullableBoundedString(value: unknown, maxLength: number): boolean {
  return value == null || isBoundedString(value, maxLength);
}
function isStringArray(value: unknown, maxItems: number, maxLength: number): boolean {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => isBoundedString(item, maxLength));
}
function isAgentChain(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.name, 256) &&
    isBoundedString(value.shortName, 64) &&
    (!Object.hasOwn(value, "color") || isBoundedString(value.color, 64)) &&
    (!Object.hasOwn(value, "icon") || isBoundedString(value.icon, 2_048))
  );
}
function isAgentService(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.name, 256) &&
    (!Object.hasOwn(value, "endpoint") || isNullableBoundedString(value.endpoint, 4_096)) &&
    (!Object.hasOwn(value, "version") || isNullableBoundedString(value.version, 128))
  );
}
function isAgentMetadata(value: unknown): boolean {
  return (
    isRecord(value) &&
    isBoundedString(value.key, 256) &&
    isBoundedString(value.value, 64 * 1_024)
  );
}
function isAgentCapabilities(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [value.mcpTools, value.a2aSkills, value.oasfSkills, value.oasfDomains]
    .every((entry) => isStringArray(entry, 256, 2_048));
}
function isAgentPerfMetrics(value: unknown): boolean {
  if (value == null) return true;
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) =>
    entry == null || (typeof entry === "number" && Number.isFinite(entry)) || isBoundedString(entry, 128),
  );
}
function isAgentRow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (!Number.isSafeInteger(value.agentId) || !isNonNegativeInteger(value.chainId)) return false;
  if (!isBoundedString(value.name, 512)) return false;
  if (Object.hasOwn(value, "id") && !isPositiveInteger(value.id)) return false;
  if (Object.hasOwn(value, "slug") && !isNullableBoundedString(value.slug, 768)) return false;
  if (Object.hasOwn(value, "chain") && !isAgentChain(value.chain)) return false;
  if (
    Object.hasOwn(value, "services") &&
    !(Array.isArray(value.services) && value.services.length <= 64 && value.services.every(isAgentService))
  ) return false;
  if (
    Object.hasOwn(value, "metadata") &&
    !(Array.isArray(value.metadata) && value.metadata.length <= 256 && value.metadata.every(isAgentMetadata))
  ) return false;
  if (Object.hasOwn(value, "capabilities") && !isAgentCapabilities(value.capabilities)) return false;
  if (Object.hasOwn(value, "perfMetrics") && !isAgentPerfMetrics(value.perfMetrics)) return false;
  return true;
}
function isAgentRows(value: unknown, maxRows: number): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length <= maxRows && value.every(isAgentRow);
}
function isProtocolTrustSort(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.capped === "boolean" &&
    isNonNegativeInteger(value.fullMatchCount) &&
    isNonNegativeInteger(value.poolSize)
  );
}
function isPaginationMeta(value: unknown, apiVersion?: number): boolean {
  if (!isRecord(value)) return false;
  if (
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.perPage) ||
    !isNonNegativeInteger(value.total) ||
    !isNonNegativeInteger(value.totalPages)
  ) {
    return false;
  }
  if (apiVersion !== undefined && value.apiVersion !== apiVersion) return false;
  if (Object.hasOwn(value, "protocolTrustSort") && !isProtocolTrustSort(value.protocolTrustSort)) return false;
  return value.totalPages === Math.ceil(value.total / value.perPage) || value.totalPages === Math.max(1, Math.ceil(value.total / value.perPage));
}
function isWebAgentListBody(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (
    !isAgentRows(value.agents, 100) ||
    !isNonNegativeInteger(value.total) ||
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.perPage) ||
    !isNonNegativeInteger(value.totalPages)
  ) {
    return false;
  }
  if (value.agents.length > value.perPage) return false;
  if (Object.hasOwn(value, "protocolTrustSort") && !isProtocolTrustSort(value.protocolTrustSort)) return false;
  return value.totalPages === Math.ceil(value.total / value.perPage);
}
function isV1AgentListBody(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isAgentRows(value.data, 50) || !isPaginationMeta(value.meta)) return false;
  return isRecord(value.meta) && value.data.length <= Number(value.meta.perPage);
}
function isV2AgentListBody(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isAgentRows(value.agents, 50) || !isPaginationMeta(value.meta, 2)) return false;
  return isRecord(value.meta) && value.agents.length <= Number(value.meta.perPage);
}
function validator(endpoint: PublicAgentListEndpoint): (value: unknown) => value is Record<string, unknown> {
  if (endpoint === "web") return isWebAgentListBody;
  if (endpoint === "v1") return isV1AgentListBody;
  return isV2AgentListBody;
}
/** Mirrors the public `/api/agents` list-view inference. */
function isWebListView(searchParams: URLSearchParams, perPage: number): boolean {
  return searchParams.get("listView") === "true" || perPage > 20;
}
/**
 * Eligible `/api/agents` requests are anonymous, first-page list views without
 * search, diagnostic, personalized, or expensive protocol-trust modes.
 */
export function webAgentListCacheEligible(searchParams: URLSearchParams, perPage: number): boolean {
  if (searchParams.get("compare") === "1") return false;
  if (searchParams.get("debug") === "1") return false;
  if (normalizeAgentListSearch(searchParams.get("search") || "")) return false;
  if (searchParams.get("nameOnly") === "true") return false;
  if (searchParams.get("service")) return false;
  if (searchParams.get("protocol")) return false;
  if (searchParams.get("x402")) return false;
  if (searchParams.get("hasWallet")) return false;
  if (searchParams.get("minScore")) return false;
  if (searchParams.get("minFeedback")) return false;
  if (searchParams.get("trust")) return false;
  if (searchParams.get("binanceCompatible")) return false;
  if (searchParams.get("skills")) return false;
  if (searchParams.get("socials")) return false;
  if (searchParams.get("archetype")) return false;
  if (searchParams.get("agentMode")) return false;
  if (searchParams.get("showAll") === "true") return false;
  if (searchParams.get("includeInactive") === "true") return false;
  if (searchParams.get("balanced") === "1" || searchParams.get("balanced") === "true") return false;
  const page = Number.parseInt(searchParams.get("page") || "1", 10);
  if (page !== 1 || Number.isNaN(page)) return false;
  if (!isWebListView(searchParams, perPage)) return false;
  const sort = searchParams.get("sort") || "created_desc";
  if (sort === "protocol_trust_desc" || sort === "protocol_trust_asc") return false;
  if (sort === "balanced_recent") return false;
  return true;
}
/** Eligibility shared by versioned public Agent APIs. */
export function versionedAgentListCacheEligible(
  searchParams: URLSearchParams,
  page: number,
  sort: string,
): boolean {
  if (page !== 1) return false;
  if (sort === "protocol_trust_desc" || sort === "protocol_trust_asc") return false;
  if ((searchParams.get("search") ?? "").trim()) return false;
  if ((searchParams.get("owner") ?? "").trim()) return false;
  return true;
}
export async function getPublicAgentListPayload<T extends object>(
  endpoint: PublicAgentListEndpoint,
  searchParams: URLSearchParams,
  load: () => Promise<T>,
): Promise<PublicApiCacheResult<T>> {
  const policy = PUBLIC_AGENT_LIST_CACHE_POLICIES[endpoint];
  const [generation, agentContentGeneration] = await Promise.all([
    getPublicApiCacheNamespaceGeneration(policy.namespace),
    getPublicApiCacheNamespaceGeneration(AGENT_PUBLIC_CONTENT_CACHE_DOMAIN),
  ]);
  return getPublicApiCached({
    key: publicApiCacheKey(
      `${policy.namespace}:g${generation}:a${agentContentGeneration}`,
      searchParams,
    ),
    freshTtlSeconds: policy.freshTtlSeconds,
    staleTtlSeconds: policy.staleTtlSeconds,
    maxPayloadBytes: policy.maxPayloadBytes,
    leaseTtlMs: 120_000,
    leaseWaitMs: 55_000,
    load,
    validate: validator(endpoint) as (value: unknown) => value is T,
    shouldCacheValue: (value) => shouldCachePublicAgentListPayload(endpoint, searchParams, value),
  });
}
/** Parameterized Agent-list keys use generation invalidation; old generations expire naturally. */
export async function invalidatePublicAgentListCaches(): Promise<void> {
  await Promise.all(
    Object.values(PUBLIC_AGENT_LIST_CACHE_POLICIES).map((policy) =>
      invalidatePublicApiCacheNamespace(policy.namespace),
    ),
  );
}
