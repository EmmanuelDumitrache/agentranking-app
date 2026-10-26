import { NextResponse } from "next/server";
import { getEcosystemStatsPayload } from "@/lib/ecosystem-statistics";
export const maxDuration = 30;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "X-API-Version": "1",
};
const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
/** GET /api/v1/stats — composed current counters, ecosystem extensions, and historical series. */
export async function GET() {
  try {
    const result = await getEcosystemStatsPayload();
    return NextResponse.json(
      { data: result.value },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": CACHE_CONTROL,
          "Last-Modified": new Date(result.generatedAt).toUTCString(),
          "X-AgentRanking-Origin-Cache": result.status,
        },
      },
    );
  } catch (error) {
    console.error("[api/v1/stats] unavailable", Error.isError(error) ? error.stack : String(error));
    return NextResponse.json(
      { error: "Ecosystem statistics are temporarily unavailable" },
      {
        status: 503,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-store",
          "Retry-After": "5",
        },
      },
    );
  }
}
