import { NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminCustomListings } from "@/lib/admin/operations/custom-listings.server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readAdminCustomListings());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/custom-listings error:", error);
    return NextResponse.json({ error: "Failed to load custom listings" }, { status: 500 });
  }
}
