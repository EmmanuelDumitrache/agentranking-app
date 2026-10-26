import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { claimPaymentTransactionInTx, paymentWalletsEqual, verifyPayment } from "@/lib/payment-verify";
import { generateOrderNumber } from "@/lib/order-number";
import { getJobProducer } from "@/jobs/boss";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
class PremiumVerificationConflictError extends Error {}
class PremiumVerificationOwnershipError extends Error {}
/**
 * POST /api/premium-verify
 * Upgrades an already-verified agent to premium verified status after payment.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const agentId = Number(body.agentId);
    const paymentToken = ((body.paymentToken as string) || "ETH").toUpperCase();
    const txHash = (body.txHash as string)?.trim();
    const wallet = (body.wallet as string)?.trim();
    const email = (body.email as string | undefined)?.trim();
    const clientTestnet = body.clientTestnet === true;
    if (!agentId || !txHash || !wallet) {
      return NextResponse.json(
        { error: "Missing required fields: agentId, txHash, wallet" },
        { status: 400 },
      );
    }
    if (!["ETH", "USDC", "SOL"].includes(paymentToken)) {
      return NextResponse.json(
        { error: "paymentToken must be ETH, USDC, or SOL" },
        { status: 400 },
      );
    }
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { chain: true },
    });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if (!paymentWalletsEqual(agent.owner, wallet)) {
      return NextResponse.json({ error: "Wallet does not own this agent" }, { status: 403 });
    }
    if (agent.isPremiumVerified) {
      return NextResponse.json({ error: "Agent already has premium verification" }, { status: 400 });
    }
    const result = await verifyPayment(
      paymentToken,
      txHash,
      "premium_verify",
      wallet,
      7,
      clientTestnet,
    );
    if (email) await getJobProducer();
    const { updatedAgent, orderNumber } = await prisma.$transaction(async (tx) => {
      await claimPaymentTransactionInTx(tx, result.transactionId, result.paymentToken);
      const current = await tx.agent.findUnique({
        where: { id: agentId },
        select: { id: true, owner: true, name: true, isPremiumVerified: true },
      });
      if (!current) throw new PremiumVerificationConflictError("Agent no longer exists");
      if (!paymentWalletsEqual(current.owner, result.payerWallet)) {
        throw new PremiumVerificationOwnershipError("Agent ownership changed before payment was claimed");
      }
      if (current.isPremiumVerified) {
        throw new PremiumVerificationConflictError("Agent already has premium verification");
      }
      const upgraded = await tx.agent.updateMany({
        where: { id: agentId, owner: current.owner, isPremiumVerified: false },
        data: { isPremiumVerified: true, isVerified: true },
      });
      if (upgraded.count !== 1) {
        throw new PremiumVerificationConflictError("Agent verification state changed; payment was not claimed");
      }
      const updated = await tx.agent.findUnique({
        where: { id: agentId },
        include: { chain: true },
      });
      if (!updated) throw new PremiumVerificationConflictError("Agent no longer exists");
      const promotion = await tx.promotion.create({
        data: {
          agentId,
          slotType: "premium_verify",
          durationDays: 0,
          txHash: result.transactionId,
          paidAmount: result.paidAmount,
          currency: result.currency,
          paymentToken: result.paymentToken,
          wallet: result.payerWallet,
          expiresAt: new Date("2099-12-31"),
        },
      });
      const generatedOrderNumber = generateOrderNumber(promotion.id);
      await tx.promotion.update({
        where: { id: promotion.id },
        data: { orderNumber: generatedOrderNumber },
      });
      if (email) {
        await queueNotificationInTx(tx, {
          idempotencyKey: `promotion:${promotion.id}:kya-confirmation`,
          kind: NOTIFICATION_KINDS.KYA_CONFIRMATION,
          recipient: email,
          payload: {
            orderNumber: generatedOrderNumber,
            agentName: current.name,
            paidAmount: result.paidAmount,
            currency: result.currency,
          },
        });
      }
      return { updatedAgent: updated, orderNumber: generatedOrderNumber };
    });
    await invalidateAllPublicStatistics();
    return NextResponse.json({
      success: true,
      orderNumber,
      agent: {
        id: updatedAgent.id,
        agentId: updatedAgent.agentId,
        chainId: updatedAgent.chainId,
        name: updatedAgent.name,
        isPremiumVerified: updatedAgent.isPremiumVerified,
      },
    });
  } catch (err) {
    console.error("POST /api/premium-verify error:", err);
    const status = err instanceof PremiumVerificationOwnershipError
      ? 403
      : err instanceof PremiumVerificationConflictError
        ? 409
        : 500;
    return NextResponse.json(
      { error: Error.isError(err) ? err.message : "Failed to upgrade verification" },
      { status },
    );
  }
}
