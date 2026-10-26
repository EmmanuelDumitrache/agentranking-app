import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { claimPaymentTransactionInTx, paymentWalletsEqual, verifyPayment } from "@/lib/payment-verify";
import { getJobProducer } from "@/jobs/boss";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
import { generateOrderNumber } from "@/lib/order-number";
import { isValidEmail } from "@/lib/dashboard/auth-validate";
import { invalidatePromotionPublicStatistics } from "@/lib/invalidate-public-statistics";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const VALID_DURATIONS = [1, 2, 7, 14, 30];
class PromotionStateConflictError extends Error {}
class PromotionOwnershipError extends Error {}
/**
 * GET /api/promotions?slotType=hot
 * Returns active promotions for the given slot type.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slotType = searchParams.get("slotType") || "";
    const where: { slotType?: string; expiresAt?: { gt: Date } } = {
      expiresAt: { gt: new Date() },
    };
    if (slotType === "hot" || slotType === "featured") {
      where.slotType = slotType;
    }
    const promotions = await prisma.promotion.findMany({
      where,
      include: { agent: { include: { chain: true } } },
      orderBy: { expiresAt: "desc" },
      take: 201,
    });
    const truncated = promotions.length > 200;
    return NextResponse.json({
      promotions: promotions.slice(0, 200).map((p) => ({
        id: p.id,
        agentId: p.agentId,
        slotType: p.slotType,
        expiresAt: p.expiresAt,
        agent: p.agent,
      })),
      truncated,
    });
  } catch (err) {
    console.error("GET /api/promotions error:", err);
    return NextResponse.json(
      { error: "Failed to fetch promotions" },
      { status: 500 }
    );
  }
}
/**
 * POST /api/promotions
 * Body: { agentId, slotType, txHash, wallet, paymentToken?, durationDays?, email? }
 * Verifies on-chain payment and creates promotion for the specified duration.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const agentId = Number(body.agentId);
    const slotType = body.slotType as string;
    const txHash = (body.txHash as string)?.trim();
    const wallet = (body.wallet as string)?.trim();
    const paymentToken = ((body.paymentToken as string) || "ETH").toUpperCase();
    const durationDays = Number(body.durationDays) || 7;
    const email = (body.email as string | undefined)?.trim();
    if (!Number.isSafeInteger(agentId) || agentId <= 0 || !slotType || !txHash || !wallet) {
      return NextResponse.json(
        {
          error: "Missing required fields: agentId, slotType, txHash, wallet",
        },
        { status: 400 }
      );
    }
    if (slotType === "power_boost") {
      return NextResponse.json(
        { error: "Power-boost checkout is unavailable. Use the unified order checkout flow." },
        { status: 410 },
      );
    }
    if (!["hot", "featured"].includes(slotType)) {
      return NextResponse.json(
        { error: "slotType must be 'hot' or 'featured'" },
        { status: 400 },
      );
    }
    if (!["ETH", "USDC", "SOL"].includes(paymentToken)) {
      return NextResponse.json(
        { error: "paymentToken must be ETH, USDC, or SOL" },
        { status: 400 }
      );
    }
    if (!VALID_DURATIONS.includes(durationDays)) {
      return NextResponse.json(
        { error: "durationDays must be one of: 1, 2, 7, 14, 30" },
        { status: 400 },
      );
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: "email must be a valid address" }, { status: 400 });
    }
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { chain: true },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    if (!paymentWalletsEqual(agent.owner, wallet)) {
      return NextResponse.json(
        { error: "Wallet does not own this agent" },
        { status: 403 },
      );
    }
    if (!agent.isVerified) {
      return NextResponse.json(
        {
          error: `Agent must be verified before promotion. Complete verification at /dashboard/agents/${agent.id}/verify`,
        },
        { status: 403 },
      );
    }
    const clientTestnet = body.clientTestnet === true;
    const result = await verifyPayment(
      paymentToken,
      txHash,
      slotType,
      wallet,
      durationDays,
      clientTestnet
    );
    if (email) await getJobProducer();
    const { promotion, orderNumber } = await prisma.$transaction(async (tx) => {
      await claimPaymentTransactionInTx(tx, result.transactionId, result.paymentToken);
      const locked = await tx.$queryRaw<Array<{
        id: number;
        owner: string;
        isVerified: boolean;
        name: string;
      }>>`
        SELECT "id", "owner", "isVerified", "name"
        FROM "Agent"
        WHERE "id" = ${agentId}
        FOR UPDATE
      `;
      const current = locked[0];
      if (!current) throw new PromotionStateConflictError("Agent no longer exists");
      if (!paymentWalletsEqual(current.owner, result.payerWallet)) {
        throw new PromotionOwnershipError("Agent ownership changed before payment was claimed");
      }
      if (!current.isVerified) {
        throw new PromotionStateConflictError("Agent is no longer verified; payment was not claimed");
      }
      const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1_000);
      const created = await tx.promotion.create({
        data: {
          agentId,
          slotType,
          durationDays,
          txHash: result.transactionId,
          paidAmount: result.paidAmount,
          currency: result.currency,
          paymentToken: result.paymentToken,
          wallet: result.payerWallet,
          expiresAt,
        },
        include: { agent: { include: { chain: true } } },
      });
      const generatedOrderNumber = generateOrderNumber(created.id);
      const updated = await tx.promotion.update({
        where: { id: created.id },
        data: { orderNumber: generatedOrderNumber },
        include: { agent: { include: { chain: true } } },
      });
      if (email) {
        await queueNotificationInTx(tx, {
          idempotencyKey: `promotion:${created.id}:confirmation`,
          kind: NOTIFICATION_KINDS.PROMO_CONFIRMATION,
          recipient: email,
          payload: {
            orderNumber: generatedOrderNumber,
            agentName: current.name,
            slotType,
            durationDays,
            paidAmount: result.paidAmount,
            currency: result.currency,
            expiresAt: expiresAt.toISOString(),
          },
        });
      }
      return { promotion: updated, orderNumber: generatedOrderNumber };
    });
    await invalidatePromotionPublicStatistics();
    return NextResponse.json({
      success: true,
      orderNumber,
      promotion: {
        id: promotion.id,
        orderNumber,
        agentId: promotion.agentId,
        slotType: promotion.slotType,
        durationDays: promotion.durationDays,
        expiresAt: promotion.expiresAt,
        agent: promotion.agent,
      },
    });
  } catch (err) {
    console.error("POST /api/promotions error:", err);
    const status = err instanceof PromotionOwnershipError
      ? 403
      : err instanceof PromotionStateConflictError
        ? 409
        : 500;
    return NextResponse.json(
      {
        error:
          Error.isError(err) ? err.message : "Failed to create promotion",
      },
      { status },
    );
  }
}
