import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import {
  HttpBodyTooLargeError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import { getLaunchWalletSession } from "@/lib/launch-wallet-session/session";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { assertLaunchWalletOwnsSolanaLaunch } from "@/lib/public-launch/my-launches.server";
import {
  enqueueAgentLaunchFeeDistribution,
  getAgentLaunchFeeDistributionJobResult,
} from "@/lib/agent-launch/fee-distribution-jobs";
import {
  assertLaunchIndexedForDistribution,
  loadAgentLaunchOrThrow,
} from "@/lib/agent-launch/launch-access";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const LAMPORTS_PER_SOL = BigInt(1_000_000_000);
function json(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
function lamportsToSol(lamports: string): string {
  const amount = BigInt(lamports || "0");
  const whole = amount / LAMPORTS_PER_SOL;
  const fraction = (amount % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
async function loadOwnedLaunch(launchId: string, wallet: string) {
  const owned = await assertLaunchWalletOwnsSolanaLaunch(launchId, wallet);
  if (!owned.ok) {
    throw new AgentLaunchError(owned.error, "launch_forbidden", owned.status);
  }
  return owned.launch;
}
function errorResponse(error: unknown) {
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
export async function GET(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  const session = await getLaunchWalletSession();
  if (!session || session.chain !== "solana") {
    return json({ ok: false, error: "Solana wallet session required" }, { status: 401 });
  }
  try {
    const launchId = request.nextUrl.searchParams.get("launchId")?.trim() ?? "";
    const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
    if (!ID_RE.test(launchId)) {
      return json({ ok: false, error: "A valid launchId is required" }, { status: 400 });
    }
    const launch = await loadOwnedLaunch(launchId, session.wallet);
    if (jobId) {
      if (!ID_RE.test(jobId)) {
        return json({ error: "Invalid jobId" }, { status: 400 });
      }
      const result = await getAgentLaunchFeeDistributionJobResult(launchId, jobId);
      if (!result) return json({ error: "Launch not found" }, { status: 404 });
      return json(result);
    }
    if (!launch.mint) {
      return json({
        ok: true,
        launchId: launch.id,
        canDistribute: false,
        reason: "No mint — token not yet created",
        claimableSol: null,
      });
    }
    const connection = getAgentLaunchConnection();
    const mint = new PublicKey(launch.mint);
    const onlineSdk = new OnlinePumpSdk(connection);
    const minFee = await onlineSdk.getMinimumDistributableFee(mint);
    const distributable = BigInt(minFee.distributableFees.toString());
    return json({
      ok: true,
      launchId: launch.id,
      mint: launch.mint,
      canDistribute: minFee.canDistribute,
      reason: minFee.canDistribute
        ? undefined
        : distributable === BigInt(0)
          ? "No claimable fees yet."
          : "Claimable amount below Pump.fun minimum threshold.",
      claimableSol: lamportsToSol(distributable.toString()),
      totalDistributedSol: lamportsToSol(launch.totalFeesDistributedLamports.toString()),
      creatorShareBps: launch.creatorShareBps,
      arShareBps: launch.arShareBps,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  const session = await getLaunchWalletSession();
  if (!session || session.chain !== "solana") {
    return json({ error: "Solana wallet session required" }, { status: 401 });
  }
  try {
    const body = await readBoundedJsonObject(request, 2 * 1024);
    const launchId = typeof body.launchId === "string" ? body.launchId.trim() : "";
    if (!ID_RE.test(launchId)) {
      return json({ error: "A valid launchId is required" }, { status: 400 });
    }
    await loadOwnedLaunch(launchId, session.wallet);
    const launch = await loadAgentLaunchOrThrow(launchId);
    assertLaunchIndexedForDistribution(launch);
    const queued = await enqueueAgentLaunchFeeDistribution(launch.id, "standard");
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
