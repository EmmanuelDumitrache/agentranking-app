import { NextRequest, NextResponse } from "next/server";
import { isAdminIdentityAccessError } from "@/lib/admin/identity/auth.server";
import { readAdminCreators } from "@/lib/admin/identity/creators.server";
import { normalizeAdminCreatorsQuery } from "@/lib/admin/identity/query";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/creators?page=1&perPage=25&search=&provider=all|google|credentials|wallet
 */
export async function GET(request: NextRequest) {
  try {
    const query = normalizeAdminCreatorsQuery({
      page: request.nextUrl.searchParams.get("page"),
      perPage: request.nextUrl.searchParams.get("perPage"),
      search: request.nextUrl.searchParams.get("search"),
      provider: request.nextUrl.searchParams.get("provider"),
    });
    return NextResponse.json(await readAdminCreators(query));
  } catch (error) {
    if (isAdminIdentityAccessError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/creators] GET error:", error);
    return NextResponse.json({ error: "Failed to load creators" }, { status: 500 });
  }
}
