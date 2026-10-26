import { NextRequest, NextResponse } from "next/server";
import { isAdminIdentityAccessError } from "@/lib/admin/identity/auth.server";
import { readAdminContactInquiries } from "@/lib/admin/identity/contact.server";
import { normalizeAdminContactQuery } from "@/lib/admin/identity/query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = normalizeAdminContactQuery({
      page: request.nextUrl.searchParams.get("page"),
      perPage: request.nextUrl.searchParams.get("perPage"),
      status: request.nextUrl.searchParams.get("status"),
      dashboardOnly: request.nextUrl.searchParams.get("dashboardOnly"),
    });
    return NextResponse.json(await readAdminContactInquiries(query));
  } catch (error) {
    if (isAdminIdentityAccessError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[api/admin/contact-inquiries] GET:", error);
    const hint = process.env.NODE_ENV === "development" && Error.isError(error)
      ? error.message
      : undefined;
    return NextResponse.json(
      { error: "Failed to load inquiries.", ...(hint ? { hint } : {}) },
      { status: 500 },
    );
  }
}
