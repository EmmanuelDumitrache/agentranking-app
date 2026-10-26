import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        agentBoost: { select: { id: true } },
        adPackage: { select: { id: true } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json({
      status: order.status,
      orderNumber: order.orderNumber,
      productType: order.productType,
      tier: order.tier,
      usdPrice: order.usdPrice,
      cryptoAmount: order.cryptoAmount,
      paymentAsset: order.paymentAsset,
      expiresAt: order.expiresAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      agentBoostId: order.agentBoost?.id ?? null,
      adPackageId: order.adPackage?.id ?? null,
      agentId: order.agentId,
      txHash: order.txHash,
    });
  } catch (err) {
    console.error("[orders/status] Error:", err);
    return NextResponse.json({ error: "Failed to fetch order" }, { status: 500 });
  }
}