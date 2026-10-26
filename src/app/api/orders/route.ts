import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export type OrderType = "promotion" | "ad";
export interface UnifiedOrder {
  id: number;
  orderNumber: string | null;
  type: OrderType;
  /** Human-readable: Hot, Featured, KYA, Banner Ad */
  orderLabel: string;
  /** What was ordered (agent name for promotions, "Banner Ad" for ads) */
  itemName: string;
  paidAmount: string;
  currency: string;
  expiresAt: Date;
  createdAt: Date;
  /** Agent ID for promotions (null for ads) */
  agentId?: number;
  chainId?: number;
  /** Ad-specific */
  days?: number;
  status?: string;
}
function slotTypeToLabel(slotType: string): string {
  switch (slotType) {
    case "hot":
      return "Hot";
    case "featured":
      return "Featured";
    case "premium_verify":
      return "KYA";
    case "custom_listing":
      return "Custom Listing";
    default:
      return slotType;
  }
}
/**
 * GET /api/orders?wallet=0x...
 * Returns all orders (promotions + ad orders) for the given wallet, sorted by createdAt desc.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet")?.toLowerCase();
    if (!wallet) {
      return NextResponse.json(
        { error: "Missing wallet parameter" },
        { status: 400 }
      );
    }
    const [promotions, adOrders] = await Promise.all([
      prisma.promotion.findMany({
        where: { wallet },
        include: { agent: { select: { name: true, chainId: true, agentId: true } } },
        orderBy: { createdAt: "desc" },
        take: 251,
      }),
      prisma.adOrder.findMany({
        where: { wallet },
        orderBy: { createdAt: "desc" },
        take: 251,
      }),
    ]);
    const orders: UnifiedOrder[] = [
      ...promotions.map((p) => ({
        id: p.id,
        orderNumber: p.orderNumber,
        type: "promotion" as const,
        orderLabel: slotTypeToLabel(p.slotType),
        itemName: p.agent?.name ?? "Agent",
        paidAmount: p.paidAmount,
        currency: p.currency,
        expiresAt: p.expiresAt,
        createdAt: p.createdAt,
        agentId: p.agent?.agentId,
        chainId: p.agent?.chainId,
      })),
      ...adOrders.map((a) => ({
        id: a.id,
        orderNumber: a.orderNumber,
        type: "ad" as const,
        orderLabel: "Banner Ad",
        itemName: "Banner Ad",
        paidAmount: a.paidAmount,
        currency: a.currency,
        expiresAt: a.expiresAt,
        createdAt: a.createdAt,
        days: a.days,
        status: a.status,
      })),
    ];
    // Sort by createdAt desc
    orders.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const truncated = promotions.length > 250 || adOrders.length > 250 || orders.length > 250;
    return NextResponse.json({ orders: orders.slice(0, 250), truncated });
  } catch (err) {
    console.error("GET /api/orders error:", err);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}
