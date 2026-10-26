import { NextRequest, NextResponse } from "next/server";
import { readArTokenStakingPublicPayload } from "@/lib/ar-token-staking-data";
export const dynamic = "force-dynamic";
function parsePositiveLimit(raw: string | null, max = 5000): number | undefined {
  if (raw === null || raw === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, max);
}
/**
 * GET /api/token/staking — public staking aggregates + flows.
 * Totals always use **all** staking rows; optional `flowLimit` / `rewardLimit` trim list payloads only.
 */
export async function GET(request: NextRequest) {
  try {
    const flowLimit = parsePositiveLimit(request.nextUrl.searchParams.get("flowLimit"));
    const rewardLimit = parsePositiveLimit(request.nextUrl.searchParams.get("rewardLimit"));
    const payload = await readArTokenStakingPublicPayload({ flowLimit, rewardLimit });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("[token/staking] GET error:", err);
    return NextResponse.json({ error: "Failed to load staking data" }, { status: 500 });
  }
}