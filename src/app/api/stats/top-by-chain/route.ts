import {
  PUBLIC_HTTP_CACHE_POLICIES,
  publicStatisticsJson,
  publicStatisticsUnavailable,
} from "@/lib/public-statistics/http";
import { getTopByChainPayload } from "@/lib/public-statistics/service";
export const maxDuration = 30;
export async function GET() {
  try {
    return publicStatisticsJson(await getTopByChainPayload(), PUBLIC_HTTP_CACHE_POLICIES.topByChain);
  } catch (error) {
    return publicStatisticsUnavailable("GET /api/stats/top-by-chain", error);
  }
}
