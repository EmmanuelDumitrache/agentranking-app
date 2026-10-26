import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { getSession } from "@/lib/admin-auth";
import { revalidateAgentPublicCache } from "@/lib/revalidate-agent-public-cache";
import { buildAgentVerifiedFeedEvent } from "@/lib/public-site/ar-live-feed-builders.server";
import { publishArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-publish.server";
export const dynamic = "force-dynamic";
type RouteParams = { params: Promise<{ id: string }> };
function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
/** PATCH /api/admin/verification-requests/[id] */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json()) as {
    action?: string;
    reviewerNote?: string;
    paymentStatus?: string;
  };
  const action = clean(body.action, 40);
  const reviewerNote = clean(body.reviewerNote, 2000);
  const paymentStatus = clean(body.paymentStatus, 20);
  if (!["mark_in_review", "approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (paymentStatus && !["pending", "manual", "paid"].includes(paymentStatus)) {
    return NextResponse.json({ error: "Invalid paymentStatus" }, { status: 400 });
  }
  const existing = await prisma.agentVerificationRequest.findUnique({
    where: { id },
    include: {
      agent: {
        select: {
          id: true,
          agentId: true,
          chainId: true,
          name: true,
        },
      },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  const now = new Date();
  const adminLabel = session.username;
  if (action === "mark_in_review") {
    const updated = await prisma.$transaction([
      prisma.agentVerificationRequest.update({
        where: { id },
        data: {
          verificationStatus: "in_review",
          reviewerNote: reviewerNote || undefined,
          reviewedByAdmin: adminLabel,
          ...(paymentStatus ? { paymentStatus } : {}),
        },
      }),
      prisma.agent.update({
        where: { id: existing.agentId },
        data: { publicVerificationStatus: "in_review" },
      }),
    ]);
    await revalidateAgentPublicCache(
      existing.agent.chainId,
      existing.agent.agentId,
      existing.agent.name,
    );
    return NextResponse.json({
      ok: true,
      request: {
        id: updated[0].id,
        verificationStatus: updated[0].verificationStatus,
        publicVerificationStatus: "in_review",
      },
    });
  }
  if (action === "reject") {
    const updated = await prisma.$transaction([
      prisma.agentVerificationRequest.update({
        where: { id },
        data: {
          verificationStatus: "rejected",
          reviewedAt: now,
          reviewerNote: reviewerNote || undefined,
          reviewedByAdmin: adminLabel,
          ...(paymentStatus ? { paymentStatus } : {}),
        },
      }),
      prisma.agent.update({
        where: { id: existing.agentId },
        data: { publicVerificationStatus: "rejected" },
      }),
    ]);
    await revalidateAgentPublicCache(
      existing.agent.chainId,
      existing.agent.agentId,
      existing.agent.name,
    );
    return NextResponse.json({
      ok: true,
      request: {
        id: updated[0].id,
        verificationStatus: updated[0].verificationStatus,
        publicVerificationStatus: "rejected",
      },
    });
  }
  const updated = await prisma.$transaction([
    prisma.agentVerificationRequest.update({
      where: { id },
      data: {
        verificationStatus: "verified",
        reviewedAt: now,
        reviewerNote: reviewerNote || undefined,
        reviewedByAdmin: adminLabel,
        paymentStatus: paymentStatus || existing.paymentStatus || "manual",
      },
    }),
    prisma.agent.update({
      where: { id: existing.agentId },
      data: {
        publicVerificationStatus: "verified",
        isPremiumVerified: true,
        isVerified: true,
      },
    }),
  ]);
  await invalidateAllPublicStatistics();
  await revalidateAgentPublicCache(
    existing.agent.chainId,
    existing.agent.agentId,
    existing.agent.name,
  );
  publishArLiveFeedEvent(
    buildAgentVerifiedFeedEvent({
      agentDbId: existing.agentId,
      chainId: existing.agent.chainId,
      agentId: existing.agent.agentId,
      name: existing.agent.name,
      verifiedAt: now,
    }),
  );
  return NextResponse.json({
    ok: true,
    request: {
      id: updated[0].id,
      verificationStatus: updated[0].verificationStatus,
      publicVerificationStatus: "verified",
    },
  });
}
