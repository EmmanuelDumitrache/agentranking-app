import { NextRequest, NextResponse } from "next/server";
import { formatUnits, isAddress, parseUnits } from "viem";
import { prisma } from "@/lib/db";
import { backgroundJobsPausedResponse, isBackgroundJobsPaused } from "@/lib/pause-background-jobs";
import { activateOrder } from "@/lib/order-service";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import {
  claimPaymentTransactionInTx,
  normalizePaymentTransactionId,
} from "@/lib/payment-verify";
import {
  isInternalBearerSecretConfigured,
  verifyInternalBearer,
} from "@/lib/internal-bearer-auth";
export const dynamic = "force-dynamic";
const SUPPORTED_ASSETS = new Set(["USDC_BASE", "USDC_ETH"]);
type ConfirmBody = {
  txHash?: unknown;
  from?: unknown;
  value?: unknown;
  asset?: unknown;
  orderId?: unknown;
};
function requiredString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximumLength ? trimmed : null;
}
async function activateOrderWithRetry(orderId: string, context: string): Promise<void> {
  try {
    await withTransientPoolRetry(() => activateOrder(orderId));
  } catch (error) {
    console.error(`[confirm-by-tx] activateOrder ${context} failed:`, error);
    throw error;
  }
}
export async function POST(request: NextRequest) {
  const watcherSecret = process.env.PAYMENT_WATCHER_SECRET?.trim() ?? "";
  if (!isInternalBearerSecretConfigured(watcherSecret)) {
    console.error("[confirm-by-tx] PAYMENT_WATCHER_SECRET is missing or too short");
    return NextResponse.json({ error: "Payment watcher is not configured" }, { status: 503 });
  }
  if (!verifyInternalBearer(request.headers.get("authorization"), watcherSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isBackgroundJobsPaused()) return backgroundJobsPausedResponse();
  try {
    let body: ConfirmBody;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
      }
      body = parsed as ConfirmBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const rawTxHash = requiredString(body.txHash, 100);
    const rawWallet = requiredString(body.from, 100);
    const rawValue = requiredString(body.value, 80);
    const asset = requiredString(body.asset, 32)?.toUpperCase() ?? null;
    const orderId = body.orderId == null ? null : requiredString(body.orderId, 100);
    if (!rawTxHash || !rawWallet || !rawValue || !asset) {
      return NextResponse.json({ error: "Missing or invalid required fields" }, { status: 400 });
    }
    if (!SUPPORTED_ASSETS.has(asset)) {
      return NextResponse.json({ error: "Unsupported payment asset" }, { status: 400 });
    }
    if (!isAddress(rawWallet)) {
      return NextResponse.json({ error: "Invalid payer wallet" }, { status: 400 });
    }
    const transactionId = normalizePaymentTransactionId("USDC", rawTxHash);
    const wallet = rawWallet.toLowerCase();
    let paidAtomic: bigint;
    try {
      paidAtomic = parseUnits(rawValue, 6);
    } catch {
      return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
    }
    if (paidAtomic <= 0n) {
      return NextResponse.json({ error: "Payment amount must be positive" }, { status: 400 });
    }
    const existingOrder = await prisma.order.findFirst({
      where: { txHash: { equals: transactionId, mode: "insensitive" } },
    });
    if (existingOrder) {
      if (existingOrder.status !== "paid") {
        await activateOrderWithRetry(existingOrder.id, "for existing transaction");
      }
      return NextResponse.json({
        message: "Already processed",
        orderId: existingOrder.id,
        orderNumber: existingOrder.orderNumber,
      });
    }
    const pendingWhere = {
      wallet: { equals: wallet, mode: "insensitive" as const },
      paymentAsset: asset,
      status: "pending",
      expiresAt: { gt: new Date() },
    };
    let order = orderId
      ? await prisma.order.findFirst({ where: { id: orderId, ...pendingWhere } })
      : null;
    if (!order) {
      order = await prisma.order.findFirst({
        where: pendingWhere,
        orderBy: { createdAt: "asc" },
      });
    }
    if (!order) {
      return NextResponse.json(
        { error: "No matching unexpired pending order was found" },
        { status: 404 },
      );
    }
    let expectedAtomic: bigint;
    try {
      expectedAtomic = parseUnits(order.cryptoAmount, 6);
    } catch {
      throw new Error(`Order ${order.id} has an invalid crypto amount`);
    }
    if (paidAtomic < expectedAtomic) {
      return NextResponse.json(
        {
          error: `Insufficient payment: expected at least ${order.cryptoAmount} ${asset}, got ${formatUnits(paidAtomic, 6)}`,
        },
        { status: 400 },
      );
    }
    let claimedOrder;
    try {
      claimedOrder = await prisma.$transaction(async (tx) => {
        await claimPaymentTransactionInTx(tx, transactionId, "USDC");
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order!.id} FOR UPDATE`;
        const fresh = await tx.order.findUnique({ where: { id: order!.id } });
        if (!fresh) throw new Error("Order disappeared during payment confirmation");
        if (fresh.txHash) {
          if (fresh.txHash.toLowerCase() === transactionId) return fresh;
          throw new Error("Order already has a different payment transaction");
        }
        if (
          fresh.status !== "pending" ||
          fresh.expiresAt <= new Date() ||
          fresh.paymentAsset !== asset ||
          fresh.wallet.toLowerCase() !== wallet
        ) {
          throw new Error("Order is no longer eligible for payment confirmation");
        }
        return tx.order.update({
          where: { id: fresh.id },
          data: { txHash: transactionId },
        });
      });
    } catch (error) {
      const byTransaction = await prisma.order.findFirst({
        where: { txHash: { equals: transactionId, mode: "insensitive" } },
      });
      if (byTransaction) {
        if (byTransaction.status !== "paid") {
          await activateOrderWithRetry(byTransaction.id, "after concurrent claim");
        }
        return NextResponse.json({
          message: "Already processed",
          orderId: byTransaction.id,
          orderNumber: byTransaction.orderNumber,
        });
      }
      throw error;
    }
    await activateOrderWithRetry(claimedOrder.id, "after payment claim");
    return NextResponse.json({
      message: "Order activated",
      orderId: claimedOrder.id,
      orderNumber: claimedOrder.orderNumber,
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.error("[internal/orders/confirm-by-tx] Error:", error);
    return NextResponse.json(
      {
        error: process.env.NODE_ENV === "development"
          ? `Payment confirmation failed: ${message}`
          : "Unable to confirm payment. Try again shortly or contact support with the transaction hash.",
      },
      { status: 500 },
    );
  }
}
