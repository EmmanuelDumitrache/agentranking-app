import "server-only";
import { invalidateEcosystemExtensionCounts } from "@/lib/ecosystem-statistics";
import { invalidatePublicAgentListCaches } from "@/lib/public-agent-list-cache";
import {
  invalidatePublicApiCache,
  invalidatePublicApiCacheNamespace,
} from "@/lib/public-api-cache";
const LISTS_KEY = "stats:lists";
const TOP_BY_CHAIN_KEY = "stats:top-by-chain";
const POWERBOOST_PREFIX = "powerboost";
const RANKING_PREFIX = "ranking";
async function settleInvalidations(operations: Array<Promise<unknown>>): Promise<void> {
  await Promise.all(operations);
}
export async function invalidatePublicStatisticsCounters(): Promise<void> {
  // Direct PostgreSQL read; HTTP/CDN expiry is the only freshness boundary.
}
export async function invalidatePublicStatisticsLists(): Promise<void> {
  await invalidatePublicApiCache(LISTS_KEY);
}
export async function invalidatePublicTopByChain(): Promise<void> {
  await invalidatePublicApiCache(TOP_BY_CHAIN_KEY);
}
export async function invalidatePublicTicker(): Promise<void> {
  // Direct PostgreSQL read; HTTP/CDN expiry is the only freshness boundary.
}
export async function invalidatePublicPowerBoost(): Promise<void> {
  await invalidatePublicApiCacheNamespace(POWERBOOST_PREFIX);
}
export async function invalidatePublicRanking(): Promise<void> {
  await invalidatePublicApiCacheNamespace(RANKING_PREFIX);
}
/** Promotion changes affect home lists; hot promotions also mutate hotScore used by the ticker. */
export async function invalidatePromotionPublicStatistics(): Promise<void> {
  await settleInvalidations(
    [invalidatePublicStatisticsLists(), invalidatePublicTicker()],
  );
}
/** Public profile fields appear in home, chain, ticker, PowerBoost, and Agent-list payloads. */
export async function invalidatePublicAgentProfileCaches(): Promise<void> {
  await settleInvalidations(
    [
      invalidatePublicStatisticsLists(),
      invalidatePublicTopByChain(),
      invalidatePublicTicker(),
      invalidatePublicPowerBoost(),
      invalidatePublicRanking(),
      invalidatePublicAgentListCaches(),
      invalidateEcosystemExtensionCounts(),
    ],
  );
}
/** Feedback mutations affect counters and every payload that embeds totalFeedback. */
export async function invalidatePublicFeedbackStatistics(): Promise<void> {
  await settleInvalidations(
    [
      invalidatePublicStatisticsCounters(),
      invalidatePublicStatisticsLists(),
      invalidatePublicTopByChain(),
      invalidatePublicPowerBoost(),
      invalidatePublicRanking(),
      invalidatePublicAgentListCaches(),
    ],
  );
}
/** Ranking or boost changes affect every public ranking-oriented projection. */
export async function invalidatePublicReputationStatistics(): Promise<void> {
  await settleInvalidations(
    [
      invalidatePublicStatisticsLists(),
      invalidatePublicTopByChain(),
      invalidatePublicTicker(),
      invalidatePublicPowerBoost(),
      invalidatePublicRanking(),
      invalidatePublicAgentListCaches(),
    ],
  );
}
/** Metadata, service, or profile changes affect public Agent lists and ecosystem capability counts. */
export async function invalidatePublicAgentDiscoveryCaches(): Promise<void> {
  await settleInvalidations(
    [invalidatePublicAgentListCaches(), invalidateEcosystemExtensionCounts()],
  );
}
/** Identity, verification, or registry changes may affect every public statistic. */
export async function invalidateAllPublicStatistics(): Promise<void> {
  await settleInvalidations(
    [
      invalidatePublicStatisticsCounters(),
      invalidatePublicStatisticsLists(),
      invalidatePublicTopByChain(),
      invalidatePublicTicker(),
      invalidatePublicPowerBoost(),
      invalidatePublicRanking(),
      invalidatePublicAgentListCaches(),
      invalidateEcosystemExtensionCounts(),
    ],
  );
}
