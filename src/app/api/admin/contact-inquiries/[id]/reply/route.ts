import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { sendSupportInquiryReply } from "@/lib/email";
export const dynamic = "force-dynamic";
const MAX_BODY = 10_000;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const inquiryId = Number.parseInt(id, 10);
  if (!Number.isFinite(inquiryId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  let bodyText = "";
  try {
    const json = (await request.json()) as { message?: string };
    bodyText = String(json.message ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!bodyText) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (bodyText.length > MAX_BODY) {
    return NextResponse.json({ error: `Message too long (max ${MAX_BODY} characters).` }, { status: 400 });
  }
  const inquiry = await prisma.contactInquiry.findUnique({
    where: { id: inquiryId },
    select: { id: true, email: true, name: true, subject: true },
  });
  if (!inquiry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const reply = await prisma.contactInquiryReply.create({
    data: {
      inquiryId: inquiry.id,
      body: bodyText,
      authorRole: "admin",
      readByAdmin: true,
      readByUser: false,
    },
    select: { id: true, body: true, createdAt: true, authorRole: true, readByUser: true },
  });
  const emailResult = await sendSupportInquiryReply(inquiry.email, {
    ticketId: inquiry.id,
    subject: inquiry.subject,
    replyBody: bodyText,
    customerName: inquiry.name,
  });
  return NextResponse.json({
    ok: true,
    reply,
    emailSent: emailResult.sent,
    emailError: emailResult.error,
  });
}