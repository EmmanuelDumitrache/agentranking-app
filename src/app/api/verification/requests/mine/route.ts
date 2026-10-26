import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ensureMinimalUserProfile,
  hasDashboardIdentity,
} from "@/lib/dashboard/session-profile";
export const dynamic = "force-dynamic";
/** GET /api/verification/requests/mine */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ requests: [] });
  }
  const wallet = profile.walletAddress?.trim().toLowerCase() ?? "";
  const requests = await prisma.agentVerificationRequest.findMany({
    where: wallet
      ? { OR: [{ userProfileId: profile.id }, { walletAddress: wallet }] }
      : { userProfileId: profile.id },
    orderBy: { submittedAt: "desc" },
    take: 50,
    select: {
      id: true,
      agentId: true,
      agentName: true,
      xHandle: true,
      verificationStatus: true,
      paymentStatus: true,
      submittedAt: true,
      reviewedAt: true,
      reviewerNote: true,
      agent: {
        select: {
          agentId: true,
          chainId: true,
          publicVerificationStatus: true,
          isPremiumVerified: true,
        },
      },
    },
  });
  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id,
      agentDbId: r.agentId,
      agentName: r.agentName,
      xHandle: r.xHandle,
      verificationStatus: r.verificationStatus,
      paymentStatus: r.paymentStatus,
      submittedAt: r.submittedAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewerNote: r.reviewerNote,
      publicVerificationStatus: r.agent.publicVerificationStatus,
      isPremiumVerified: r.agent.isPremiumVerified,
      chainId: r.agent.chainId,
      onChainAgentId: r.agent.agentId,
    })),
  });
}
