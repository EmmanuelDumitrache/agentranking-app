import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  VERIFIED_REVENUE_TIERS,
  getVerifiedRevenueTier,
  getTierPriceOrTest,
  getPaymentChainId,
  getUsdcContract,
  usdToUsdc,
  isPaymentTestMode,
} from "@/lib/product-config";
import { allocateOrderNumber } from "@/lib/order-number";
import { getJobProducer } from "@/jobs/boss";
import { enqueueApplicationJobInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
const TREASURY = process.env.TREASURY_ADDRESS_BASE ?? "";
/**
 * POST /api/verified-revenue/order
 * Creates a pending Verified Revenue subscription order.
 * Body: { agentId: number, tier: "Monthly"|"Annual", wallet: string, email?: string, paymentAsset?: string }
 *
 * On payment confirmation (via /api/internal/orders/confirm-by-tx), the order
 * handler sets Agent.isVerifiedRevenue = true and Agent.verifiedRevenueAt.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      agentId?: number;
      tier?: string;
      wallet?: string;
      email?: string;
      paymentAsset?: string;
    };
    const agentId = Number(body.agentId);
    const tier = (body.tier as string)?.trim();
    const wallet = (body.wallet as string)?.trim().toLowerCase();
    const email = (body.email as string | undefined)?.trim() ?? "";
    const paymentAsset = (body.paymentAsset as string | undefined) ?? "USDC_BASE";
    if (!agentId || !tier || !wallet) {
      return NextResponse.json(
        { error: "Missing required fields: agentId, tier, wallet" },
        { status: 400 }
      );
    }
    if (!["USDC_BASE", "USDC_ETH"].includes(paymentAsset)) {
      return NextResponse.json({ error: "Invalid paymentAsset" }, { status: 400 });
    }
    const tierDef = getVerifiedRevenueTier(tier);
    if (!tierDef) {
      const valid = VERIFIED_REVENUE_TIERS.map((t) => t.label).join(", ");
      return NextResponse.json({ error: `Unknown tier. Valid: ${valid}` }, { status: 400 });
    }
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, owner: true, name: true, verifiedWallet: true },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    if (agent.owner.toLowerCase() !== wallet) {
      return NextResponse.json({ error: "Wallet does not own this agent" }, { status: 403 });
    }
    if (!agent.verifiedWallet) {
      return NextResponse.json(
        { error: "Agent has no linked execution wallet. Complete wallet linking first." },
        { status: 400 }
      );
    }
    const usdPrice = getTierPriceOrTest("verified_revenue", tier)!;
    const cryptoAmount = usdToUsdc(usdPrice);
    const chainId = getPaymentChainId(paymentAsset as "USDC_BASE" | "USDC_ETH");
    const expiresMinutes = isPaymentTestMode() ? 15 : 5;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);
    await getJobProducer();
    const order = await prisma.$transaction(async (tx) => {
      const orderNumber = await allocateOrderNumber(tx, "VR");
      const created = await tx.order.create({
        data: {
          orderNumber,
          productType: "verified_revenue",
          tier,
          usdPrice,
          paymentAsset,
          chainId,
          cryptoAmount,
          wallet,
          email,
          agentId,
          expiresAt,
        },
      });
      await enqueueApplicationJobInTx(tx, JOB_QUEUES.ORDER_EXPIRE, { v: 1, id: created.id }, {
        startAfter: created.expiresAt,
        singletonKey: created.id,
      });
      if (email) {
        await queueNotificationInTx(tx, {
          idempotencyKey: `order:${created.id}:created`,
          kind: NOTIFICATION_KINDS.ORDER_CREATED,
          recipient: email,
          payload: { orderId: created.id },
        });
      }
      return created;
    });
    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      usdPrice,
      cryptoAmount,
      paymentAsset,
      chainId,
      treasuryAddress: TREASURY,
      usdcContractAddress: getUsdcContract(paymentAsset as "USDC_BASE" | "USDC_ETH"),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("POST /api/verified-revenue/order error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
