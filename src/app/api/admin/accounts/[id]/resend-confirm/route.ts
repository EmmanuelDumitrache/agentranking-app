import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { resendDashboardConfirmEmail } from "@/lib/dashboard/auth-register";
export const dynamic = "force-dynamic";
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(accountId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const profile = await prisma.userProfile.findUnique({
    where: { id: accountId },
    select: { email: true },
  });
  if (!profile?.email) {
    return NextResponse.json({ error: "Account has no email." }, { status: 400 });
  }
  const result = await resendDashboardConfirmEmail(profile.email);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
