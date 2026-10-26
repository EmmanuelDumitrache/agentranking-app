import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireDashboardAccessForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
import { computeTrustScore, trustSignalsFromMetadataAndAgent } from "@/lib/trust-score";
export const dynamic = "force-dynamic";
export async function GET(_request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardAccessForApi(session);
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  const resolved = await ensureMinimalUserProfile(session);
  if (!resolved) return NextResponse.json({ error: "Profile not found" }, { status: 400 });
  const { agentId } = await params;
  const agentDbId = Number.parseInt(agentId, 10);
  if (!Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
  }
  const profile = await prisma.userProfile.findUnique({
    where: { id: resolved.id },
    select: { walletAddress: true, solanaWallet: true },
  });
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      name: true,
      owner: true,
      score: true,
      rank: true,
      totalFeedback: true,
      stars: true,
      totalMessages: true,
      totalChats: true,
      totalWatches: true,
      isVerified: true,
      isPremiumVerified: true,
      createdAt: true,
      metadata: { select: { key: true, value: true } },
    },
  });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const wallet = profile?.walletAddress?.trim() || profile?.solanaWallet?.trim() || null;
  const owned = await dashboardUserOwnsAgentDbId(wallet, agentDbId, resolved.id);
  if (!owned) {
    return NextResponse.json({ error: "Not authorized for this agent" }, { status: 403 });
  }
  // Analytics events — last 30 days
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [analyticsEvents, rankSnapshots, feedbacks] = await Promise.all([
    prisma.agentAnalyticsEvent.findMany({
      where: { agentId: agentDbId, createdAt: { gte: since30d } },
      select: { eventType: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.agentRankSnapshot.findMany({
      where: { agentId: agentDbId },
      select: { rank: true, score: true, agentRankScore: true, capturedAt: true },
      orderBy: { capturedAt: "desc" },
      take: 30,
    }),
    prisma.feedback.findMany({
      where: {
        agentId: agentDbId,
        feedbackIndex: null,
        sourceRegistry: null,
        revoked: false,
        value: { gte: 1, lte: 5 },
      },
      select: { value: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  // Aggregate analytics by day
  const dayMap: Record<string, { views: number; clicks: number }> = {};
  for (const ev of analyticsEvents) {
    const day = ev.createdAt.toISOString().slice(0, 10);
    if (!dayMap[day]) dayMap[day] = { views: 0, clicks: 0 };
    if (ev.eventType === "view") dayMap[day].views++;
    else dayMap[day].clicks++;
  }
  const dailyAnalytics = Object.entries(dayMap)
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalViews = analyticsEvents.filter((e) => e.eventType === "view").length;
  const totalClicks = analyticsEvents.filter((e) => e.eventType !== "view").length;
  // Feedback stats
  const avgRating =
    feedbacks.length > 0
      ? feedbacks.reduce((s, f) => s + (f.value ?? 0), 0) / feedbacks.length
      : null;
  // Trust score
  const signals = trustSignalsFromMetadataAndAgent(agent);
  const protocolTrustScore = computeTrustScore(signals);
  return NextResponse.json({
    agentId: agentDbId,
    name: agent.name,
    score: agent.score,
    rank: agent.rank,
    protocolTrustScore,
    totalFeedback: agent.totalFeedback,
    stars: agent.stars,
    totalMessages: agent.totalMessages,
    totalChats: agent.totalChats,
    totalWatches: agent.totalWatches,
    avgRating,
    totalViews,
    totalClicks,
    dailyAnalytics,
    rankHistory: rankSnapshots.reverse().map((s) => ({
      rank: s.rank,
      score: s.score,
      agentRankScore: s.agentRankScore,
      date: s.capturedAt.toISOString().slice(0, 10),
    })),
  });
}
