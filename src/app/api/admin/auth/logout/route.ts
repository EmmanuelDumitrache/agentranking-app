import { NextResponse } from "next/server";
import { destroySession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
/**
 * POST /api/admin/auth/logout
 * Clears the admin session cookie.
 */
export async function POST() {
  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // Idempotent
  }
}