import { NextRequest, NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminOrders } from "@/lib/admin/operations/orders.server";

export const dynamic = "force-dynamic";

/** GET /api/admin/orders?status=pending|paid|all&page=1&perPage=50 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    return NextResponse.json(
      await readAdminOrders({
        status: searchParams.get("status"),
        page: Number.parseInt(searchParams.get("page") ?? "1", 10),
        perPage: Number.parseInt(searchParams.get("perPage") ?? "50", 10),
      }),
    );
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/orders] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}
