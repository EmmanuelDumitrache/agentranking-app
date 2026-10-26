import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  HttpBodyTooLargeError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { prisma } from "@/lib/db";
import {
  assertRobinhoodLaunchWalletAccess,
  loadLaunchAccessContext,
} from "@/lib/launch-wallet-session/auth";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import { RobinhoodLaunchError } from "@/lib/robinhood-chain/errors";
import { parseRobinhoodPrepareBody } from "@/lib/robinhood-chain/http-input";
import {
  getEstimatedGasForLaunch,
  getRobinhoodFactoryLaunchFee,
  prepareRobinhoodLaunchTransaction,
} from "@/lib/robinhood-chain/prepare-launch.server";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
function json(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
function errorResponse(error: unknown) {
  if (error instanceof HttpBodyTooLargeError) {
    return json({ error: error.message, code: "BODY_TOO_LARGE" }, { status: 413 });
  }
  if (error instanceof InvalidJsonBodyError) {
    return json({ error: error.message, code: "INVALID_JSON" }, { status: 400 });
  }
  if (error instanceof RobinhoodLaunchError) {
    return json({ error: error.message, code: error.code }, { status: 400 });
  }
  const message = Error.isError(error) ? error.message : "Could not prepare launch transaction";
  return json({ error: message, code: "PREPARE_FAILED" }, { status: 400 });
}
export async function GET(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  try {
    const [fee, gas] = await Promise.all([
      getRobinhoodFactoryLaunchFee(),
      getEstimatedGasForLaunch(),
    ]);
    return json({ ok: true, ...fee, ...gas });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  try {
    const fields = parseRobinhoodPrepareBody(await readBoundedJsonObject(request, 16 * 1024));
    const creatorWallet = fields.creatorWallet.toLowerCase();
    const agentDbId = fields.agentDbId ?? null;
    const session = await getServerSession(authOptions);
    const accessContext = await loadLaunchAccessContext(session);
    const walletAccess = await assertRobinhoodLaunchWalletAccess({
      creatorWallet,
      agentDbId,
      dashboardSession: accessContext.dashboardSession,
      walletSession: accessContext.walletSession,
    });
    if (!walletAccess.ok) {
      return json(
        { error: walletAccess.error, code: walletAccess.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" },
        { status: walletAccess.status },
      );
    }
    if (agentDbId != null) {
      const access = await assertDashboardAgentAccess(session, agentDbId);
      if (!access.ok) {
        if (access.status === 404) {
          return json({ error: "Agent not found", code: "AGENT_NOT_FOUND" }, { status: 404 });
        }
        if (access.status === 401) {
          return json({ error: "Not authenticated", code: "UNAUTHORIZED" }, { status: 401 });
        }
        return json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
      }
      const agent = await prisma.agent.findUnique({
        where: { id: agentDbId },
        select: { evmWalletAddress: true, evmWalletStatus: true },
      });
      if (!agent) {
        return json({ error: "Agent not found", code: "AGENT_NOT_FOUND" }, { status: 404 });
      }
      if (
        agent.evmWalletAddress &&
        agent.evmWalletStatus === "active" &&
        creatorWallet !== agent.evmWalletAddress.toLowerCase()
      ) {
        return json(
          {
            error: "Creator wallet does not match the agent's configured EVM wallet.",
            code: "WALLET_MISMATCH",
          },
          { status: 403 },
        );
      }
    }
    const prepared = await prepareRobinhoodLaunchTransaction({
      ...fields,
      creatorWallet,
      agentDbId,
    });
    return json({
      ok: true,
      prepared: {
        chainId: prepared.chainId,
        to: prepared.to,
        data: prepared.data,
        value: prepared.value,
        signerWallet: prepared.signerWallet,
        launchConfigId: prepared.launchConfigId,
        dexId: prepared.dexId,
        launchFeeWei: prepared.launchFeeWei,
        launchFeeEth: prepared.launchFeeEth,
        gasSuggestion: prepared.gasSuggestion,
        preparationId: prepared.preparationId,
      },
      logo: prepared.logo,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
