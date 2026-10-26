import type { PublicApiCacheResult } from "../public-api-cache-primitives";
import { combinePublicApiCacheResults } from "../public-api-cache-primitives";
import type {
  CountersPayload,
  StatsListsPayload,
  StatsPayload,
  TopByChainPayload,
} from "./queries";

export function composeStatsPayload(
  counters: PublicApiCacheResult<CountersPayload>,
  lists: PublicApiCacheResult<StatsListsPayload>,
): PublicApiCacheResult<StatsPayload> {
  return combinePublicApiCacheResults(
    { ...counters.value, ...lists.value },
    [counters, lists],
  );
}

export function composeHomeStatsPayload(
  counters: PublicApiCacheResult<CountersPayload>,
  lists: PublicApiCacheResult<StatsListsPayload>,
  topByChain: PublicApiCacheResult<TopByChainPayload>,
): PublicApiCacheResult<StatsPayload & TopByChainPayload> {
  return combinePublicApiCacheResults(
    { ...counters.value, ...lists.value, ...topByChain.value },
    [counters, lists, topByChain],
  );
}

export async function loadStatsPayloadComposition(input: {
  counters: () => Promise<PublicApiCacheResult<CountersPayload>>;
  lists: () => Promise<PublicApiCacheResult<StatsListsPayload>>;
}): Promise<PublicApiCacheResult<StatsPayload>> {
  const [counters, lists] = await Promise.all([input.counters(), input.lists()]);
  return composeStatsPayload(counters, lists);
}

export async function loadHomeStatsPayloadComposition(input: {
  counters: () => Promise<PublicApiCacheResult<CountersPayload>>;
  lists: () => Promise<PublicApiCacheResult<StatsListsPayload>>;
  topByChain: () => Promise<PublicApiCacheResult<TopByChainPayload>>;
}): Promise<PublicApiCacheResult<StatsPayload & TopByChainPayload>> {
  const [counters, lists, topByChain] = await Promise.all([
    input.counters(),
    input.lists(),
    input.topByChain(),
  ]);
  return composeHomeStatsPayload(counters, lists, topByChain);
}
