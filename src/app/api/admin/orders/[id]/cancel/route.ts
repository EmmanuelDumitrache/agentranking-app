import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status === "paid") {
      return NextResponse.json({ error: "Cannot cancel a paid order" }, { status: 400 });
    }
    await prisma.order.update({ where: { id }, data: { status: "cancelled" } });
    return NextResponse.json({ message: "Order cancelled", orderId: id });
  } catch (err) {
    console.error("[admin/orders/cancel] Error:", err);
    return NextResponse.json({ error: "Failed to cancel order" }, { status: 500 });
  }
}