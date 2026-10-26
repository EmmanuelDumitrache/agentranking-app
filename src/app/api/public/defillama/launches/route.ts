import { NextResponse } from "next/server";
import { buildDefillamaLaunchTvlExport } from "@/lib/defillama/launch-tvl-export.server";

export const dynamic = "force-dynamic";
export const revalidate = 300;

/**
 * Public mint/pool export for DefiLlama TVL adapters.
 * Stable contract: only additive fields; never rename without coordinating Llama PR.
 *
 * GET /api/public/defillama/launches
 */
export async function GET() {
  try {
    const payload = await buildDefillamaLaunchTvlExport();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[api/public/defillama/launches]", err);
    return NextResponse.json(
      { error: "Failed to export launch TVL universe" },
      { status: 500 },
    );
  }
}
