import { z } from "zod";
import {
  resolveHatcherApiBaseUrl,
  resolveHatcherAuthHeaders,
  resolveHatcherSyncLimit,
} from "@/lib/hatcher/config";
import type { HatcherExploreAgent } from "@/lib/hatcher/types";
import { timeoutSignal } from "@/lib/timing/abort";
import { HttpStatusError, parseRetryAfterMs, retryHttpOperation } from "@/lib/timing/retry";
import { parseBoundedJsonBody, readBoundedJsonBody } from "@/lib/bounded-http-body";
import { valkeyGetJson, valkeySetJson } from "@/lib/valkey";

const HatcherExploreResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z.object({
    agents: z.array(z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      description: z.string().nullable().optional(),
      avatarUrl: z.string().nullable().optional(),
      framework: z.string().nullable().optional(),
      template: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      messageCount: z.number().nullable().optional(),
      createdAt: z.string().nullable().optional(),
      features: z.array(z.string()).nullable().optional(),
      isPublic: z.boolean().nullable().optional(),
      killed: z.boolean().nullable().optional(),
      owner: z.object({
        username: z.string().nullable().optional(),
        walletAddress: z.string().nullable().optional(),
      }).nullable().optional(),
      publicChatEnabled: z.boolean().nullable().optional(),
    })).optional(),
    pagination: z.object({
      total: z.number().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      hasMore: z.boolean().optional(),
    }).optional(),
  }).optional(),
});

const DEFAULT_TIMEOUT_MS = 20_000;
const HATCHER_USER_AGENT =
  "AgentRanking-HatcherIndexer/1.0 (+https://agentranking.io)";
const DETAIL_CACHE_TTL_SECONDS = 5 * 60;
function detailCacheKey(key: string): string {
  return `hatcher:detail:v1:${key}`;
}
async function hatcherFetchJson<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit & { cacheKey?: string },
): Promise<z.output<S> | null>;
async function hatcherFetchJson(
  path: string,
  init?: RequestInit & { cacheKey?: string },
): Promise<unknown | null>;
async function hatcherFetchJson(
  path: string,
  schemaOrInit?: z.ZodType | (RequestInit & { cacheKey?: string }),
  maybeInit?: RequestInit & { cacheKey?: string },
): Promise<unknown | null> {
  const schema = schemaOrInit && "parse" in schemaOrInit ? (schemaOrInit as z.ZodType) : null;
  const init = schema ? maybeInit : (schemaOrInit as (RequestInit & { cacheKey?: string }) | undefined);
  const base = resolveHatcherApiBaseUrl();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const cacheKey = init?.cacheKey ? detailCacheKey(init.cacheKey) : null;
  if (cacheKey) {
    const cached = await valkeyGetJson<unknown>(cacheKey);
    if (cached !== null) {
      return schema ? schema.parse(cached) : cached;
    }
  }
  const requestInit: RequestInit = { ...(init ?? {}) };
  delete (requestInit as RequestInit & { cacheKey?: string }).cacheKey;
  let body: unknown;
  try {
    body = await retryHttpOperation(
      async () => {
        const res = await fetch(url, {
          ...requestInit,
          signal: timeoutSignal(DEFAULT_TIMEOUT_MS, requestInit.signal ?? undefined),
          headers: {
            Accept: "application/json",
            "User-Agent": HATCHER_USER_AGENT,
            ...resolveHatcherAuthHeaders(),
            ...(requestInit.headers ?? {}),
          },
          cache: "no-store",
        });
        if (!res.ok) {
          throw new HttpStatusError(
            res.status,
            `Hatcher returned ${res.status} for ${url}`,
            parseRetryAfterMs(res.headers.get("retry-after")),
          );
        }
        return schema
          ? parseBoundedJsonBody(res, schema, 4 * 1024 * 1024)
          : readBoundedJsonBody(res, 4 * 1024 * 1024);
      },
      { retries: 2, signal: requestInit.signal ?? undefined, minTimeout: 350, maxTimeout: 4_000 },
    );
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.warn(`[hatcher-client] fetch failed ${url}: ${message}`);
    return null;
  }
  if (cacheKey) await valkeySetJson(cacheKey, body, DETAIL_CACHE_TTL_SECONDS);
  return body;
}
export async function fetchHatcherExplorePage(options?: {
  limit?: number;
  offset?: number;
  sort?: string;
}): Promise<{
  agents: HatcherExploreAgent[];
  pagination: { total?: number; limit?: number; offset?: number; hasMore?: boolean };
}> {
  const limit = options?.limit ?? resolveHatcherSyncLimit();
  const offset = options?.offset ?? 0;
  const sort = options?.sort ?? "popular";
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    sort,
  });
  const body = await hatcherFetchJson(`/agents/explore?${qs}`, HatcherExploreResponseSchema);
  const agents = body?.data?.agents ?? [];
  const pagination = body?.data?.pagination ?? {};
  return { agents, pagination };
}
/** Fetch all explore pages up to maxAgents (respects pagination.hasMore). */
export async function fetchAllHatcherExploreAgents(options?: {
  maxAgents?: number;
  sort?: string;
}): Promise<HatcherExploreAgent[]> {
  const maxAgents = options?.maxAgents ?? resolveHatcherSyncLimit();
  const pageSize = Math.min(60, maxAgents);
  const out: HatcherExploreAgent[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore && out.length < maxAgents) {
    const remaining = maxAgents - out.length;
    const limit = Math.min(pageSize, remaining);
    const { agents, pagination } = await fetchHatcherExplorePage({
      limit,
      offset,
      sort: options?.sort,
    });
    out.push(...agents);
    hasMore = pagination.hasMore === true && agents.length > 0;
    offset += agents.length;
    if (agents.length === 0) break;
  }
  return out.slice(0, maxAgents);
}
export async function fetchHatcherPublicStats(hatcherId: string): Promise<unknown | null> {
  return hatcherFetchJson(`/agents/${encodeURIComponent(hatcherId)}/public-stats`);
}
export async function fetchHatcherPassport(publicId: string): Promise<unknown | null> {
  return hatcherFetchJson(`/agents/${encodeURIComponent(publicId)}/passport.json`, {
    cacheKey: `passport:${publicId}`,
  });
}
export async function fetchHatcherMcpManifest(publicId: string): Promise<unknown | null> {
  return hatcherFetchJson(`/agents/${encodeURIComponent(publicId)}/mcp/manifest.json`, {
    cacheKey: `mcp:${publicId}`,
  });
}
