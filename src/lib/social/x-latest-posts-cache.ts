/**
 * Read-only X posts cache parsing — safe for Client Components (no DB / Node builtins).
 */
import {
  type AgentXPost,
  parseXLatestPostsFromMetadataValue,
} from "@/lib/agent-x-posts";
/** Profile GET responses — never includes live X API fetch. */
export type XLatestPostsDisplaySource = "cache" | "iframe" | "link" | "none";
export type XLatestPostsCacheSource = "cache" | "live" | "live-ids" | "iframe" | "error";
export type XLatestPostsCacheEnvelope = {
  username: string;
  userId?: string;
  userIdFetchedAt?: string;
  posts: AgentXPost[];
  fetchedAt: string;
  expiresAt: string;
  rateLimitedUntil?: string;
  source: XLatestPostsCacheSource;
  error?: string;
};
export type GetCachedXLatestPostsResult = {
  posts: AgentXPost[];
  source: XLatestPostsDisplaySource;
  envelope: XLatestPostsCacheEnvelope | null;
  /** When true, do not auto-load syndication iframe (API or embed rate limits). */
  embedBlocked: boolean;
};
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseIsoMs(iso: string | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
function isFutureIso(iso: string | undefined): boolean {
  const ms = parseIsoMs(iso);
  return ms != null && ms > Date.now();
}
/** True when cached metadata says X API or embed should be avoided. */
export function isXPostsEmbedBlocked(envelope: XLatestPostsCacheEnvelope | null): boolean {
  if (!envelope) return false;
  if (isFutureIso(envelope.rateLimitedUntil)) return true;
  const err = envelope.error?.toLowerCase() ?? "";
  return err.includes("429") || err.includes("rate limit");
}
export function serializeXLatestPostsCache(envelope: XLatestPostsCacheEnvelope): string {
  return JSON.stringify(envelope);
}
/** Parse the canonical cache envelope. */
export function parseXLatestPostsCacheValue(
  value: string | null | undefined,
): XLatestPostsCacheEnvelope | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    const postsRaw = parsed.posts;
    const posts = Array.isArray(postsRaw)
      ? parseXLatestPostsFromMetadataValue(JSON.stringify(postsRaw))
      : [];
    const username = typeof parsed.username === "string" ? parsed.username : "";
    const fetchedAt =
      typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : new Date(0).toISOString();
    const expiresAt =
      typeof parsed.expiresAt === "string" ? parsed.expiresAt : new Date(0).toISOString();
    const source = parsed.source as XLatestPostsCacheSource;
    const validSources: XLatestPostsCacheSource[] = [
      "cache",
      "live",
      "live-ids",
      "iframe",
      "error",
    ];
    return {
      username,
      userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
      userIdFetchedAt:
        typeof parsed.userIdFetchedAt === "string" ? parsed.userIdFetchedAt : undefined,
      posts,
      fetchedAt,
      expiresAt,
      rateLimitedUntil:
        typeof parsed.rateLimitedUntil === "string" ? parsed.rateLimitedUntil : undefined,
      source: validSources.includes(source) ? source : "cache",
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return null;
  }
}
/** Read-only: used by profile GET /x-posts — never calls X API. */
export function getCachedXLatestPosts(
  handle: string | null,
  metadataValue: string | null | undefined,
): GetCachedXLatestPostsResult {
  const envelope = parseXLatestPostsCacheValue(metadataValue);
  const embedBlocked = isXPostsEmbedBlocked(envelope);
  if (envelope?.posts.length) {
    const stale = !isFutureIso(envelope.expiresAt);
    return {
      posts: envelope.posts,
      source: "cache",
      envelope: stale ? { ...envelope, source: "cache" } : envelope,
      embedBlocked,
    };
  }
  if (handle) {
    return {
      posts: [],
      source: embedBlocked ? "link" : "iframe",
      envelope,
      embedBlocked,
    };
  }
  return { posts: [], source: "none", envelope, embedBlocked: false };
}
export function shouldRefreshXPosts(
  envelope: XLatestPostsCacheEnvelope | null,
  opts: { force?: boolean } = {},
): { refresh: boolean; reason: string } {
  if (opts.force) return { refresh: true, reason: "forced" };
  if (!envelope) return { refresh: true, reason: "no_cache" };
  if (isFutureIso(envelope.rateLimitedUntil)) {
    return { refresh: false, reason: "rate_limited" };
  }
  if (isFutureIso(envelope.expiresAt)) {
    return { refresh: false, reason: "fresh" };
  }
  return { refresh: true, reason: "stale" };
}
