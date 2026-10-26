import { NextRequest, NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminVerifiedAgents } from "@/lib/admin/operations/verified-agents.server";

export const dynamic = "force-dynamic";

/** GET /api/admin/verified-agents?page=1&perPage=25&search=&filter=all|verified|unverified */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    return NextResponse.json(
      await readAdminVerifiedAgents({
        page: Number.parseInt(searchParams.get("page") ?? "1", 10),
        perPage: Number.parseInt(searchParams.get("perPage") ?? "25", 10),
        search: searchParams.get("search"),
        filter: searchParams.get("filter"),
      }),
    );
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/verified-agents error:", error);
    return NextResponse.json({ error: "Failed to list agents" }, { status: 500 });
  }
}
