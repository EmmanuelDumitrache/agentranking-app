import { NextResponse } from "next/server";
import { prismaApiErrorLogFields, prismaApiRouteErrorResponse } from "@/lib/api-prisma-route-error";
import { readPublicNetworkSummaries } from "@/lib/agent-directory/network-summaries.server";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const NETWORKS_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};
export async function GET() {
  try {
    return NextResponse.json(await readPublicNetworkSummaries(), { headers: NETWORKS_CACHE_HEADERS });
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("GET /api/networks error:", {
      error: msg,
      stack: Error.isError(err) ? err.stack : undefined,
      ...prismaApiErrorLogFields(msg),
    });
    const { body, status, headers } = prismaApiRouteErrorResponse(msg);
    return NextResponse.json(body, { status, headers });
  }
}
