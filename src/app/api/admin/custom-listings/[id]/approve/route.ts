import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { getSession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function POST(_request: NextRequest, { params }: Params) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const dbId = Number(id);
    if (!Number.isFinite(dbId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    await prisma.agent.update({
      where: { id: dbId },
      data: { isVerified: true, isPremiumVerified: false },
    });
    await invalidateAllPublicStatistics();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
