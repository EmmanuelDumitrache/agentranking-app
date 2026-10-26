import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(accountId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as { password?: string; clear?: boolean };
  if (body.clear) {
    await prisma.userProfile.update({
      where: { id: accountId },
      data: { passwordHash: null },
    });
    return NextResponse.json({ ok: true, cleared: true });
  }
  const password = body.password?.trim();
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  const passwordHash = await hash(password, 12);
  await prisma.userProfile.update({
    where: { id: accountId },
    data: { passwordHash },
  });
  return NextResponse.json({ ok: true });
}