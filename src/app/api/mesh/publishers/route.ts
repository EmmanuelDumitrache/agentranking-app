import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { mapWithConcurrency } from "@/lib/async-pool";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
const PUBLISHER_LIMIT = 30;
const SIGNALS_PER_PUBLISHER = 3;
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const subscriberAgentIdRaw = searchParams.get("subscriberAgentId");
    const subscriberAgentId = subscriberAgentIdRaw ? Number.parseInt(subscriberAgentIdRaw, 10) : 0;
    if (subscriberAgentIdRaw && (!Number.isSafeInteger(subscriberAgentId) || subscriberAgentId <= 0)) {
      return NextResponse.json({ error: "subscriberAgentId must be a positive integer" }, { status: 422 });
    }
    let subscriptionRows: { publisherAgentId: number; id: string }[] = [];
    if (subscriberAgentId > 0) {
      const session = await getServerSession(authOptions);
      const profile = await ensureMinimalUserProfile(session);
      if (!profile) {
        return NextResponse.json({ error: "Authentication required when subscriberAgentId is set" }, { status: 401 });
      }
      const owned = await dashboardUserOwnsAgentDbId(
        profile.walletAddress ?? profile.solanaWallet,
        subscriberAgentId,
        profile.id,
      );
      if (!owned) {
        return NextResponse.json({ error: "subscriberAgentId is not an agent you operate" }, { status: 403 });
      }
      subscriptionRows = await prisma.meshSubscription.findMany({
        where: { subscriberAgentId, isActive: true, publisherAgentId: { not: subscriberAgentId } },
        select: { publisherAgentId: true, id: true },
      });
    }
    const subByPublisher = new Map<number, string>();
    for (const row of subscriptionRows) {
      subByPublisher.set(row.publisherAgentId, row.id);
    }
    const agents = await prisma.agent.findMany({
      where: {
        isActive: true,
        OR: [{ isVerified: true }, { isPremiumVerified: true }],
      },
      orderBy: [{ score: "desc" }, { totalFeedback: "desc" }],
      take: PUBLISHER_LIMIT,
      select: {
        id: true,
        name: true,
        isVerified: true,
        isPremiumVerified: true,
        chainId: true,
      },
    });
    if (agents.length === 0) {
      return NextResponse.json({ publishers: [] });
    }
    const ids = agents.map((a) => a.id);
    const countGroups = await prisma.meshSubscription.groupBy({
      by: ["publisherAgentId"],
      where: { publisherAgentId: { in: ids }, isActive: true },
      _count: { _all: true },
    });
    const subscriberCountByPublisher = new Map<number, number>();
    for (const g of countGroups) {
      subscriberCountByPublisher.set(g.publisherAgentId, g._count._all);
    }
    const signalLists = await mapWithConcurrency(
      ids,
      8,
      (publisherAgentId) =>
        prisma.meshSignal.findMany({
          where: { publisherAgentId },
          orderBy: { timestamp: "desc" },
          take: SIGNALS_PER_PUBLISHER,
          select: {
            id: true,
            publisherAgentId: true,
            signalType: true,
            payload: true,
            timestamp: true,
          },
        }),
    );
    const signalsByPublisher = new Map<number, (typeof signalLists)[number]>();
    ids.forEach((id, i) => {
      signalsByPublisher.set(id, signalLists[i] ?? []);
    });
    const publishers = agents.map((agent) => {
      const recent = signalsByPublisher.get(agent.id) ?? [];
      const signalTypes = [...new Set(recent.map((s) => s.signalType).filter(Boolean))];
      const subId = subByPublisher.get(agent.id);
      return {
        agent,
        subscriberCount: subscriberCountByPublisher.get(agent.id) ?? 0,
        lastSignalAt: recent[0]?.timestamp?.toISOString() ?? null,
        recentSignals: recent.map((s) => ({
          id: s.id,
          signalType: s.signalType,
          payload: s.payload as Record<string, unknown>,
          timestamp: s.timestamp.toISOString(),
        })),
        signalTypes,
        isSubscribed: Boolean(subId),
        subscriptionId: subId ?? null,
      };
    });
    return NextResponse.json(
      { publishers },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (err) {
    console.error("[GET /api/mesh/publishers]", err);
    return NextResponse.json({ error: "Failed to load publishers" }, { status: 500 });
  }
}
