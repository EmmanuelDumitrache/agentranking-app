import { NextResponse } from "next/server";
import { buildDefillamaLaunchFeesExport } from "@/lib/defillama/launch-fees-export.server";

export const dynamic = "force-dynamic";
export const revalidate = 300;

/**
 * Public allowlist + treasury identities for the DefiLlama fees adapter.
 * GET /api/public/defillama/fees
 */
export async function GET() {
  try {
    const payload = await buildDefillamaLaunchFeesExport();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[api/public/defillama/fees]", err);
    return NextResponse.json({ error: "Failed to export launch fees universe" }, { status: 500 });
  }
}
