import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile, hasDashboardIdentity } from "@/lib/dashboard/session-profile";
import { prisma } from "@/lib/db";
import { z } from "zod";
type Props = { params: Promise<{ id: string }> };
const DisputeSchema = z.object({
  reason: z.string().min(10).max(2000),
});
export async function POST(req: NextRequest, { params }: Props) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !hasDashboardIdentity(session)) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json();
    const parsed = DisputeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 422 });
    }
    const [profile, access] = await Promise.all([
      ensureMinimalUserProfile(session),
      getDashboardAccess(session),
    ]);
    const sessionEmail = session.user?.email?.trim().toLowerCase() ?? "";
    const sessionWallet = profile?.walletAddress?.trim().toLowerCase() ?? "";
    const ownedAgentIds = new Set(access.ownedAgents.map((agent) => agent.id));
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bounty-dispute:${id}`}, 0))`;
      const bounty = await tx.bounty.findUnique({
        where: { id },
        select: {
          status: true,
          posterEmail: true,
          posterWallet: true,
          claimedByAgentId: true,
        },
      });
      if (!bounty) return { kind: "not_found" as const };
      if (!["claimed", "open"].includes(bounty.status)) {
        return { kind: "state_conflict" as const };
      }
      const posterEmail = bounty.posterEmail.trim().toLowerCase();
      const posterWallet = bounty.posterWallet.trim().toLowerCase();
      const isPoster = Boolean(
        (posterEmail && sessionEmail && posterEmail === sessionEmail)
        || (posterWallet && sessionWallet && posterWallet === sessionWallet),
      );
      const isClaimant = Boolean(
        bounty.claimedByAgentId && ownedAgentIds.has(bounty.claimedByAgentId),
      );
      if (!isPoster && !isClaimant) return { kind: "forbidden" as const };
      const dispute = await tx.bountyDispute.create({
        data: {
          bountyId: id,
          raisedBy: isPoster ? "poster" : `agent:${bounty.claimedByAgentId}`,
          reason: parsed.data.reason,
          status: "open",
        },
      });
      await tx.bounty.update({
        where: { id },
        data: { status: "disputed" },
      });
      return { kind: "created" as const, dispute };
    });
    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
    }
    if (result.kind === "forbidden") {
      return NextResponse.json(
        { error: "Only the bounty poster or claiming agent can raise a dispute." },
        { status: 403 },
      );
    }
    if (result.kind === "state_conflict") {
      return NextResponse.json(
        { error: "Can only dispute bounties in claimed or open state." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { id: result.dispute.id, status: "dispute_raised" },
      { status: 201 },
    );
  } catch (err) {
    console.error("[POST /api/bounties/[id]/dispute]", err);
    return NextResponse.json({ error: "Failed to raise dispute" }, { status: 500 });
  }
}
