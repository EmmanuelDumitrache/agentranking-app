import { NextRequest, NextResponse } from "next/server";
import { readAdminAgentReportsApi } from "@/lib/admin/operations/agent-reports.server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await readAdminAgentReportsApi({
        page: Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10),
        perPage: Number.parseInt(request.nextUrl.searchParams.get("perPage") ?? "25", 10),
        status: request.nextUrl.searchParams.get("status"),
      }),
    );
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/agent-reports error:", error);
    return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
  }
}
