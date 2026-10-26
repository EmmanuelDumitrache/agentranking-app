import { NextResponse } from "next/server";
import { fetchArOpsWalletActivity } from "@/lib/ar-ops-wallet-activity.server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
};
export async function GET(request: Request) {
  const sync = new URL(request.url).searchParams.get("sync") === "1";
  const payload = await fetchArOpsWalletActivity({ syncToDb: sync });
  return NextResponse.json(payload, { headers: CACHE_HEADERS });
}