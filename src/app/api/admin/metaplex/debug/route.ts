import { NextResponse } from "next/server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminMetaplexDebugStats } from "@/lib/admin/operations/metaplex.server";

export const dynamic = "force-dynamic";

/** GET /api/admin/metaplex/debug — admin DB/filter diagnostics for Metaplex listings. */
export async function GET() {
  try {
    return NextResponse.json(await readAdminMetaplexDebugStats());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/metaplex/debug error:", error);
    return NextResponse.json({ error: "Failed to load Metaplex diagnostics" }, { status: 500 });
  }
}
