import { NextRequest, NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminDaoVotes } from "@/lib/admin/operations/dao-votes.server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET /api/admin/dao-votes?search=&limit=&scope= */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const payload = await readAdminDaoVotes({
      search: searchParams.get("search"),
      scope: searchParams.get("scope"),
      limit: Number.parseInt(searchParams.get("limit") ?? "500", 10),
    });
    return new NextResponse(
      JSON.stringify(payload, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/dao-votes error:", error);
    const message = error instanceof Error ? error.message : "Failed to list agents";
    return NextResponse.json(
      {
        error: "Failed to list agents",
        ...(process.env.NODE_ENV === "development" ? { details: message } : {}),
      },
      { status: 500 },
    );
  }
}
