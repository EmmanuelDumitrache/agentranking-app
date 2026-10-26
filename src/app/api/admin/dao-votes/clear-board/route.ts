import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { clearDaoVotesBoard } from "@/lib/admin-dao-votes-clear-board";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const CONFIRM_PHRASE = "CLEAR_DAO_BOARD";
/**
 * POST /api/admin/dao-votes/clear-board
 * Body: { confirm: "CLEAR_DAO_BOARD" }
 *
 * Recomputes listing power for all agents; removes stale/admin-only board entries.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { confirm?: string };
    if (body.confirm !== CONFIRM_PHRASE) {
      return NextResponse.json(
        {
          error: `Send { "confirm": "${CONFIRM_PHRASE}" } to run a full board recompute.`,
        },
        { status: 400 },
      );
    }
    const result = await clearDaoVotesBoard(prisma);
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Board: ${result.agentsOnBoardBefore} → ${result.agentsOnBoardAfter} agents (admin rows touched: ${result.adminAdjustmentsCleared}).`,
    });
  } catch (err) {
    console.error("POST /api/admin/dao-votes/clear-board error:", err);
    const message = Error.isError(err) ? err.message : "Clear board failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
