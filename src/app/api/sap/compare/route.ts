import { NextRequest, NextResponse } from "next/server";
import { readSapComparison } from "@/lib/sap/compare.server";

export async function GET(request: NextRequest) {
  try {
    const result = await readSapComparison(
      request.nextUrl.searchParams.get("a"),
      request.nextUrl.searchParams.get("b"),
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.found ? { found: result.found } : {}) },
        { status: result.status },
      );
    }
    return NextResponse.json(result.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.error("GET /api/sap/compare:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
