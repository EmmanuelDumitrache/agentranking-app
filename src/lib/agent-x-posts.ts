/**
 * Agent X/Twitter latest posts — `xLatestPosts` metadata envelope and post types.
 * Profile reads are cache-only; live X API runs only via `refreshXLatestPosts` in `src/lib/social/x-latest-posts.ts`.
 */
export type AgentXPostMetrics = {
  replies?: number;
  reposts?: number;
  likes?: number;
  views?: number;
};
export type AgentXPost = {
  id: string;
  authorHandle: string;
  text: string;
  createdAt?: string;
  url?: string;
  metrics?: AgentXPostMetrics;
  mediaUrl?: string;
};
export const X_LATEST_POSTS_METADATA_KEY = "xLatestPosts";
const MAX_POSTS = 8;
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseMetrics(raw: unknown): AgentXPostMetrics | undefined {
  if (!isRecord(raw)) return undefined;
  const out: AgentXPostMetrics = {};
  for (const key of ["replies", "reposts", "likes", "views"] as const) {
    const n = raw[key];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[key] = Math.floor(n);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
function parsePost(raw: unknown, index: number): AgentXPost | null {
  if (!isRecord(raw)) return null;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  const authorHandle =
    typeof raw.authorHandle === "string" && raw.authorHandle.trim()
      ? raw.authorHandle.trim()
      : "";
  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `post-${index}`;
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt.trim() : undefined;
  const url = typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : undefined;
  const mediaUrl =
    typeof raw.mediaUrl === "string" && raw.mediaUrl.trim() ? raw.mediaUrl.trim() : undefined;
  return {
    id,
    authorHandle,
    text: text.slice(0, 2000),
    createdAt,
    url,
    metrics: parseMetrics(raw.metrics),
    mediaUrl,
  };
}
export function parseXLatestPostsFromMetadataValue(value: string | null | undefined): AgentXPost[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: AgentXPost[] = [];
    for (let i = 0; i < parsed.length && out.length < MAX_POSTS; i++) {
      const post = parsePost(parsed[i], i);
      if (post) out.push(post);
    }
    return out;
  } catch {
    return [];
  }
}

export function xProfileUrlFromHandle(handle: string | null): string | null {
  if (!handle?.trim()) return null;
  const bare = handle.replace(/^@+/, "").trim();
  if (!bare) return null;
  return `https://x.com/${encodeURIComponent(bare)}`;
}
