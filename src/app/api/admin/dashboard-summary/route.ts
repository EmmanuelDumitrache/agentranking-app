import { touchAdminSessionFromRequest } from "@/lib/admin-auth";
import {
  isAdminOperationsUnauthorized,
} from "@/lib/admin/operations/auth.server";
import { readAdminDashboardSummary } from "@/lib/admin/operations/dashboard.server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
};

/**
 * GET /api/admin/dashboard-summary
 * ?quick=1 — skip conversion funnel (fast first paint on /admin)
 */
export async function GET(request: NextRequest) {
  const touchedSession = await touchAdminSessionFromRequest(request);
  if (!touchedSession) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const quick = new URL(request.url).searchParams.get("quick") === "1";
  try {
    const body = await readAdminDashboardSummary({ quick });
    return NextResponse.json(body, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    console.error("[admin/dashboard-summary] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load dashboard summary" },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
