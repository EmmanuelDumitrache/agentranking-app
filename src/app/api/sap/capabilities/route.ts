import { NextResponse } from "next/server";
import { getSapCapabilityIndex } from "@/lib/sap-ecosystem";
export async function GET() {
  try {
    const index = await getSapCapabilityIndex();
    return NextResponse.json({ capabilities: index }, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    console.error("GET /api/sap/capabilities:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
