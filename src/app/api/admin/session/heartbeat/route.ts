import { touchAdminSessionFromRequest } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
/**
 * POST /api/admin/session/heartbeat
 * Refreshes last access IP / time in the admin session (best-effort).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await touchAdminSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/session/heartbeat] error:", err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}