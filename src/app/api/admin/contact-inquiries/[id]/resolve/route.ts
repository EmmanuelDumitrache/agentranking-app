import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const inquiryId = parseInt(id, 10);
  if (!Number.isFinite(inquiryId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await prisma.contactInquiry.update({
    where: { id: inquiryId },
    data: { status: "resolved" },
  });
  return NextResponse.json({ ok: true });
}