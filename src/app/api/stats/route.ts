import {
  PUBLIC_HTTP_CACHE_POLICIES,
  publicStatisticsJson,
  publicStatisticsUnavailable,
} from "@/lib/public-statistics/http";
import { getStatsPayload } from "@/lib/public-statistics/service";
export const maxDuration = 60;
export async function GET() {
  try {
    return publicStatisticsJson(await getStatsPayload(), PUBLIC_HTTP_CACHE_POLICIES.stats);
  } catch (error) {
    return publicStatisticsUnavailable("GET /api/stats", error);
  }
}
