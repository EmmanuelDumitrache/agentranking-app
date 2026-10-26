import { NextRequest, NextResponse } from "next/server";
import { listPublicPartnerJobs } from "@/lib/jobs/query";
import {
  JOB_MIN_REWARD_FILTERS,
  JOB_POSTED_WITHIN_FILTERS,
  JOB_SORT_OPTIONS,
} from "@/lib/jobs/types";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const sortParam = searchParams.get("sort") ?? "best";
    const sort = JOB_SORT_OPTIONS.includes(sortParam as (typeof JOB_SORT_OPTIONS)[number])
      ? (sortParam as (typeof JOB_SORT_OPTIONS)[number])
      : "best";
    const minRewardParam = searchParams.get("minReward") ?? "any";
    const minReward = JOB_MIN_REWARD_FILTERS.includes(minRewardParam as (typeof JOB_MIN_REWARD_FILTERS)[number])
      ? minRewardParam
      : "any";
    const postedWithinParam = searchParams.get("postedWithin") ?? "all";
    const postedWithin = JOB_POSTED_WITHIN_FILTERS.includes(
      postedWithinParam as (typeof JOB_POSTED_WITHIN_FILTERS)[number],
    )
      ? postedWithinParam
      : "all";
    const result = await listPublicPartnerJobs({
      source: searchParams.get("source") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      q: searchParams.get("q") ?? undefined,
      sort,
      minReward,
      postedWithin,
      page: Number(searchParams.get("page") ?? "1"),
      perPage: Number(searchParams.get("perPage") ?? "20"),
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    console.error("GET /api/jobs:", msg);
    return NextResponse.json({ error: "Failed to list jobs" }, { status: 500 });
  }
}
