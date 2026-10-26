import {
  PUBLIC_HTTP_CACHE_POLICIES,
  publicStatisticsJson,
  publicStatisticsUnavailable,
} from "@/lib/public-statistics/http";
import { getCountersPayload } from "@/lib/public-statistics/service";
export const maxDuration = 15;
export async function GET() {
  try {
    return publicStatisticsJson(await getCountersPayload(), PUBLIC_HTTP_CACHE_POLICIES.counters);
  } catch (error) {
    return publicStatisticsUnavailable("GET /api/stats/counters", error);
  }
}
