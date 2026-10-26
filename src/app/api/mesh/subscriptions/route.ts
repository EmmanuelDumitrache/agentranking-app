import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const profile = await ensureMinimalUserProfile(session);
    if (!profile) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const agentId = Number.parseInt(req.nextUrl.searchParams.get("agentId") ?? "", 10);
    if (!Number.isSafeInteger(agentId) || agentId <= 0) {
      return NextResponse.json({ error: "agentId required" }, { status: 422 });
    }
    const owned = await dashboardUserOwnsAgentDbId(
      profile.walletAddress ?? profile.solanaWallet,
      agentId,
      profile.id,
    );
    if (!owned) {
      return NextResponse.json({ error: "agentId is not an agent you operate" }, { status: 403 });
    }
    const subscriptions = await prisma.meshSubscription.findMany({
      where: { subscriberAgentId: agentId, isActive: true },
      include: {
        publisherAgent: {
          select: { id: true, name: true, isVerified: true, isPremiumVerified: true, chainId: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 251,
    });
    const truncated = subscriptions.length > 250;
    return NextResponse.json(
      { subscriptions: subscriptions.slice(0, 250), truncated },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (err) {
    console.error("[GET /api/mesh/subscriptions]", err);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }
}
