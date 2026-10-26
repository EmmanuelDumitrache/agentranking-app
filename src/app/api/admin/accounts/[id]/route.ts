import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { readAdminAccountById } from "@/lib/admin/identity/accounts.server";
import { getJobProducer } from "@/jobs/boss";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
export const dynamic = "force-dynamic";
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const accountId = parseInt(id, 10);
  if (!Number.isFinite(accountId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const body = await request.json() as {
      email?: string;
      walletAddress?: string;
      displayName?: string;
      password?: string;
      subscriptionStatus?: string;
      subscriptionPlan?: string;
      subscriptionExpiresAt?: string | null;
      adminNotes?: string;
      resetClaimToken?: boolean;
    };
    const data: Record<string, unknown> = {};
    if (body.email !== undefined) data.email = body.email.trim().toLowerCase();
    if (body.walletAddress !== undefined) {
      data.walletAddress = body.walletAddress ? body.walletAddress.trim().toLowerCase() : null;
    }
    if (body.displayName !== undefined) data.displayName = body.displayName.trim() || null;
    if (body.adminNotes !== undefined) data.adminNotes = body.adminNotes.trim();
    if (body.subscriptionStatus !== undefined) data.subscriptionStatus = body.subscriptionStatus;
    if (body.subscriptionPlan !== undefined) data.subscriptionPlan = body.subscriptionPlan;
    if (body.subscriptionExpiresAt !== undefined) {
      data.subscriptionExpiresAt = body.subscriptionExpiresAt ? new Date(body.subscriptionExpiresAt) : null;
    }
    if (body.password) {
      if (body.password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
      }
      data.passwordHash = await hash(body.password, 12);
    }
    // Reset claim token
    if (body.resetClaimToken) {
      data.claimToken = randomUUID();
      data.claimTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      data.isClaimed = false;
      data.claimedAt = null;
    }
    if (body.resetClaimToken) await getJobProducer();
    const updated = await prisma.$transaction(async (tx) => {
      const profile = await tx.userProfile.update({
        where: { id: accountId },
        data,
        select: {
          id: true,
          email: true,
          walletAddress: true,
          displayName: true,
          subscriptionStatus: true,
          subscriptionPlan: true,
          subscriptionExpiresAt: true,
          isClaimed: true,
          claimToken: true,
          claimTokenExpiresAt: true,
          adminNotes: true,
        },
      });
      if (body.resetClaimToken && profile.email && profile.claimToken) {
        await queueNotificationInTx(tx, {
          idempotencyKey: `dashboard-claim:${profile.id}:${profile.claimToken}`,
          kind: NOTIFICATION_KINDS.DASHBOARD_CLAIM,
          recipient: profile.email,
          payload: { profileId: profile.id },
        });
      }
      return profile;
    });
    const account = await readAdminAccountById(updated.id);
    return NextResponse.json({ account });
  } catch (err) {
    console.error("[admin/accounts/[id]] PATCH error:", err);
    return NextResponse.json({ error: "Failed to update account." }, { status: 500 });
  }
}