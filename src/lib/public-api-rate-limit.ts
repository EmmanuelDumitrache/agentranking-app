import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { slidingWindowLimit } from "@/lib/valkey";
/** Matches v1 route handlers for CORS and error JSON. */
export const PUBLIC_API_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "X-API-Version": "1",
} as const;
/** v2 public API — same CORS shape, different version header. */
export const EXTENDED_PUBLIC_API_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "X-API-Version": "2",
} as const;
function parseRequestsPerMinute(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 10_000);
}
export function getClientIp(request: NextRequest): string {
  // Production binds Next.js to loopback and nginx overwrites X-Real-IP. Prefer
  // that trusted hop over client-supplied forwarding headers.
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded.split(",").map((value) => value.trim()).filter(Boolean);
    const last = entries.at(-1);
    if (last) return last;
  }
  return "unknown";
}
export type PublicApiRateLimitKind = "standard" | "extended" | "agents" | "probe";
function limiterConfig(kind: PublicApiRateLimitKind): { limit: number; prefix: string } {
  if (kind === "standard") {
    return {
      limit: parseRequestsPerMinute(process.env.PUBLIC_API_RATELIMIT_PER_MINUTE, 60),
      prefix: "ratelimit:public-api-standard",
    };
  }
  if (kind === "extended") {
    return {
      limit: parseRequestsPerMinute(
        process.env.PUBLIC_API_V2_RATELIMIT_PER_MINUTE ?? process.env.PUBLIC_API_RATELIMIT_PER_MINUTE,
        60,
      ),
      prefix: "ratelimit:public-api-extended",
    };
  }
  if (kind === "agents") {
    return {
      limit: parseRequestsPerMinute(process.env.AGENTS_API_RATELIMIT_PER_MINUTE, 120),
      prefix: "ratelimit:agents",
    };
  }
  return {
    limit: parseRequestsPerMinute(process.env.ENDPOINT_PROBE_RATELIMIT_PER_MINUTE, 20),
    prefix: "ratelimit:endpoint-probe",
  };
}
/** Returns a 429 response when blocked, or null to continue. */
export async function rateLimitPublicApi(
  request: NextRequest,
  kind: PublicApiRateLimitKind,
): Promise<NextResponse | null> {
  const ip = getClientIp(request);
  const config = limiterConfig(kind);
  const result = await slidingWindowLimit({
    key: `${config.prefix}:${ip}`,
    limit: config.limit,
    windowMs: 60_000,
  });
  if (result.success) return null;
  const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  const cors = kind === "extended" ? EXTENDED_PUBLIC_API_CORS_HEADERS : PUBLIC_API_CORS_HEADERS;
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        ...cors,
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}
