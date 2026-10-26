import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { activateOrder } from "@/lib/order-service";
export const dynamic = "force-dynamic";
/**
 * POST /api/admin/orders/[id]/mark-paid
 * Admin manually marks an order as paid and activates the benefit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.status === "paid") {
      return NextResponse.json({ message: "Order already paid", orderId: id });
    }
    if (order.status === "cancelled") {
      return NextResponse.json({ error: "Cannot mark a cancelled order as paid" }, { status: 400 });
    }
    // Record a manual txHash so activateOrder can proceed
    if (!order.txHash) {
      await prisma.order.update({
        where: { id },
        data: { txHash: `manual-admin-${id}` },
      });
    }
    await activateOrder(id);
    return NextResponse.json({ message: "Order marked as paid", orderId: id });
  } catch (err) {
    console.error("[admin/orders/mark-paid] Error:", err);
    return NextResponse.json({ error: "Failed to mark order as paid" }, { status: 500 });
  }
}