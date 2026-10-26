export type PublicAgentListEndpoint = "web" | "v1" | "v2";
const WEB_CACHE_KEYS = [
  "active",
  "agentMode",
  "archetype",
  "binanceCompatible",
  "chain",
  "covenant",
  "hasWallet",
  "hatcher",
  "metaplex",
  "metaplexActive",
  "metaplexBoundToken",
  "metaplexHasServices",
  "metaplexRegistryDetected",
  "metaplexTradeable",
  "minFeedback",
  "minScore",
  "protocol",
  "sapVerified",
  "service",
  "skills",
  "skipRank",
  "socials",
  "tag",
  "telegramBotType",
  "telegramSpawn",
  "trust",
  "verified",
  "x402",
  "xpay",
] as const;
const V1_CACHE_KEYS = ["archetype", "chain", "minScore", "skills", "verified", "x402"] as const;
const V2_CACHE_KEYS = [
  ...V1_CACHE_KEYS,
  "maxBurnToEarn",
  "minMonthlyPnl",
  "verifiedRevenue",
] as const;
export type PublicAgentListCacheKeyInput = {
  endpoint: PublicAgentListEndpoint;
  source: URLSearchParams;
  page: number;
  perPage: number;
  sort: string;
  listView?: boolean;
};
function appendFirstNonEmpty(
  target: URLSearchParams,
  source: URLSearchParams,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const value = source.get(key);
    if (value != null && value !== "") target.set(key, value);
  }
}
/**
 * Build a semantic, allowlisted cache query. Unknown parameters and duplicate
 * values cannot create extra Valkey keys for an otherwise identical request.
 */
export function buildPublicAgentListCacheSearchParams(
  input: PublicAgentListCacheKeyInput,
): URLSearchParams {
  const target = new URLSearchParams();
  target.set("page", String(input.page));
  target.set("perPage", String(input.perPage));
  target.set("sort", input.sort);
  if (input.endpoint === "web") {
    if (input.listView) target.set("listView", "true");
    appendFirstNonEmpty(target, input.source, WEB_CACHE_KEYS);
  } else if (input.endpoint === "v1") {
    appendFirstNonEmpty(target, input.source, V1_CACHE_KEYS);
  } else {
    appendFirstNonEmpty(target, input.source, V2_CACHE_KEYS);
  }
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * An empty first page during cold start is transitional state, not a reusable
 * directory snapshot. Eligible Agent-list cache calls are first-page only, so
 * refusing publication here prevents the initial empty database observation
 * from surviving while durable database invalidation catches up.
 */
export function shouldCachePublicAgentListPayload(
  endpoint: PublicAgentListEndpoint,
  searchParams: URLSearchParams,
  value: unknown,
): boolean {
  if (endpoint !== "web" || !isRecord(value)) return true;
  const sort = searchParams.get("sort") ?? "created_desc";
  const unfilteredFirstPage =
    searchParams.get("page") === "1" &&
    searchParams.get("listView") === "true" &&
    (sort === "agent_rank_desc" || sort === "created_desc") &&
    [...searchParams.keys()].every((key) =>
      key === "page" || key === "perPage" || key === "sort" || key === "listView"
    );
  if (!unfilteredFirstPage) return true;
  return !(Array.isArray(value.agents) && value.agents.length === 0 && value.total === 0);
}

export function parseClampedAgentListInteger(
  value: string | null,
  fallback: number,
  maximum: number,
): number {
  const raw = value?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(1, parsed));
}