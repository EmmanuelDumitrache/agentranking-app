import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allowClientTestnetFromServer } from "@/lib/env-deploy";
import { claimPaymentTransactionInTx, verifyPayment, isTestMode, multiplyPaymentAmount } from "@/lib/payment-verify";
import { generateOrderNumber } from "@/lib/order-number";
import { getJobProducer } from "@/jobs/boss";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MIN_DAYS = 3;
const MAX_DAYS = 30;
const AD_PER_DAY: Record<string, string> = {
  ETH: "0.015",
  USDC: "30",
  SOL: "0.23",
};
const AD_PER_DAY_TEST: Record<string, string> = {
  ETH: "0.000015",
  USDC: "0.03",
  SOL: "0.00023",
};

const AdOrderRequestSchema = z.strictObject({
  bannerUrl: z.string().trim().min(1),
  linkUrl: z.string().trim().optional(),
  days: z.number().int().min(MIN_DAYS).max(MAX_DAYS),
  txHash: z.string().trim().min(1),
  wallet: z.string().trim().min(1),
  paymentToken: z.enum(["ETH", "USDC", "SOL"]).default("ETH"),
  email: z.string().trim().email().optional(),
  clientTestnet: z.boolean().optional(),
});

function calcExpectedAmount(currency: string, days: number, testMode: boolean): string {
  const token = currency as "ETH" | "USDC" | "SOL";
  const rate = (testMode ? AD_PER_DAY_TEST : AD_PER_DAY)[token];
  if (!rate) throw new Error(`No ad rate configured for ${token}`);
  return multiplyPaymentAmount(rate, days, token);
}
/**
 * POST /api/ads/order
 * Body: { bannerUrl, linkUrl?, days, txHash, wallet, paymentToken, email?, clientTestnet? }
 * Verifies on-chain payment and creates AdOrder.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await parseBoundedJsonBody(request, AdOrderRequestSchema, 64 * 1024);
    const bannerUrl = body.bannerUrl;
    const linkUrl = body.linkUrl ?? "";
    const days = body.days;
    const txHash = body.txHash;
    const wallet = body.wallet;
    const paymentToken = body.paymentToken;
    const email = body.email;
    const clientTestnet = body.clientTestnet === true;
    const testMode = isTestMode() || (clientTestnet && allowClientTestnetFromServer());
    const expectedAmount = calcExpectedAmount(paymentToken, days, testMode);
    const result = await verifyPayment(
      paymentToken,
      txHash,
      "banner_ad",
      wallet,
      days,
      clientTestnet,
      expectedAmount,
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    if (email) await getJobProducer();
    const { orderNumber } = await prisma.$transaction(async (tx) => {
      await claimPaymentTransactionInTx(tx, result.transactionId, result.paymentToken);
      const created = await tx.adOrder.create({
        data: {
          bannerUrl,
          linkUrl,
          days,
          txHash: result.transactionId,
          paidAmount: result.paidAmount,
          currency: result.currency,
          paymentToken: result.paymentToken,
          wallet: result.payerWallet,
          status: "pending",
          expiresAt,
        },
      });
      const generatedOrderNumber = generateOrderNumber(created.id, "A");
      await tx.adOrder.update({
        where: { id: created.id },
        data: { orderNumber: generatedOrderNumber },
      });
      if (email) {
        await queueNotificationInTx(tx, {
          idempotencyKey: `ad-order:${created.id}:confirmation`,
          kind: NOTIFICATION_KINDS.AD_ORDER_CONFIRMATION,
          recipient: email,
          payload: {
            orderNumber: generatedOrderNumber,
            bannerUrl,
            linkUrl,
            days,
            paidAmount: result.paidAmount,
            currency: result.currency,
            expiresAt: expiresAt.toISOString(),
          },
        });
      }
      return { orderNumber: generatedOrderNumber };
    });
    return NextResponse.json({
      success: true,
      orderNumber,
      message: "Ad order submitted. It will go live after review (usually within 24h).",
      expiresAt,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid ad order request" },
        { status: 400 },
      );
    }
    if (err instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    if (err instanceof InvalidJsonBodyError || err instanceof InvalidHttpBodyEncodingError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    console.error("POST /api/ads/order error:", err);
    return NextResponse.json(
      { error: Error.isError(err) ? err.message : "Failed to submit ad order" },
      { status: 500 },
    );
  }
}
/** GET /api/ads/order: returns currently active ad orders. */
export async function GET() {
  try {
    const orders = await prisma.adOrder.findMany({
      where: { status: "active", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "asc" },
      select: { id: true, bannerUrl: true, linkUrl: true, expiresAt: true },
    });
    return NextResponse.json({ orders });
  } catch (err) {
    console.error("GET /api/ads/order error:", err);
    return NextResponse.json({ error: "Failed to fetch ad orders" }, { status: 500 });
  }
}
