import "server-only";
import {
  getPublicApiCached,
  getPublicApiCacheNamespaceGeneration,
  publicApiCacheKey,
  type CachePolicy,
  type PublicApiCacheResult,
} from "@/lib/public-api-cache";
import {
  loadHomeStatsPayloadComposition,
  loadStatsPayloadComposition,
} from "@/lib/public-statistics/composition";
import { POWERBOOST_PERIOD_MS, type PowerBoostListPayload } from "@/lib/powerboost-payload";
import {
  loadCountersPayload,
  loadPowerBoostPayload,
  loadStatsListsPayload,
  loadTickerPayload,
  loadTopByChainPayload,
  type CountersPayload,
  type StatsListsPayload,
  type StatsPayload,
  type TickerPayload,
  type TopByChainPayload,
} from "@/lib/public-statistics/queries";
import { AGENT_PUBLIC_CONTENT_CACHE_DOMAIN } from "@/lib/public-cache-domains";
export {
  composeHomeStatsPayload,
  composeStatsPayload,
} from "@/lib/public-statistics/composition";
export { combinePublicApiCacheResults as combineCacheResults } from "@/lib/public-api-cache-primitives";
export const PUBLIC_STATISTICS_CACHE_POLICIES = {
  counters: {
    namespace: "stats:counters",
    freshTtlSeconds: 30,
    staleTtlSeconds: 30,
    maxPayloadBytes: 16 * 1_024,
    invalidation: "ttl",
  },
  lists: {
    namespace: "stats:lists",
    freshTtlSeconds: 60,
    staleTtlSeconds: 600,
    maxPayloadBytes: 768 * 1_024,
    invalidation: "key",
  },
  topByChain: {
    namespace: "stats:top-by-chain",
    freshTtlSeconds: 60,
    staleTtlSeconds: 600,
    maxPayloadBytes: 768 * 1_024,
    invalidation: "key",
  },
  ticker: {
    namespace: "stats:ticker",
    freshTtlSeconds: 120,
    staleTtlSeconds: 120,
    maxPayloadBytes: 128 * 1_024,
    invalidation: "ttl",
  },
  powerBoost: {
    namespace: "powerboost",
    freshTtlSeconds: 120,
    staleTtlSeconds: 900,
    maxPayloadBytes: 512 * 1_024,
    invalidation: "namespace-generation",
  },
} as const satisfies Record<string, CachePolicy>;
export const POWERBOOST_PERIODS = ["all", "12h", "24h", "week", "month"] as const;
export type PowerBoostPeriod = (typeof POWERBOOST_PERIODS)[number];
export type PowerBoostRequest = {
  page: number;
  perPage: number;
  period: PowerBoostPeriod;
};
async function directOriginResult<T>(load: () => Promise<T>): Promise<PublicApiCacheResult<T>> {
  const value = await load();
  return { value, generatedAt: new Date().toISOString(), status: "origin" };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}
function isNonNegativeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}
function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function isBoundedString(value: unknown, maxLength = 10_000): value is string {
  return typeof value === "string" && value.length <= maxLength;
}
function isDateLike(value: unknown): boolean {
  return value == null || value instanceof Date || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}
