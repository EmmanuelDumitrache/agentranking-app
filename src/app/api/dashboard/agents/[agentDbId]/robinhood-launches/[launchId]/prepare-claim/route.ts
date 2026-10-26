import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  HttpBodyTooLargeError,
  InvalidJsonBodyError,
  readOptionalBoundedJsonObject,
} from "@/lib/bounded-http-body";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { prisma } from "@/lib/db";
import { prepareRobinhoodFeeClaimTransaction } from "@/lib/robinhood-chain/fee-claim.server";

export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
type RouteContext = { params: Promise<{ agentDbId: string; launchId: string }> };

function json(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { agentDbId: agentDbIdParam, launchId } = await context.params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  if (!Number.isSafeInteger(agentDbId) || agentDbId <= 0 || !/^[A-Za-z0-9_-]{1,128}$/.test(launchId)) {
    return json({ ok: false, error: "Invalid route parameters" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return json({ ok: false, error: "Forbidden" }, { status: access.status });

  const launch = await prisma.robinhoodChainLaunch.findFirst({ where: { id: launchId, agentDbId } });
  if (!launch) return json({ ok: false, error: "Launch not found" }, { status: 404 });
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { evmWalletAddress: true, evmWalletStatus: true },
  });
  if (!agent?.evmWalletAddress || agent.evmWalletStatus !== "active") {
    return json({ ok: false, error: "Agent EVM wallet is not configured." }, { status: 400 });
  }
  if (agent.evmWalletAddress.toLowerCase() !== launch.creatorWallet.toLowerCase()) {
    return json(
      { ok: false, error: "Agent EVM wallet does not match launch creator wallet." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await readOptionalBoundedJsonObject(request, 2 * 1024);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      return json({ ok: false, error: error.message }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError) {
      return json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return json({ ok: false, error: "force must be a boolean" }, { status: 400 });
  }
  const force = body.force === true;
  try {
    const prepared = await prepareRobinhoodFeeClaimTransaction({
      tokenAddress: launch.tokenAddress,
      creatorWallet: launch.creatorWallet,
      feeSplitterAddress: launch.feeSplitterAddress,
      force,
    });
    return json({ ok: true, prepared, force });
  } catch (error) {
    const message = Error.isError(error) ? error.message : "Could not prepare claim";
    return json({ ok: false, error: message }, { status: 400 });
  }
}
