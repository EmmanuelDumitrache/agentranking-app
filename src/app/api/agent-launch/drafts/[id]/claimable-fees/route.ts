import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  loadAgentLaunchOrThrow,
} from "@/lib/agent-launch/launch-access";
import { readAgentLaunchClaimableFeesForLaunch } from "@/lib/agent-launch/claimable-fees.server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);

  try {
    const { id } = await params;
    const routeId = id?.trim();
    const mint = request.nextUrl.searchParams.get("mint")?.trim();
    const network = request.nextUrl.searchParams.get("network")?.trim();
    const launch =
      routeId && routeId !== "undefined" && routeId !== "null"
        ? await loadAgentLaunchOrThrow(routeId)
        : mint && network
          ? await prisma.agentLaunch.findFirst({
              where: { mint, network },
              orderBy: { createdAt: "desc" },
            })
          : null;

    if (!launch) {
      return NextResponse.json(
        {
          ok: false,
          error:
            mint && network
              ? "No launch found for that mint/network"
              : "Provide launchId in URL path or mint+network query params",
        },
        { status: mint && network ? 404 : 400 },
      );
    }

    return NextResponse.json(
      await readAgentLaunchClaimableFeesForLaunch(launch),
    );
  } catch (error) {
    const message = Error.isError(error)
      ? error.message
      : "Failed to check claimable fees";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
