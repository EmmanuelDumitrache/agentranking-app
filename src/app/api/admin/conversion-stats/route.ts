import { NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminConversionStats } from "@/lib/admin/operations/insights.server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readAdminConversionStats());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/conversion-stats error:", error);
    return NextResponse.json({ error: "Failed to load conversion stats" }, { status: 500 });
  }
}
