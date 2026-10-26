import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { applyDaoVotesAdminChange } from "@/lib/admin-dao-votes-apply";
import { fetchDaoVotesAdminRow, type DaoVotesAdminRow } from "@/lib/admin-dao-votes";
import { resolveAdminAdjustFromPatchBody } from "@/lib/admin-dao-votes-patch";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const MAX_BULK = 100;
type BulkBody = {
  ids?: unknown;
  action?: unknown;
  targetPowerScore?: unknown;
};
/**
 * POST /api/admin/dao-votes/bulk
 * Body: { ids: number[], action: "setTarget" | "remove", targetPowerScore?: number }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as BulkBody;
    const rawIds = body.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
    }
    const ids = rawIds
      .map((v) => (typeof v === "number" ? v : Number.parseInt(String(v), 10)))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) {
      return NextResponse.json({ error: "No valid agent ids" }, { status: 400 });
    }
    if (ids.length > MAX_BULK) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BULK} agents per bulk request` },
        { status: 400 },
      );
    }
    const action = body.action;
    if (action !== "setTarget" && action !== "remove") {
      return NextResponse.json(
        { error: 'action must be "setTarget" or "remove"' },
        { status: 400 },
      );
    }
    const targetPowerScore =
      action === "remove"
        ? 0
        : typeof body.targetPowerScore === "number" &&
            Number.isFinite(body.targetPowerScore) &&
            Number.isInteger(body.targetPowerScore) &&
            body.targetPowerScore >= 0
          ? body.targetPowerScore
          : null;
    if (action === "setTarget" && targetPowerScore === null) {
      return NextResponse.json(
        { error: "targetPowerScore must be a non-negative integer" },
        { status: 400 },
      );
    }
    const updated: DaoVotesAdminRow[] = [];
    const failed: { id: number; error: string }[] = [];
    const succeededIds: number[] = [];
    for (const internalId of ids) {
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
        failed.push({ id: internalId, error: "Agent not found" });
        continue;
      }
      const resolved = await resolveAdminAdjustFromPatchBody(
        prisma,
        internalId,
        existing,
        { targetPowerScore: targetPowerScore! },
      );
      if (!resolved.ok) {
        failed.push({ id: internalId, error: resolved.error });
        continue;
      }
      try {
        await prisma.agent.update({
          where: { id: internalId },
          data: { adminPowerAdjust: resolved.adjust },
        });
        succeededIds.push(internalId);
      } catch {
        failed.push({ id: internalId, error: "Update failed" });
      }
    }
    if (succeededIds.length > 0) {
      await applyDaoVotesAdminChange(prisma, succeededIds);
      for (const id of succeededIds) {
        const row = await fetchDaoVotesAdminRow(prisma, id);
        if (row) updated.push(row);
      }
    }
    return NextResponse.json({ updated, failed });
  } catch (err) {
    console.error("POST /api/admin/dao-votes/bulk error:", err);
    return NextResponse.json({ error: "Bulk update failed" }, { status: 500 });
  }
}