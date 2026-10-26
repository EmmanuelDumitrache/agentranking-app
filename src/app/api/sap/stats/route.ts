import { NextResponse } from "next/server";
import { getPublicSapStatsPayload } from "@/lib/sap-ecosystem";
/** Public Trust Oracle stats — no auth; CDN cache 5 minutes */
export async function GET() {
  try {
    const data = await getPublicSapStatsPayload();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=120",
      },
    });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    console.error("GET /api/sap/stats:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