function isChain(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.shortName, 64) &&
    isBoundedString(value.color, 64) &&
    isBoundedString(value.icon, 2_048)
  );
}
function isHomeAgent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isPositiveInteger(value.id) || !isSafeInteger(value.agentId) || !isNonNegativeInteger(value.chainId)) return false;
  if (!isBoundedString(value.name, 512) || !isBoundedString(value.slug, 768)) return false;
  if (!isBoundedString(value.image, 4_096) || !isBoundedString(value.owner, 512)) return false;
  if (!isFiniteNumber(value.score) || !isNonNegativeInteger(value.rank)) return false;
  if (!isNonNegativeInteger(value.totalFeedback) || !isChain(value.chain)) return false;
  if ("createdAt" in value && !isDateLike(value.createdAt)) return false;
  if ("lastActiveAt" in value && !isDateLike(value.lastActiveAt)) return false;
  return true;
}
function boundedArray(value: unknown, maxLength: number, validateItem: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= maxLength && value.every(validateItem);
}
export function isCountersPayload(value: unknown): value is CountersPayload {
  if (!isRecord(value)) return false;
  return [
    value.totalAgents,
    value.totalFeedback,
    value.activeAgents,
    value.totalChains,
    value.verifiedAgents,
    value.feedbackToday,
    value.sapVerifiedAgents,
  ].every(isNonNegativeInteger);
}
export function isStatsListsPayload(value: unknown): value is StatsListsPayload {
  if (!isRecord(value)) return false;
  return (
    boundedArray(value.latestAgents, 20, isHomeAgent) &&
    boundedArray(value.topRanked, 20, isHomeAgent) &&
    boundedArray(value.featured, 10, isHomeAgent) &&
    boundedArray(value.trending, 10, isHomeAgent)
  );
}
export function isStatsPayload(value: unknown): value is StatsPayload {
  return isCountersPayload(value) && isStatsListsPayload(value);
}
export function isTopByChainPayload(value: unknown): value is TopByChainPayload {
  if (!isRecord(value) || !isRecord(value.topByChain)) return false;
  const entries = Object.entries(value.topByChain);
  return entries.length <= 64 && entries.every(([chainId, agents]) => {
    return /^-?\d+$/.test(chainId) && boundedArray(agents, 8, isHomeAgent);
  });
}
function isTickerAgent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isSafeInteger(value.agentId) &&
    isNonNegativeInteger(value.chainId) &&
    isBoundedString(value.name, 512) &&
    isBoundedString(value.slug, 768) &&
    (value.rank == null || isNonNegativeInteger(value.rank)) &&
    isFiniteNumber(value.score) &&
    isFiniteNumber(value.powerScore) &&
    isFiniteNumber(value.activeBoosts) &&
    isFiniteNumber(value.adminPowerAdjust) &&
    isChain(value.chain) &&
    (!("daoVotes" in value) || isNonNegativeInteger(value.daoVotes))
  );
}
export function isTickerPayload(value: unknown): value is TickerPayload {
  if (!isRecord(value)) return false;
  return (
    boundedArray(value.dao, 6, isTickerAgent) &&
    boundedArray(value.hot, 6, isTickerAgent) &&
    boundedArray(value.trending, 6, isTickerAgent) &&
    boundedArray(value.latest, 6, isTickerAgent)
  );
}
function isPowerBoostAgent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isPositiveInteger(value.id) &&
    isSafeInteger(value.agentId) &&
    isNonNegativeInteger(value.chainId) &&
    isBoundedString(value.name, 512) &&
    isBoundedString(value.slug, 768) &&
    isBoundedString(value.image, 4_096) &&
    isBoundedString(value.owner, 512) &&
    isFiniteNumber(value.score) &&
    isNonNegativeInteger(value.totalFeedback) &&
    isNonNegativeInteger(value.daoVotes) &&
    isNonNegativeInteger(value.stakingVotes) &&
    isNonNegativeInteger(value.paidBoostVotes) &&
    isNonNegativeInteger(value.adminVotes) &&
    isPositiveInteger(value.rank) &&
    typeof value.hasHolderPowerBoost === "boolean" &&
    typeof value.hasHolderStakeBadge === "boolean" &&
    (value.holderBadgeLabel == null || isBoundedString(value.holderBadgeLabel, 256)) &&
    isNonNegativeInteger(value.holderStakeBadgeCount) &&
    isNonNegativeInteger(value.holderPowerBoostBackerCount) &&
    isNonNegativeInteger(value.holderPowerBoostUnits) &&
    isChain(value.chain) &&
    (!("lastActiveAt" in value) || isDateLike(value.lastActiveAt))
  );
}
export function isPowerBoostPayload(value: unknown): value is PowerBoostListPayload {
  if (!isRecord(value)) return false;
  if (
    !boundedArray(value.agents, 50, isPowerBoostAgent) ||
    !isNonNegativeInteger(value.total) ||
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.perPage) ||
    value.perPage > 50 ||
    !isPositiveInteger(value.totalPages)
  ) {
    return false;
  }
  return value.totalPages === Math.max(1, Math.ceil(value.total / value.perPage));
}
export function getCountersPayload(): Promise<PublicApiCacheResult<CountersPayload>> {
  return directOriginResult(loadCountersPayload);
}
export async function getStatsListsPayload(): Promise<PublicApiCacheResult<StatsListsPayload>> {
  const policy = PUBLIC_STATISTICS_CACHE_POLICIES.lists;
  const [generation, agentContentGeneration] = await Promise.all([
    getPublicApiCacheNamespaceGeneration(policy.namespace),
    getPublicApiCacheNamespaceGeneration(AGENT_PUBLIC_CONTENT_CACHE_DOMAIN),
  ]);
  return getPublicApiCached({
    key: `${policy.namespace}:g${generation}:a${agentContentGeneration}`,
    freshTtlSeconds: policy.freshTtlSeconds,
    staleTtlSeconds: policy.staleTtlSeconds,
    maxPayloadBytes: policy.maxPayloadBytes,
    leaseTtlMs: 90_000,
    leaseWaitMs: 55_000,
    load: loadStatsListsPayload,
    validate: isStatsListsPayload,
  });
}
export function getStatsPayload(): Promise<PublicApiCacheResult<StatsPayload>> {
  return loadStatsPayloadComposition({
    counters: getCountersPayload,
    lists: getStatsListsPayload,
  });
}
export async function getTopByChainPayload(): Promise<PublicApiCacheResult<TopByChainPayload>> {
  const policy = PUBLIC_STATISTICS_CACHE_POLICIES.topByChain;
  const [generation, agentContentGeneration] = await Promise.all([
    getPublicApiCacheNamespaceGeneration(policy.namespace),
    getPublicApiCacheNamespaceGeneration(AGENT_PUBLIC_CONTENT_CACHE_DOMAIN),
  ]);
  return getPublicApiCached({
    key: `${policy.namespace}:g${generation}:a${agentContentGeneration}`,
    freshTtlSeconds: policy.freshTtlSeconds,
    staleTtlSeconds: policy.staleTtlSeconds,
    maxPayloadBytes: policy.maxPayloadBytes,
    leaseTtlMs: 60_000,
    leaseWaitMs: 25_000,
    load: loadTopByChainPayload,
    validate: isTopByChainPayload,
  });
}
export function getHomeStatsPayload(): Promise<PublicApiCacheResult<StatsPayload & TopByChainPayload>> {
  return loadHomeStatsPayloadComposition({
    counters: getCountersPayload,
    lists: getStatsListsPayload,
    topByChain: getTopByChainPayload,
  });
}
export function getTickerPayload(): Promise<PublicApiCacheResult<TickerPayload>> {
  return directOriginResult(loadTickerPayload);
}
export async function getPowerBoostPayload(
  request: PowerBoostRequest,
): Promise<PublicApiCacheResult<PowerBoostListPayload>> {
  const policy = PUBLIC_STATISTICS_CACHE_POLICIES.powerBoost;
  const searchParams = new URLSearchParams({
    page: String(request.page),
    perPage: String(request.perPage),
    period: request.period,
  });
  const activityMs = POWERBOOST_PERIOD_MS[request.period];
  const activitySince = activityMs ? new Date(Date.now() - activityMs) : undefined;
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
    leaseTtlMs: 90_000,
    leaseWaitMs: 55_000,
    load: () => loadPowerBoostPayload({
      page: request.page,
      perPage: request.perPage,
      activitySince,
    }),
    validate: isPowerBoostPayload,
  });
}
