import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireDashboardAccessForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
import { trustSignalsFromMetadataAndAgent, computeTrustScore } from "@/lib/trust-score";
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
  // Verify agent is owned by this user's wallet
  const profile = await prisma.userProfile.findUnique({
    where: { id: resolved.id },
    select: { walletAddress: true, solanaWallet: true },
  });
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      name: true,
      isVerified: true,
      isPremiumVerified: true,
      stars: true,
      totalFeedback: true,
      createdAt: true,
      score: true,
      owner: true,
      metadata: { select: { key: true, value: true } },
    },
  });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const wallet = profile?.walletAddress?.trim() || profile?.solanaWallet?.trim() || null;
  const owned = await dashboardUserOwnsAgentDbId(wallet, agentDbId, resolved.id);
  if (!owned) {
    return NextResponse.json({ error: "Not authorized for this agent" }, { status: 403 });
  }
  const signals = trustSignalsFromMetadataAndAgent(agent);
  const score = computeTrustScore(signals);
  const breakdown = [
    {
      key: "isPremiumVerified",
      label: "KYA Premium Verified",
      description: "Identity verified by AgentRanking",
      earned: signals.isPremiumVerified,
      points: 40,
      earnedPoints: signals.isPremiumVerified ? 40 : signals.isVerified ? 20 : 0,
      tip: "Complete the KYA verification process",
    },
    {
      key: "isVerified",
      label: "On-chain Verified",
      description: "Registered on the identity registry",
      earned: signals.isVerified,
      points: 20,
      earnedPoints: signals.isVerified && !signals.isPremiumVerified ? 20 : 0,
      tip: "Register your agent on the identity registry",
    },
    {
      key: "supportsERC8211",
      label: "ERC-8211 Support",
      description: "Implements the execution standard",
      earned: signals.supportsERC8211,
      points: 15,
      earnedPoints: signals.supportsERC8211 ? 15 : 0,
      tip: "Add supportsERC8211=true to your agent metadata",
    },
    {
      key: "hasTwitter",
      label: "Twitter / X Presence",
      description: "Linked social account",
      earned: signals.hasTwitter,
      points: 10,
      earnedPoints: signals.hasTwitter ? 10 : 0,
      tip: "Add your Twitter/X URL to agent metadata",
    },
    {
      key: "twitterFollowers1k",
      label: "1,000+ Followers",
      description: "Social reach milestone",
      earned: signals.twitterFollowers >= 1000,
      points: 5,
      earnedPoints: signals.twitterFollowers >= 1000 ? 5 : 0,
      tip: "Grow your Twitter following to 1,000+",
    },
    {
      key: "twitterFollowers10k",
      label: "10,000+ Followers",
      description: "High social reach",
      earned: signals.twitterFollowers >= 10_000,
      points: 5,
      earnedPoints: signals.twitterFollowers >= 10_000 ? 5 : 0,
      tip: "Grow your Twitter following to 10,000+",
    },
    {
      key: "hasGithub",
      label: "GitHub Repository",
      description: "Open source or verifiable code",
      earned: signals.hasGithub,
      points: 5,
      earnedPoints: signals.hasGithub ? 5 : 0,
      tip: "Add your GitHub URL to agent metadata",
    },
    {
      key: "hasWebsite",
      label: "Website",
      description: "Public web presence",
      earned: signals.hasWebsite,
      points: 5,
      earnedPoints: signals.hasWebsite ? 5 : 0,
      tip: "Add your website URL to agent metadata",
    },
    {
      key: "feedback",
      label: "Community Feedback",
      description: `${signals.totalFeedback} reviews`,
      earned: signals.totalFeedback > 0,
      points: 10,
      earnedPoints: Math.min(Math.round(signals.totalFeedback * 0.5), 10),
      tip: "Encourage users to leave feedback on your agent listing",
    },
    {
      key: "age",
      label: "Agent Age",
      description: `${Math.round(signals.ageDays)} days old`,
      earned: signals.ageDays > 0,
      points: 5,
      earnedPoints: Math.min(Math.round(signals.ageDays / 30), 5),
      tip: "Trust score increases as your agent matures",
    },
  ];
  return NextResponse.json({
    agentId: agentDbId,
    name: agent.name,
    score,
    signals,
    breakdown,
  });
}
