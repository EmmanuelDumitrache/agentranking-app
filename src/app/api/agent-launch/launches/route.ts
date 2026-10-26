import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { getAgentLaunchNetwork } from "@/lib/agent-launch/solana";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "100", 10);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(250, Math.max(1, requestedLimit))
    : 100;
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  const network = getAgentLaunchNetwork();
  const launches = await prisma.agentLaunch.findMany({
    where: {
      network,
      launchStatus: "indexed",
      feeSharingStatus: "active",
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const truncated = launches.length > limit;
  return NextResponse.json({
    launches: launches.slice(0, limit).map(serializeAgentLaunch),
    truncated,
  });
}
