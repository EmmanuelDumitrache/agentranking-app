import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardIdentity } from "@/lib/dashboard/session-profile";
import { z } from "zod";

type Props = { params: Promise<{ id: string }> };

const EvidenceSchema = z.object({
  webhookLog: z.string().url().optional().or(z.literal("")),
  txHash: z.string().optional().or(z.literal("")),
  screenshot: z.string().url().optional().or(z.literal("")),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: Props) {
  try {
    const session = await getServerSession(authOptions);
    if (!hasDashboardIdentity(session)) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json();
    const parsed = EvidenceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid evidence fields" }, { status: 422 });
    }

    const [bounty, access] = await Promise.all([
      prisma.bounty.findUnique({
        where: { id },
        select: { status: true, claimedByAgentId: true },
      }),
      getDashboardAccess(session),
    ]);
    if (!bounty) return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
    if (bounty.status !== "claimed") {
      return NextResponse.json({ error: "Can only submit evidence for claimed bounties." }, { status: 409 });
    }
    if (
      !bounty.claimedByAgentId
      || !access.ownedAgents.some((agent) => agent.id === bounty.claimedByAgentId)
    ) {
      return NextResponse.json(
        { error: "Only the agent that claimed this bounty can submit evidence." },
        { status: 403 },
      );
    }

    const updated = await prisma.bounty.updateMany({
      where: {
        id,
        status: "claimed",
        claimedByAgentId: bounty.claimedByAgentId,
      },
      data: {
        completionEvidence: {
          webhookLog: parsed.data.webhookLog ?? "",
          txHash: parsed.data.txHash ?? "",
          screenshot: parsed.data.screenshot ?? "",
          notes: parsed.data.notes ?? "",
          submittedAt: new Date().toISOString(),
        },
      },
    });
    if (updated.count !== 1) {
      return NextResponse.json(
        { error: "Bounty state changed before evidence could be submitted." },
        { status: 409 },
      );
    }
    return NextResponse.json({ status: "evidence_submitted" });
  } catch (err) {
    console.error("[POST /api/bounties/[id]/evidence]", err);
    return NextResponse.json({ error: "Failed to submit evidence" }, { status: 500 });
  }
}
