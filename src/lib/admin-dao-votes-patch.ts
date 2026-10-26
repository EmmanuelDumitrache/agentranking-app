import type { PrismaClient } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import {
  agentPowerBaseContrib,
  solveAdminAdjustForTargetPower,
} from "@/lib/power-score-formula";
const MIN_ADJUST = -1_000_000;
const MAX_ADJUST = 1_000_000;
async function sumActiveBoostUnits(db: PrismaClient, agentInternalId: number): Promise<number> {
  const agg = await db.agentBoost.aggregate({
    where: {
      agentId: agentInternalId,
      expiresAt: { gt: new Date() },
    },
    _sum: { boostUnits: true },
  });
  return agg._sum.boostUnits ?? 0;
}
type ExistingAgent = {
  id: number;
  score: number;
  voteFireCount: number;
  votePooCount: number;
};
export type PatchBody = {
  adminPowerAdjust?: unknown;
  targetPowerScore?: unknown;
};
export type ResolveAdjustResult =
  | { ok: true; adjust: number }
  | { ok: false; status: number; error: string };
/** Returns resolved integer adminPowerAdjust, or an error payload. */
export async function resolveAdminAdjustFromPatchBody(
  db: PrismaClient,
  internalId: number,
  existing: ExistingAgent,
  body: PatchBody,
): Promise<ResolveAdjustResult> {
  const hasTarget = body.targetPowerScore !== undefined && body.targetPowerScore !== null;
  const hasAdjust = body.adminPowerAdjust !== undefined && body.adminPowerAdjust !== null;
  if (hasTarget && hasAdjust) {
    return {
      ok: false,
      status: 400,
      error: "Send only one of targetPowerScore or adminPowerAdjust",
    };
  }
  if (!hasTarget && !hasAdjust) {
    return {
      ok: false,
      status: 400,
      error: "Provide targetPowerScore or adminPowerAdjust",
    };
  }
  if (hasTarget) {
    const t = body.targetPowerScore;
    if (typeof t !== "number" || !Number.isFinite(t) || !Number.isInteger(t) || t < 0) {
      return {
        ok: false,
        status: 400,
        error: "targetPowerScore must be a non-negative integer",
      };
    }
    const activeBoosts = await sumActiveBoostUnits(db, internalId);
    const base = agentPowerBaseContrib({
      score: Number(existing.score),
      activeBoosts,
      voteFireCount: existing.voteFireCount,
      votePooCount: existing.votePooCount,
    });
    const solved = solveAdminAdjustForTargetPower(base, t, MIN_ADJUST, MAX_ADJUST);
    if (!solved.ok) {
      return {
        ok: false,
        status: 422,
        error: solved.message,
      };
    }
    return { ok: true, adjust: solved.adjust };
  }
  const adj = body.adminPowerAdjust;
  if (typeof adj !== "number" || !Number.isFinite(adj) || !Number.isInteger(adj)) {
    return { ok: false, status: 400, error: "adminPowerAdjust must be an integer" };
  }
  if (adj < MIN_ADJUST || adj > MAX_ADJUST) {
    return {
      ok: false,
      status: 400,
      error: `adminPowerAdjust must be between ${MIN_ADJUST} and ${MAX_ADJUST}`,
    };
  }
  return { ok: true, adjust: adj };
}
/** Convenience for route handlers that expect NextResponse errors. */
export function resolveAdjustToResponse(
  result: ResolveAdjustResult,
): NextResponse | { adjust: number } {
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return { adjust: result.adjust };
}