import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidatePromotionPublicStatistics } from "@/lib/invalidate-public-statistics";
import { getSession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
/**
 * PATCH /api/admin/promotions/[id]
 * Body: { expiresAt?: string (ISO), cancel?: boolean }
 * If cancel: true, sets expiresAt = now. If expiresAt provided, updates to new date.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const promotionId = parseInt(id, 10);
    if (Number.isNaN(promotionId)) {
      return NextResponse.json({ error: "Invalid promotion id" }, { status: 400 });
    }
    const body = await request.json();
    const cancel = body.cancel === true;
    const expiresAtStr = body.expiresAt as string | undefined;
    const existing = await prisma.promotion.findUnique({
      where: { id: promotionId },
      include: { agent: { include: { chain: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
    }
    let newExpiresAt: Date;
    if (cancel) {
      newExpiresAt = new Date();
    } else if (expiresAtStr) {
      const parsed = new Date(expiresAtStr);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: "Invalid expiresAt date" },
          { status: 400 }
        );
      }
      newExpiresAt = parsed;
    } else {
      return NextResponse.json(
        { error: "Provide either cancel: true or expiresAt" },
        { status: 400 }
      );
    }
    const updated = await prisma.promotion.update({
      where: { id: promotionId },
      data: { expiresAt: newExpiresAt },
      include: { agent: { include: { chain: true } } },
    });
    await invalidatePromotionPublicStatistics();
    return NextResponse.json({
      promotion: {
        id: updated.id,
        agentId: updated.agentId,
        slotType: updated.slotType,
        expiresAt: updated.expiresAt,
        agent: updated.agent,
      },
    });
  } catch (err) {
    console.error("PATCH /api/admin/promotions/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to update promotion" },
      { status: 500 }
    );
  }
}
