import {
  PUBLIC_HTTP_CACHE_POLICIES,
  publicStatisticsJson,
  publicStatisticsUnavailable,
} from "@/lib/public-statistics/http";
import { getTickerPayload } from "@/lib/public-statistics/service";
export const maxDuration = 30;
export async function GET() {
  try {
    return publicStatisticsJson(await getTickerPayload(), PUBLIC_HTTP_CACHE_POLICIES.ticker);
  } catch (error) {
    return publicStatisticsUnavailable("GET /api/stats/ticker", error);
  }
}
