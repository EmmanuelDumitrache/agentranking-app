import { NextResponse } from "next/server";
import { getSapDashboardData } from "@/lib/sap-dashboard";
/** Public SAP ecosystem stats for /sap dashboard */
export async function GET() {
  try {
    const data = await getSapDashboardData();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      },
    });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    console.error("GET /api/sap/dashboard:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
