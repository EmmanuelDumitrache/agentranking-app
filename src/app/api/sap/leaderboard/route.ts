import { NextRequest, NextResponse } from "next/server";
import { getSapLeaderboard } from "@/lib/sap-ecosystem";
import { normalizeSapLeaderboardMode } from "@/lib/sap-ecosystem-shared";

export async function GET(request: NextRequest) {
  const mode = normalizeSapLeaderboardMode(request.nextUrl.searchParams.get("mode"));
  try {
    const entries = await getSapLeaderboard(mode, 100);
    return NextResponse.json({ mode, entries }, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.error("GET /api/sap/leaderboard:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
