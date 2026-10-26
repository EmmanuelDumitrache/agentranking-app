import { NextRequest, NextResponse } from "next/server";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import { autoRecoverStuckAgentLaunch } from "@/lib/agent-launch/auto-recover-launch.server";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { loadAgentLaunchOrThrow } from "@/lib/agent-launch/launch-access";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import { validateCreatorWallet } from "@/lib/agent-launch/validation";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  try {
    const body = (await request.json()) as {
      launchId?: string;
      creatorWallet?: string;
    };
    const launchId = body.launchId?.trim();
    if (!launchId) {
      return NextResponse.json({ error: "launchId is required" }, { status: 400 });
    }
    const creatorError = validateCreatorWallet(body.creatorWallet);
    if (creatorError) {
      return NextResponse.json({ error: creatorError }, { status: 400 });
    }
    const launch = await loadAgentLaunchOrThrow(launchId);
    if (launch.creatorWallet && launch.creatorWallet !== body.creatorWallet?.trim()) {
      return NextResponse.json({ error: "Creator wallet does not match draft" }, { status: 400 });
    }
    const recovery = await autoRecoverStuckAgentLaunch(launch, body.creatorWallet);
    if (!recovery.recovered && recovery.launch.launchStatus === "draft") {
      return NextResponse.json(
        {
          ok: false,
          onChain: false,
          error: "No on-chain Pump token was found for this launch yet.",
          code: "token_not_on_chain",
        },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      recovered: recovery.recovered,
      launch: serializeAgentLaunch(recovery.launch),
      signature: recovery.signature ?? null,
      mint: recovery.mint ?? null,
    });
  } catch (error) {
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to recover token create";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
