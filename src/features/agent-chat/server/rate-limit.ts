/** Agent Chat rate limiter backed by the required local Valkey service. */
import { slidingWindowLimit } from "@/lib/valkey";

function parseRequestsPerMinute(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 10_000);
}

export type ChatRateLimitResult = {
  allowed: boolean;
  retryAfterSec?: number;
  limit?: number;
  remaining?: number;
};

export async function checkChatRateLimit(
  appAccountId: string,
): Promise<ChatRateLimitResult | null> {
  const limit = parseRequestsPerMinute(process.env.CHAT_STREAM_RATELIMIT_PER_MINUTE, 30);
  const result = await slidingWindowLimit({
    key: `ratelimit:chat-stream:chat:${appAccountId}`,
    limit,
    windowMs: 60_000,
  });
  if (result.success) return null;
  return {
    allowed: false,
    retryAfterSec: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    limit: result.limit,
    remaining: result.remaining,
  };
}
