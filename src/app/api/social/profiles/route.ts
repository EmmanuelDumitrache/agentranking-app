import { NextRequest, NextResponse } from "next/server";
import {
  fetchSocialHubStats,
  fetchSocialProfilesPage,
  parseSocialFilter,
} from "@/lib/social-profiles-query";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
  const perPage = Math.min(50, Math.max(1, Number.parseInt(sp.get("perPage") ?? "20", 10) || 20));
  const q = sp.get("q") ?? "";
  const filter = parseSocialFilter(sp.get("filter"));
  const featured = sp.get("featured") === "true";
  const includeStats = sp.get("stats") !== "false";
  try {
    const pageResult = await fetchSocialProfilesPage({ page, perPage, filter, q, featured });
    const stats = includeStats ? await fetchSocialHubStats() : null;
    return NextResponse.json({
      profiles: pageResult.profiles,
      total: pageResult.total,
      totalPages: pageResult.totalPages,
      hasMore: pageResult.hasMore,
      totalIsExact: pageResult.totalIsExact,
      page,
      perPage,
      filter,
      stats,
    });
  } catch (err) {
    console.error("[social/profiles] GET error:", err);
    return NextResponse.json({ error: "Failed to load profiles" }, { status: 500 });
  }
}
