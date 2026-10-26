import { NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminMetaplexHubState } from "@/lib/admin/operations/metaplex.server";

export const dynamic = "force-dynamic";

/** Combined admin-only snapshot used by the Metaplex public-hub admin island. */
export async function GET() {
  try {
    return NextResponse.json(await readAdminMetaplexHubState());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/metaplex/hub error:", error);
    return NextResponse.json({ error: "Failed to load Metaplex admin state" }, { status: 500 });
  }
}
