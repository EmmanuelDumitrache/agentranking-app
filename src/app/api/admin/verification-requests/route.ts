import { NextRequest, NextResponse } from "next/server";
import { isAdminIdentityAccessError } from "@/lib/admin/identity/auth.server";
import { normalizeAdminVerificationRequestsQuery } from "@/lib/admin/identity/query";
import { readAdminVerificationRequests } from "@/lib/admin/identity/verification-requests.server";

export const dynamic = "force-dynamic";

/** GET /api/admin/verification-requests */
export async function GET(request: NextRequest) {
  try {
    const query = normalizeAdminVerificationRequestsQuery({
      status: request.nextUrl.searchParams.get("status"),
      page: request.nextUrl.searchParams.get("page"),
      perPage: request.nextUrl.searchParams.get("perPage"),
    });
    return NextResponse.json(await readAdminVerificationRequests(query));
  } catch (error) {
    if (isAdminIdentityAccessError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/verification-requests] GET error:", error);
    return NextResponse.json({ error: "Failed to load verification requests" }, { status: 500 });
  }
}
