import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasDashboardIdentity, ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
export const dynamic = "force-dynamic";
const MAX_BODY = 5_000;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = await ensureMinimalUserProfile(session);
  if (!resolved) {
    return NextResponse.json({ error: "Profile not found." }, { status: 400 });
  }
  const { id } = await params;
  const ticketId = Number.parseInt(id, 10);
  if (!Number.isFinite(ticketId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  let bodyText = "";
  try {
    const json = (await request.json()) as { message?: string };
    bodyText = String(json.message ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!bodyText) return NextResponse.json({ error: "Message is required." }, { status: 400 });
  if (bodyText.length > MAX_BODY) {
    return NextResponse.json({ error: `Message too long (max ${MAX_BODY} characters).` }, { status: 400 });
  }
  // Verify the ticket belongs to this user
  const ticket = await prisma.contactInquiry.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true, status: true },
  });
  if (!ticket || ticket.userId !== resolved.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (ticket.status === "resolved") {
    return NextResponse.json({ error: "This ticket is resolved and cannot receive new replies." }, { status: 400 });
  }
  const reply = await prisma.contactInquiryReply.create({
    data: {
      inquiryId: ticket.id,
      body: bodyText,
      authorRole: "user",
      readByUser: true,
      readByAdmin: false,
    },
    select: { id: true, body: true, createdAt: true, authorRole: true, readByUser: true },
  });
  return NextResponse.json({ ok: true, reply });
}
