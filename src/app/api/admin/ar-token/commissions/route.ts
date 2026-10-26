import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { readAdminReferralCommissions } from "@/lib/admin/operations/ar-token.server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
export const dynamic = "force-dynamic";
function clean(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
/** GET /api/admin/ar-token/commissions?status=pending|approved|paid|rejected|all */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await readAdminReferralCommissions(request.nextUrl.searchParams.get("status")),
    );
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/ar-token/commissions error:", error);
    return NextResponse.json({ error: "Could not load commissions" }, { status: 500 });
  }
}
/** PATCH /api/admin/ar-token/commissions — update status of one commission */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as {
    id: string;
    status: string;
    adminNote?: string;
  };
  const id = clean(body.id, 40);
  const status = clean(body.status, 20);
  const adminNote = clean(body.adminNote, 500);
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!["pending", "approved", "paid", "rejected"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const existing = await prisma.arReferralCommission.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Commission not found" }, { status: 404 });
  const updated = await prisma.arReferralCommission.update({
    where: { id },
    data: {
      status,
      adminNote: adminNote || undefined,
      paidAt: status === "paid" ? new Date() : undefined,
    },
    select: {
      id: true,
      status: true,
      paidAt: true,
      adminNote: true,
    },
  });
  return NextResponse.json({ ok: true, commission: { ...updated, paidAt: updated.paidAt?.toISOString() ?? null } });
}
