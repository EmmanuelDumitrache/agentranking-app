import { z } from "zod";
import { prisma } from "@/lib/db";
import { type AgentXPost, X_LATEST_POSTS_METADATA_KEY } from "@/lib/agent-x-posts";
import { normalizeXUsername, resolveAgentTwitterHandle } from "@/lib/agent-twitter-handle";
import { fetchLatestTweetsByUserId } from "@/lib/x/fetch-user-timeline";
import { fetchTweetsByIds, isNumericTweetId, xApiGet } from "@/lib/x/x-api-client";
import { XApiRateLimitError } from "@/lib/x/x-api-errors";
import { getXApiBearerToken } from "@/lib/x/x-api-auth";
import { isXPostsLiveFetchEnabled } from "@/lib/social/x-live-fetch";
import {
  getCachedXLatestPosts,
  isXPostsEmbedBlocked,
  parseXLatestPostsCacheValue,
  serializeXLatestPostsCache,
  shouldRefreshXPosts,
  type GetCachedXLatestPostsResult,
  type XLatestPostsCacheEnvelope,
  type XLatestPostsCacheSource,
  type XLatestPostsDisplaySource,
} from "@/lib/social/x-latest-posts-cache";
export {
  getCachedXLatestPosts,
  isXPostsEmbedBlocked,
  parseXLatestPostsCacheValue,
  serializeXLatestPostsCache,
  shouldRefreshXPosts,
  type GetCachedXLatestPostsResult,
  type XLatestPostsCacheEnvelope,
  type XLatestPostsCacheSource,
  type XLatestPostsDisplaySource,
};
export type RefreshXLatestPostsResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  posts: AgentXPost[];
  envelope: XLatestPostsCacheEnvelope | null;
};
const POSTS_TTL_MS = 6 * 60 * 60 * 1000;
const USER_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 45 * 60 * 1000;
const MAX_POSTS = 8;
function parseIsoMs(iso: string | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

const XUserLookupSchema = z.object({
  data: z.object({ id: z.string().optional(), username: z.string().optional() }).optional(),
});

export type XUserLookup = z.infer<typeof XUserLookupSchema>;

async function resolveXUserId(
  username: string,
  prior: XLatestPostsCacheEnvelope | null,
): Promise<{ userId: string | null; userIdFetchedAt: string | null }> {
  const bare = normalizeXUsername(username);
  if (!bare) return { userId: null, userIdFetchedAt: null };
  const priorMs = parseIsoMs(prior?.userIdFetchedAt);
  if (
    prior?.userId &&
    priorMs != null &&
    Date.now() - priorMs < USER_ID_TTL_MS
  ) {
    return { userId: prior.userId, userIdFetchedAt: prior.userIdFetchedAt ?? null };
  }
  const user = await xApiGet(`/users/by/username/${encodeURIComponent(bare)}`, XUserLookupSchema);
  const userId = user.data?.id ?? null;
  return {
    userId,
    userIdFetchedAt: userId ? new Date().toISOString() : null,
  };
}
async function upsertXLatestPostsMetadata(agentDbId: number, envelope: XLatestPostsCacheEnvelope) {
  const value = serializeXLatestPostsCache(envelope);
  const existing = await prisma.agentMetadata.findFirst({
    where: { agentId: agentDbId, key: X_LATEST_POSTS_METADATA_KEY },
    select: { id: true },
  });
  if (existing) {
    await prisma.agentMetadata.update({
      where: { id: existing.id },
      data: { value },
    });
  } else {
    await prisma.agentMetadata.create({
      data: { agentId: agentDbId, key: X_LATEST_POSTS_METADATA_KEY, value },
    });
  }
}
/**
 * Controlled refresh — the only code path that may call X API for profile posts.
 */
export async function refreshXLatestPosts(
  chainId: number,
  agentId: number,
  opts: { force?: boolean } = {},
): Promise<RefreshXLatestPostsResult> {
  const agent = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: {
      id: true,
      chainId: true,
      agentId: true,
      metadata: { select: { key: true, value: true } },
      services: { select: { name: true, endpoint: true } },
    },
  });
  if (!agent) {
    return { ok: false, reason: "agent_not_found", posts: [], envelope: null };
  }
  const handle = resolveAgentTwitterHandle({
    chainId: agent.chainId,
    agentId: agent.agentId,
    metadata: agent.metadata,
    services: agent.services,
  });
  if (!handle) {
    return { ok: false, reason: "no_x_handle", posts: [], envelope: null };
  }
  const username = normalizeXUsername(handle);
  if (!username) {
    return { ok: false, reason: "invalid_username", posts: [], envelope: null };
  }
  const postsMeta = agent.metadata.find((m) => m.key === X_LATEST_POSTS_METADATA_KEY)?.value;
  const prior = parseXLatestPostsCacheValue(postsMeta);
  const displayHandle = `@${username}`;
  const { refresh, reason: skipReason } = shouldRefreshXPosts(prior, opts);
  if (!refresh) {
    return {
      ok: true,
      skipped: true,
      reason: skipReason,
      posts: prior?.posts ?? [],
      envelope: prior,
    };
  }
  if (!isXPostsLiveFetchEnabled()) {
    return {
      ok: false,
      skipped: true,
      reason: "live_fetch_disabled",
      posts: prior?.posts ?? [],
      envelope: prior,
    };
  }
  if (!getXApiBearerToken()) {
    const now = new Date();
    const envelope: XLatestPostsCacheEnvelope = {
      username,
      posts: prior?.posts ?? [],
      fetchedAt: prior?.fetchedAt ?? now.toISOString(),
      expiresAt: prior?.expiresAt ?? now.toISOString(),
      source: "error",
      error: "X API bearer token not configured",
    };
    await upsertXLatestPostsMetadata(agent.id, envelope);
    return { ok: false, reason: "no_token", posts: envelope.posts, envelope };
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + POSTS_TTL_MS);
  try {
    const cachedIds = (prior?.posts ?? []).map((p) => p.id).filter(isNumericTweetId);
    let posts: AgentXPost[] = [];
    let source: XLatestPostsCacheSource = "live";
    let userId = prior?.userId;
    let userIdFetchedAt = prior?.userIdFetchedAt;
    if (cachedIds.length > 0) {
      posts = await fetchTweetsByIds(cachedIds, displayHandle);
      if (posts.length > 0) {
        source = "live-ids";
      }
    }
    if (posts.length === 0) {
      const resolved = await resolveXUserId(username, prior);
      userId = resolved.userId ?? undefined;
      userIdFetchedAt = resolved.userIdFetchedAt ?? undefined;
      if (!userId) {
        const envelope: XLatestPostsCacheEnvelope = {
          username,
          userId,
          userIdFetchedAt,
          posts: prior?.posts ?? [],
          fetchedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          source: "error",
          error: "X user not found",
        };
        await upsertXLatestPostsMetadata(agent.id, envelope);
        return { ok: false, reason: "user_not_found", posts: envelope.posts, envelope };
      }
      posts = await fetchLatestTweetsByUserId(userId, displayHandle, MAX_POSTS);
      source = "live";
    }
    const envelope: XLatestPostsCacheEnvelope = {
      username,
      userId,
      userIdFetchedAt,
      posts: posts.slice(0, MAX_POSTS),
      fetchedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      source,
    };
    await upsertXLatestPostsMetadata(agent.id, envelope);
    return { ok: true, posts: envelope.posts, envelope };
  } catch (err) {
    const rateUntil =
      err instanceof XApiRateLimitError
        ? err.rateLimitedUntil
        : new Date(Date.now() + RATE_LIMIT_BACKOFF_MS).toISOString();
    const message = Error.isError(err) ? err.message : String(err);
    const envelope: XLatestPostsCacheEnvelope = {
      username,
      userId: prior?.userId,
      userIdFetchedAt: prior?.userIdFetchedAt,
      posts: prior?.posts ?? [],
      fetchedAt: prior?.fetchedAt ?? now.toISOString(),
      expiresAt: prior?.expiresAt ?? now.toISOString(),
      rateLimitedUntil: rateUntil,
      source: "error",
      error: message,
    };
    await upsertXLatestPostsMetadata(agent.id, envelope);
    return {
      ok: false,
      reason: err instanceof XApiRateLimitError ? "rate_limited" : "api_error",
      posts: envelope.posts,
      envelope,
    };
  }
}