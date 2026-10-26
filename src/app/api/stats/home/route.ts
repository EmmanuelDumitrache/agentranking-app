import {
  PUBLIC_HTTP_CACHE_POLICIES,
  publicStatisticsJson,
  publicStatisticsUnavailable,
} from "@/lib/public-statistics/http";
import { getHomeStatsPayload } from "@/lib/public-statistics/service";
export const maxDuration = 60;
export async function GET() {
  try {
    return publicStatisticsJson(await getHomeStatsPayload(), PUBLIC_HTTP_CACHE_POLICIES.home);
  } catch (error) {
    return publicStatisticsUnavailable("GET /api/stats/home", error);
  }
}
