import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canClaimBounties } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile, hasDashboardIdentity } from "@/lib/dashboard/session-profile";
import { getJobProducer } from "@/jobs/boss";
import { enqueueApplicationJobInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
import { z } from "zod";
const AUTO_RELEASE_DELAY_MS = 72 * 60 * 60 * 1000;
type Props = { params: Promise<{ id: string }> };
const ClaimSchema = z.object({
  agentId: z.number().int().positive().optional(),
});
export async function POST(req: NextRequest, { params }: Props) {
  try {
    const session = await getServerSession(authOptions);
    if (!hasDashboardIdentity(session)) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { id } = await params;
    const profile = await ensureMinimalUserProfile(session);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 401 });
    }
    const fullProfile = await prisma.userProfile.findUnique({
      where: { id: profile.id },
      select: { subscriptionStatus: true, subscriptionExpiresAt: true, walletAddress: true },
    });
    if (!fullProfile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 401 });
    }
    const eligible = await canClaimBounties(fullProfile);
    if (!eligible) {
      return NextResponse.json(
        {
          error:
            "Only verified agents (Verified tier or Pro subscribers) can claim bounties. " +
            "Complete KYA verification ($49 one-time) to unlock bounty claiming.",
        },
        { status: 403 },
      );
    }
    // Find the agent owned by this wallet
    const wallet = fullProfile.walletAddress;
    if (!wallet) {
      return NextResponse.json({ error: "No wallet linked to your profile" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const parsed = ClaimSchema.safeParse(body);
    const requestedAgentId = parsed.success ? parsed.data.agentId : undefined;
    const agent = await prisma.agent.findFirst({
      where: {
        ...(requestedAgentId ? { id: requestedAgentId } : {}),
        AND: [
          {
            OR: [
              { owner: { equals: wallet, mode: "insensitive" } },
              { verifiedWallet: { equals: wallet, mode: "insensitive" } },
            ],
          },
          { OR: [{ isVerified: true }, { isPremiumVerified: true }] },
        ],
      },
      select: { id: true },
    });
    if (!agent) {
      return NextResponse.json(
        {
          error: requestedAgentId
            ? "The selected agent is not a verified agent owned by your wallet."
            : "No verified agent found for your wallet. Complete KYA verification first.",
        },
        { status: 403 },
      );
    }
    const claimedAt = new Date();
    const autoReleaseAt = new Date(claimedAt.getTime() + AUTO_RELEASE_DELAY_MS);
    await getJobProducer();
    const claimed = await prisma.$transaction(async (tx) => {
      const result = await tx.bounty.updateMany({
        where: { id, status: "open" },
        data: { status: "claimed", claimedByAgentId: agent.id, claimedAt, autoReleaseAt },
      });
      if (result.count === 1) {
        await enqueueApplicationJobInTx(tx, JOB_QUEUES.BOUNTY_AUTO_RELEASE, { v: 1, id }, {
          startAfter: autoReleaseAt,
          singletonKey: id,
        });
        const bounty = await tx.bounty.findUnique({ where: { id }, select: { posterEmail: true } });
        if (bounty?.posterEmail) {
          await queueNotificationInTx(tx, {
            idempotencyKey: `bounty:${id}:claimed`,
            kind: NOTIFICATION_KINDS.BOUNTY_CLAIMED,
            recipient: bounty.posterEmail,
            payload: { bountyId: id },
          });
        }
      }
      return result;
    });
    if (claimed.count !== 1) {
      const current = await prisma.bounty.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!current) return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
      return NextResponse.json(
        { error: `This bounty is already ${current.status}.` },
        { status: 409 },
      );
    }
    const updated = await prisma.bounty.findUnique({
      where: { id },
      include: { claimedAgent: { select: { name: true } } },
    });
    if (!updated) throw new Error(`Claimed bounty ${id} disappeared after update`);
    // autoReleaseAt remains domain/audit state; pg-boss owns the deferred execution attempt.
    // The worker re-checks status, due time, and disputes before completing the transition.
    // Poster notification is durable and idempotent; it was enqueued in the claim transaction.
    return NextResponse.json({ id: updated.id, status: updated.status });
  } catch (err) {
    console.error("[POST /api/bounties/[id]/claim]", err);
    return NextResponse.json({ error: "Failed to claim bounty" }, { status: 500 });
  }
}
