import type { NextRequest } from "next/server";
import {
  PUBLIC_HTTP_CACHE_POLICIES,
  publicStatisticsBadRequest,
  publicStatisticsJson,
  publicStatisticsUnavailable,
} from "@/lib/public-statistics/http";
import {
  POWERBOOST_PERIODS,
  getPowerBoostPayload,
  type PowerBoostPeriod,
} from "@/lib/public-statistics/service";
export const maxDuration = 60;
function parseBoundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return null;
  return parsed;
}
function isPowerBoostPeriod(value: string): value is PowerBoostPeriod {
  return (POWERBOOST_PERIODS as readonly string[]).includes(value);
}
export async function GET(request: NextRequest) {
  const page = parseBoundedInteger(request.nextUrl.searchParams.get("page"), 1, 1, 10_000);
  const perPage = parseBoundedInteger(request.nextUrl.searchParams.get("perPage"), 20, 1, 50);
  const periodValue = request.nextUrl.searchParams.get("period") || "all";
  if (page == null) return publicStatisticsBadRequest("page must be an integer from 1 to 10000");
  if (perPage == null) return publicStatisticsBadRequest("perPage must be an integer from 1 to 50");
  if (!isPowerBoostPeriod(periodValue)) {
    return publicStatisticsBadRequest("period must be one of: all, 12h, 24h, week, month");
  }
  try {
    return publicStatisticsJson(
      await getPowerBoostPayload({ page, perPage, period: periodValue }),
      PUBLIC_HTTP_CACHE_POLICIES.powerBoost,
    );
  } catch (error) {
    return publicStatisticsUnavailable("GET /api/powerboost", error);
  }
}
