import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
type Props = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, { params }: Props) {
  try {
    const { id } = await params;
    const bounty = await prisma.bounty.findUnique({
      where: { id },
      include: {
        claimedAgent: {
          select: { id: true, name: true, isVerified: true, isPremiumVerified: true, chainId: true, agentId: true },
        },
        disputes: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!bounty) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(bounty, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (err) {
    console.error("[GET /api/bounties/[id]]", err);
    return NextResponse.json({ error: "Failed to fetch bounty" }, { status: 500 });
  }
}