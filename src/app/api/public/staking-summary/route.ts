import { NextResponse } from "next/server";
import { readPublicStakeSummary } from "@/lib/stake-page-summary.server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await readPublicStakeSummary(), {
      headers: {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
      },
    });
  } catch (error) {
    console.error("[public/staking-summary] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load staking summary" },
      { status: 500 },
    );
  }
}
