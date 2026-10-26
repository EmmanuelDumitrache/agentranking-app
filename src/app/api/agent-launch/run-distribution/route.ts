import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import { HttpBodyTooLargeError, InvalidJsonBodyError, readBoundedJsonObject } from "@/lib/bounded-http-body";
import {
  enqueueAgentLaunchFeeDistribution,
  getAgentLaunchFeeDistributionJobResult,
} from "@/lib/agent-launch/fee-distribution-jobs";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  assertLaunchIndexedForDistribution,
  loadAgentLaunchOrThrow,
} from "@/lib/agent-launch/launch-access";
import { resolveLaunchAgentDbId } from "@/lib/agent-launch/linked-agent";
import { assertLaunchOwnsAgentDbId } from "@/lib/agent-launch/selected-agent";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
function json(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
async function loadAuthorizedLaunch(launchId: string) {
  const launch = await loadAgentLaunchOrThrow(launchId);
  const agentDbId = resolveLaunchAgentDbId(launch);
  if (agentDbId == null) {
    if (process.env.NODE_ENV !== "production") return launch;
    throw new AgentLaunchError(
      "Launch is not linked to an owned agent; use the admin recovery flow",
      "launch_ownership_unresolved",
      403,
    );
  }
  const session = await getServerSession(authOptions);
  const ownership = await assertLaunchOwnsAgentDbId(session, String(agentDbId));
  if (!ownership.ok) {
    throw new AgentLaunchError(
      "Not authorized for this launch",
      "launch_forbidden",
      ownership.status,
    );
  }
  return launch;
}
function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpBodyTooLargeError) {
    return json({ error: error.message, code: "BODY_TOO_LARGE" }, { status: 413 });
  }
  if (error instanceof InvalidJsonBodyError) {
    return json({ error: error.message, code: "INVALID_JSON" }, { status: 400 });
  }
  if (error instanceof AgentLaunchError) {
    return json({ error: error.message, code: error.code }, { status: error.status });
  }
  const message = Error.isError(error) ? error.message : "Fee distribution request failed";
  return json({ error: message }, { status: 500 });
}
/**
 * Queue fee distribution. The HTTP process never loads or uses the fee-bot
 * private key; signing and Solana submission are worker-only operations.
 */
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  try {
    const body = await readBoundedJsonObject(request, 2 * 1024);
    const launchId = typeof body.launchId === "string" ? body.launchId.trim() : "";
    if (!ID_RE.test(launchId)) {
      return json({ error: "A valid launchId is required" }, { status: 400 });
    }
    const launch = await loadAuthorizedLaunch(launchId);
    const mode =
      body.mode === "recovery" || body.force === true ? "recovery" : "standard";
    if (mode === "standard") {
      assertLaunchIndexedForDistribution(launch);
    } else if (!launch.mint) {
      return json({ error: "Launch mint is required for fee distribution" }, { status: 400 });
    }
    const queued = await enqueueAgentLaunchFeeDistribution(launch.id, mode);
    return json(
      {
        status: "queued",
        launchId: launch.id,
        mint: launch.mint,
        jobId: queued.jobId,
        accepted: queued.accepted,
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
/** Poll the durable pg-boss execution by the job id returned from POST. */
export async function GET(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  try {
    const launchId = request.nextUrl.searchParams.get("launchId")?.trim();
    const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
    if (!launchId || !jobId || !ID_RE.test(launchId) || !ID_RE.test(jobId)) {
      return json({ error: "Valid launchId and jobId are required" }, { status: 400 });
    }
    await loadAuthorizedLaunch(launchId);
    const result = await getAgentLaunchFeeDistributionJobResult(launchId, jobId);
    if (!result) {
      return json({ error: "Launch not found" }, { status: 404 });
    }
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}