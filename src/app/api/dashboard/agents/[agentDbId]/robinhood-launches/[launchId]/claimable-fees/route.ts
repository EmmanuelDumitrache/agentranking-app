import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { prisma } from "@/lib/db";
import { readDashboardRobinhoodClaimableFees } from "@/lib/robinhood-chain/dashboard-claimable-fees.server";
import { serializeRobinhoodLaunch } from "@/lib/robinhood-chain/serialize";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ agentDbId: string; launchId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { agentDbId: agentDbIdParam, launchId } = await context.params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  if (!Number.isSafeInteger(agentDbId) || agentDbId <= 0) {
    return NextResponse.json(
      { ok: false, error: "Invalid agent id" },
      { status: 400 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: access.status },
    );
  }

  const [launchRow, agent] = await Promise.all([
    prisma.robinhoodChainLaunch.findFirst({
      where: { id: launchId, agentDbId },
    }),
    prisma.agent.findUnique({
      where: { id: agentDbId },
      select: { evmWalletAddress: true, evmWalletStatus: true },
    }),
  ]);
  if (!launchRow) {
    return NextResponse.json(
      { ok: false, error: "Launch not found" },
      { status: 404 },
    );
  }

  return NextResponse.json(
    await readDashboardRobinhoodClaimableFees({
      launch: serializeRobinhoodLaunch(launchRow),
      agentEvmAddress: agent?.evmWalletAddress ?? null,
      agentEvmStatus: agent?.evmWalletStatus ?? null,
    }),
  );
}
