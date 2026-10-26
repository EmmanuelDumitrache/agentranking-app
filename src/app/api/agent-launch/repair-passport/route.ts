import { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import {
  assertAgentLaunchDevMockAllowed,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { loadAgentLaunchOrThrow } from "@/lib/agent-launch/launch-access";
import {
  buildAgentPassportFromLaunch,
  isStoredAgentPassportStale,
  type AgentPassport,
} from "@/lib/agent-launch/passport";
import { recordAgentLaunchEvent } from "@/lib/agent-launch/events";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
/**
 * Local/devnet-only: rebuild passportJson from current DB columns.
 */
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchDevMockAllowed();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  try {
    const body = (await request.json()) as { launchId?: string };
    const launchId = body.launchId?.trim();
    if (!launchId) {
      return NextResponse.json({ error: "launchId is required" }, { status: 400 });
    }
    const existing = await loadAgentLaunchOrThrow(launchId);
    const wasStale = isStoredAgentPassportStale(
      existing,
      existing.passportJson as AgentPassport | null,
    );
    const passportJson = buildAgentPassportFromLaunch(existing);
    const launch = await prisma.agentLaunch.update({
      where: { id: launchId },
      data: {
        passportJson: passportJson as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAgentLaunchEvent({
      launchId,
      type: "passport_repaired",
      payloadJson: { wasStale, mock: true },
    });
    return NextResponse.json({
      ok: true,
      wasStale,
      passportJson,
      launch: serializeAgentLaunch(launch),
    });
  } catch (error) {
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to repair passport";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
