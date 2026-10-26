import "server-only";
import { NextResponse } from "next/server";
import type { PublicApiCacheResult } from "@/lib/public-api-cache";
export type PublicHttpCachePolicy = {
  sMaxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
};
export const PUBLIC_HTTP_CACHE_POLICIES = {
  counters: { sMaxAgeSeconds: 30, staleWhileRevalidateSeconds: 120 },
  stats: { sMaxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 },
  topByChain: { sMaxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 },
  home: { sMaxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 },
  ticker: { sMaxAgeSeconds: 120, staleWhileRevalidateSeconds: 240 },
  powerBoost: { sMaxAgeSeconds: 120, staleWhileRevalidateSeconds: 240 },
} as const satisfies Record<string, PublicHttpCachePolicy>;
function cacheControl(policy: PublicHttpCachePolicy): string {
  return [
    "public",
    `s-maxage=${policy.sMaxAgeSeconds}`,
    `stale-while-revalidate=${policy.staleWhileRevalidateSeconds}`,
  ].join(", ");
}
export function publicStatisticsJson<T>(
  result: PublicApiCacheResult<T>,
  policy: PublicHttpCachePolicy,
): NextResponse<T> {
  const generatedAt = new Date(result.generatedAt);
  return NextResponse.json(result.value, {
    headers: {
      "Cache-Control": cacheControl(policy),
      "Last-Modified": generatedAt.toUTCString(),
      "X-AgentRanking-Origin-Cache": result.status,
    },
  });
}
export function publicStatisticsUnavailable(
  route: string,
  error: unknown,
): NextResponse<{ error: string }> {
  console.error(`[public-statistics] ${route} failed:`, Error.isError(error) ? error.stack : String(error));
  return NextResponse.json(
    { error: "Failed to load public statistics." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
export function publicStatisticsBadRequest(message: string): NextResponse<{ error: string }> {
  return NextResponse.json(
    { error: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
