import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import type { AgentXPost } from "@/lib/agent-x-posts";
import { getXApiBearerToken } from "@/lib/x/x-api-auth";
import { rateLimitedUntilFromResponse, XApiRateLimitError } from "@/lib/x/x-api-errors";
export const X_API = "https://api.twitter.com/2";
const FETCH_TIMEOUT_MS = 12_000;

export const XTweetRowSchema = z.object({
  id: z.string().optional(),
  text: z.string().optional(),
  created_at: z.string().optional(),
  author_id: z.string().optional(),
  public_metrics: z.object({
    like_count: z.number().optional(),
    retweet_count: z.number().optional(),
    reply_count: z.number().optional(),
    impression_count: z.number().optional(),
  }).optional(),
});

export type XTweetRow = z.infer<typeof XTweetRowSchema>;

const XTweetsResponseSchema = z.object({
  data: z.array(XTweetRowSchema).optional(),
  includes: z.object({
    users: z.array(z.object({ id: z.string().optional(), username: z.string().optional() })).optional(),
  }).optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
});

export type XTweetsResponse = z.infer<typeof XTweetsResponseSchema>;

export function isNumericTweetId(id: string): boolean {
  return /^\d{5,25}$/.test(id.trim());
}
export function mapTweetRow(row: XTweetRow, displayHandle: string): AgentXPost | null {
  const text = row.text?.trim();
  if (!text || !row.id) return null;
  const bare = displayHandle.replace(/^@+/, "").trim();
  const m = row.public_metrics;
  return {
    id: row.id,
    authorHandle: displayHandle.startsWith("@") ? displayHandle : `@${bare}`,
    text,
    createdAt: row.created_at,
    url: bare ? `https://x.com/${bare}/status/${row.id}` : `https://x.com/i/web/status/${row.id}`,
    metrics: m
      ? {
          likes: m.like_count,
          reposts: m.retweet_count,
          replies: m.reply_count,
          views: m.impression_count,
        }
      : undefined,
  };
}
export async function xApiGet<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  const bearer = getXApiBearerToken();
  if (!bearer) throw new Error("X API bearer token not configured");
  const res = await fetch(`${X_API}${path}`, {
    headers: { Authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new XApiRateLimitError(`X API 429: Rate limited`, rateLimitedUntilFromResponse(res));
    }
    throw new Error(`X API ${res.status}: ${res.statusText}`);
  }
  return parseBoundedJsonBody(res, schema, 4 * 1024 * 1024);
}
const TWEET_FIELDS = "tweet.fields=created_at,public_metrics,text,author_id";
/**
 * GET /2/tweets?ids=… — up to 100 posts per request (X API v2).
 */
export async function fetchTweetsByIds(
  tweetIds: string[],
  displayHandle: string,
): Promise<AgentXPost[]> {
  if (!getXApiBearerToken()) return [];
  const ids = [...new Set(tweetIds.map((id) => id.trim()).filter(isNumericTweetId))].slice(0, 100);
  if (ids.length === 0) return [];
  const path = `/tweets?ids=${ids.join(",")}&${TWEET_FIELDS}&expansions=author_id&user.fields=username`;
  const body = await xApiGet(path, XTweetsResponseSchema);
  const usersById = new Map<string, string>();
  for (const u of body.includes?.users ?? []) {
    if (u.id && u.username) usersById.set(u.id, `@${u.username}`);
  }
  const out: AgentXPost[] = [];
  for (const row of body.data ?? []) {
    const authorFromExpansion =
      row.author_id && usersById.get(row.author_id) ? usersById.get(row.author_id)! : displayHandle;
    const post = mapTweetRow(row, authorFromExpansion);
    if (post) out.push(post);
  }
  return out;
}