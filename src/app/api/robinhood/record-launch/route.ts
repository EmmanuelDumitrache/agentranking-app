import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  HttpBodyTooLargeError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import {
  assertRobinhoodLaunchWalletAccess,
  loadLaunchAccessContext,
} from "@/lib/launch-wallet-session/auth";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import {
  ROBINHOOD_LAUNCH_ERROR,
  RobinhoodLaunchError,
} from "@/lib/robinhood-chain/errors";
import {
  getRobinhoodLaunchPreparationAccess,
  recordRobinhoodLaunchFromTx,
} from "@/lib/robinhood-chain/record-launch.server";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const TRANSACTION_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const PREPARATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
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
    const status =
      error.code === ROBINHOOD_LAUNCH_ERROR.RECEIPT_TIMEOUT
        ? 408
        : error.code === ROBINHOOD_LAUNCH_ERROR.PREPARATION_NOT_FOUND
          ? 404
          : error.code === ROBINHOOD_LAUNCH_ERROR.PREPARATION_USED
            ? 409
            : 400;
    return json({ error: error.message, code: error.code }, { status });
  }
  const message = Error.isError(error) ? error.message : "Could not record launch";
  return json({ error: message, code: "RECORD_FAILED" }, { status: 400 });
}
export async function POST(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  try {
    const body = await readBoundedJsonObject(request, 4 * 1024);
    const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
    const preparationId = typeof body.preparationId === "string" ? body.preparationId.trim() : "";
    if (!TRANSACTION_HASH_RE.test(txHash)) {
      return json({ error: "A valid txHash is required.", code: "INVALID_TX_HASH" }, { status: 400 });
    }
    if (!PREPARATION_ID_RE.test(preparationId)) {
      return json({ error: "A valid preparationId is required.", code: "PREPARATION_REQUIRED" }, { status: 400 });
    }
    const preparation = await getRobinhoodLaunchPreparationAccess(preparationId);
    if (!preparation) {
      return json({ error: "Launch preparation was not found.", code: "PREPARATION_NOT_FOUND" }, { status: 404 });
    }
    const session = await getServerSession(authOptions);
    const accessContext = await loadLaunchAccessContext(session);
    const access = await assertRobinhoodLaunchWalletAccess({
      creatorWallet: preparation.creatorWallet,
      agentDbId: preparation.agentDbId,
      dashboardSession: accessContext.dashboardSession,
      walletSession: accessContext.walletSession,
    });
    if (!access.ok) {
      return json(
        { error: access.error, code: access.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" },
        { status: access.status },
      );
    }
    const launch = await recordRobinhoodLaunchFromTx({
      txHash,
      preparationId,
      launchedViaAgentRanking: true,
    });
    return json({ ok: true, launch });
  } catch (error) {
    return errorResponse(error);
  }
}
