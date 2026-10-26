import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { applyDaoVotesAdminChange } from "@/lib/admin-dao-votes-apply";
import {
  resolveAdminAdjustFromPatchBody,
  resolveAdjustToResponse,
  type PatchBody,
} from "@/lib/admin-dao-votes-patch";
import { fetchDaoVotesAdminRow } from "@/lib/admin-dao-votes";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/**
 * PATCH /api/admin/dao-votes/[id]
 * Body: { targetPowerScore?: number } | { adminPowerAdjust?: number }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: idParam } = await params;
  const internalId = Number.parseInt(idParam, 10);
  if (!Number.isFinite(internalId) || internalId < 1) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  try {
    const body = (await request.json()) as PatchBody;
    const existing = await prisma.agent.findUnique({
      where: { id: internalId },
      select: {
        id: true,
        score: true,
        voteFireCount: true,
        votePooCount: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const resolved = await resolveAdminAdjustFromPatchBody(
      prisma,
      internalId,
      existing,
      body,
    );
    const adjustOrResponse = resolveAdjustToResponse(resolved);
    if (adjustOrResponse instanceof NextResponse) {
      return adjustOrResponse;
    }
    const { adjust } = adjustOrResponse;
    await prisma.agent.update({
      where: { id: internalId },
      data: { adminPowerAdjust: adjust },
    });
    await applyDaoVotesAdminChange(prisma, [internalId]);
    const agent = await fetchDaoVotesAdminRow(prisma, internalId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found after update" }, { status: 404 });
    }
    return NextResponse.json({ agent });
  } catch (err) {
    console.error("PATCH /api/admin/dao-votes/[id] error:", err);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}