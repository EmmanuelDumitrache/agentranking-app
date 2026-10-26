import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidatePromotionPublicStatistics } from "@/lib/invalidate-public-statistics";
import { generateOrderNumber } from "@/lib/order-number";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
const VALID_DURATIONS = [1, 2, 7, 14, 30];
function unauth() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
/**
 * GET /api/admin/promotions?slotType=hot|featured&activeOnly=true|false
 * Returns promotions with agent details. Default activeOnly=true.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauth();
  try {
    const { searchParams } = new URL(request.url);
    const slotTypeParam = searchParams.get("slotType");
    const activeOnly = searchParams.get("activeOnly") !== "false";
    const where: { slotType?: string; expiresAt?: { gt: Date } } = {};
    if (slotTypeParam === "hot" || slotTypeParam === "featured") {
      where.slotType = slotTypeParam;
    }
    if (activeOnly) {
      where.expiresAt = { gt: new Date() };
    }
    const promotions = await prisma.promotion.findMany({
      where,
      include: { agent: { include: { chain: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      promotions: promotions.map((p) => ({
        id: p.id,
        agentId: p.agentId,
        slotType: p.slotType,
        durationDays: p.durationDays,
        expiresAt: p.expiresAt,
        wallet: p.wallet,
        orderNumber: p.orderNumber,
        createdAt: p.createdAt,
        agent: p.agent
          ? {
              id: p.agent.id,
              name: p.agent.name,
              chainId: p.agent.chainId,
              chain: p.agent.chain
                ? { id: p.agent.chain.id, name: p.agent.chain.name }
                : null,
              image: p.agent.image,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/promotions error:", err);
    return NextResponse.json(
      { error: "Failed to fetch promotions" },
      { status: 500 }
    );
  }
}
/**
 * POST /api/admin/promotions
 * Body: { agentId, slotType: "hot"|"featured", durationDays }
 * Manually add an agent to a promotion slot.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauth();
  try {
    const body = await request.json();
    const agentId = Number(body.agentId);
    const slotType = body.slotType as string;
    const durationDays = Number(body.durationDays) || 7;
    if (!agentId || !slotType) {
      return NextResponse.json(
        { error: "agentId and slotType are required" },
        { status: 400 }
      );
    }
    if (slotType !== "hot" && slotType !== "featured") {
      return NextResponse.json(
        { error: "slotType must be 'hot' or 'featured'" },
        { status: 400 }
      );
    }
    if (!VALID_DURATIONS.includes(durationDays)) {
      return NextResponse.json(
        { error: "durationDays must be one of: 1, 2, 7, 14, 30" },
        { status: 400 }
      );
    }
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { chain: true },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    if (!agent.isVerified) {
      return NextResponse.json(
        { error: "Agent must be verified before promotion" },
        { status: 403 }
      );
    }
    const txHash = `admin-${Date.now()}-${randomBytes(8).toString("hex")}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    const promotion = await prisma.promotion.create({
      data: {
        agentId,
        slotType,
        durationDays,
        txHash,
        paidAmount: "0",
        currency: "ETH",
        paymentToken: "ETH",
        wallet: "admin",
        expiresAt,
      },
      include: { agent: { include: { chain: true } } },
    });
    const orderNumber = generateOrderNumber(promotion.id);
    await prisma.promotion.update({
      where: { id: promotion.id },
      data: { orderNumber },
    });
    if (slotType === "hot") {
      let powerValue = durationDays * 5;
      try {
        const usdcRow = await prisma.promotionPrice.findFirst({
          where: { slotType: "hot", currency: "USDC", durationDays },
        });
        if (usdcRow) {
          powerValue = Math.round(Number.parseFloat(usdcRow.amount));
        }
      } catch {
        // keep fallback
      }
      await prisma.agent.update({
        where: { id: agentId },
        data: { hotScore: { increment: powerValue } },
      });
    }
    await invalidatePromotionPublicStatistics();
    const updated = await prisma.promotion.findUnique({
      where: { id: promotion.id },
      include: { agent: { include: { chain: true } } },
    });
    return NextResponse.json({
      promotion: updated
        ? {
            id: updated.id,
            agentId: updated.agentId,
            slotType: updated.slotType,
            durationDays: updated.durationDays,
            expiresAt: updated.expiresAt,
            orderNumber: updated.orderNumber,
            agent: updated.agent,
          }
        : null,
    });
  } catch (err) {
    console.error("POST /api/admin/promotions error:", err);
    return NextResponse.json(
      {
        error:
          Error.isError(err) ? err.message : "Failed to create promotion",
      },
      { status: 500 }
    );
  }
}
