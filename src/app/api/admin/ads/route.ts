import { NextRequest, NextResponse } from "next/server";
import {
  isAdminOperationsUnauthorized,
} from "@/lib/admin/operations/auth.server";
import { readAdminAds } from "@/lib/admin/operations/ads.server";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ads?status=pending|active|removed&activeOnly=true|false
 * Returns direct AdOrder rows + paid advertise AdPackage rows (unified list).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status =
    statusParam === "pending" || statusParam === "active" || statusParam === "removed"
      ? statusParam
      : undefined;

  try {
    return NextResponse.json(
      await readAdminAds({
        status,
        activeOnly: searchParams.get("activeOnly") !== "false",
      }),
    );
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/ads error:", error);
    return NextResponse.json({ error: "Failed to fetch ads" }, { status: 500 });
  }
}
