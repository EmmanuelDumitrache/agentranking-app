import { NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminMetaplexOpsStatus } from "@/lib/admin/operations/metaplex.server";

export const dynamic = "force-dynamic";

/** GET /api/admin/metaplex/status — admin-only Metaplex indexer ops snapshot. */
export async function GET() {
  try {
    return NextResponse.json(await readAdminMetaplexOpsStatus());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/metaplex/status error:", error);
    return NextResponse.json({ error: "Failed to load Metaplex ops status" }, { status: 500 });
  }
}
