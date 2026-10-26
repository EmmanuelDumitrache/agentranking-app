import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
/**
 * Look up the latest launch for a given agent, for wallet page creator fee rewards
 * or settings page token status.
 *
 * GET /api/agent-launch/drafts/by-agent?agentDbId=290&network=mainnet-beta
 * GET /api/agent-launch/drafts/by-agent?agentDbId=290&includeUnindexed=1
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawAgentDbId = searchParams.get("agentDbId");
  const network = searchParams.get("network");
  const includeUnindexed = searchParams.get("includeUnindexed") === "1";
  const agentDbId = rawAgentDbId ? Number.parseInt(rawAgentDbId, 10) : NaN;
  if (!Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "agentDbId is required" }, { status: 400 });
  }
  const launch = await prisma.agentLaunch.findFirst({
    where: {
      agentDbId,
      ...(network ? { network } : {}),
      ...(includeUnindexed ? {} : { launchStatus: "indexed" }),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      mint: true,
      network: true,
      launchStatus: true,
      feeSharingStatus: true,
      creatorWallet: true,
      arTreasuryWallet: true,
      creatorShareBps: true,
      arShareBps: true,
      tokenName: true,
      tokenSymbol: true,
    },
  });
  if (!launch) {
    return NextResponse.json(null, { status: 200 });
  }
  return NextResponse.json(launch);
}