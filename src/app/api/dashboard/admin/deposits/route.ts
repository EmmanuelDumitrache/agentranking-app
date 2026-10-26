import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status") || undefined;
  const limit = Math.min(
    Number.parseInt(searchParams.get("limit") || "50", 10) || 50,
    200,
  );
  try {
    const where = statusFilter
      ? { status: statusFilter as "CREATED" | "AWAITING_PAYMENT" | "CONFIRMING" | "SETTLED" | "UNDERPAID" | "OVERPAID" | "EXPIRED" | "FAILED" | "CANCELLED" }
      : {};
    const deposits = await prisma.llmCreditDeposit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        appAccountId: true,
        quotedCents: true,
        creditedCents: true,
        asset: true,
        network: true,
        status: true,
        signature: true,
        recipientPublicKey: true,
        paymentUrl: true,
        createdAt: true,
        settledAt: true,
        failureReason: true,
      },
    });
    return NextResponse.json(deposits);
  } catch (error) {
    console.error("GET /admin/deposits failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}