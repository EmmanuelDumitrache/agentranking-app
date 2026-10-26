import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasDashboardIdentity, ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
export const dynamic = "force-dynamic";
export async function PATCH(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = await ensureMinimalUserProfile(session);
  if (!resolved) return NextResponse.json({ error: "Profile not found" }, { status: 400 });
  const { id } = await params;
  const ticketId = Number.parseInt(id, 10);
  if (!Number.isFinite(ticketId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  // Verify ticket belongs to user
  const ticket = await prisma.contactInquiry.findUnique({
    where: { id: ticketId },
    select: { userId: true },
  });
  if (!ticket || ticket.userId !== resolved.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.contactInquiryReply.updateMany({
    where: { inquiryId: ticketId, readByUser: false },
    data: { readByUser: true },
  });
  return NextResponse.json({ ok: true });
}
