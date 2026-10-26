import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";
import { mapWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import { recordRobinhoodFeeClaimFromTx } from "@/lib/robinhood-chain/fee-claim.server";
import { RobinhoodLaunchError } from "@/lib/robinhood-chain/errors";

export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
type RouteContext = { params: Promise<{ agentDbId: string; launchId: string }> };

const RecordClaimBodySchema = z.strictObject({
  claimTxHash: z.string().trim().optional(),
  claimTxHashes: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
});

function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
function validOpaqueId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function normalizeHashes(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^0x[a-fA-F0-9]{64}$/.test(item))
    .map((item) => item.toLowerCase()))];
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { agentDbId: agentDbIdParam, launchId } = await context.params;
  const agentDbId = /^\d+$/.test(agentDbIdParam) ? Number(agentDbIdParam) : Number.NaN;
  if (!Number.isSafeInteger(agentDbId) || agentDbId <= 0) {
    return jsonNoStore({ ok: false, error: "Invalid agent id" }, { status: 400 });
  }
  if (!validOpaqueId(launchId)) {
    return jsonNoStore({ ok: false, error: "Invalid launch id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return jsonNoStore({ ok: false, error: "Forbidden" }, { status: access.status });

  const launch = await prisma.robinhoodChainLaunch.findFirst({ where: { id: launchId, agentDbId } });
  if (!launch) return jsonNoStore({ ok: false, error: "Launch not found" }, { status: 404 });

  let body: z.infer<typeof RecordClaimBodySchema>;
  try {
    body = await parseBoundedJsonBody(request, RecordClaimBodySchema, 4 * 1024);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore({ ok: false, error: "Invalid request body" }, { status: 400 });
    }
    if (error instanceof HttpBodyTooLargeError) {
      return jsonNoStore({ ok: false, error: "Request body is too large" }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
      return jsonNoStore({ ok: false, error: "Request body must be valid JSON" }, { status: 400 });
    }
    throw error;
  }

  const claimTxHashes = normalizeHashes(body.claimTxHashes ?? body.claimTxHash);
  if (claimTxHashes.length === 0) {
    return jsonNoStore({ ok: false, error: "At least one valid claim transaction hash is required" }, { status: 400 });
  }
  if (claimTxHashes.length > 8) {
    return jsonNoStore({ ok: false, error: "At most 8 claim transactions may be recorded at once" }, { status: 400 });
  }

  try {
    const recorded = await mapWithConcurrency(claimTxHashes, 2, async (claimTxHash) => ({
      txHash: claimTxHash,
      ...(await recordRobinhoodFeeClaimFromTx({
        launchId: launch.id,
        agentDbId,
        tokenAddress: launch.tokenAddress,
        positionId: launch.positionId ?? "0",
        creatorWallet: launch.creatorWallet,
        claimTxHash,
        feeSplitterAddress: launch.feeSplitterAddress,
      })),
    }));
    return jsonNoStore({ ok: true, recorded });
  } catch (error) {
    if (error instanceof RobinhoodLaunchError) {
      return jsonNoStore({ ok: false, error: error.message, code: error.code }, { status: 400 });
    }
    const message = Error.isError(error) ? error.message : "Could not record claim";
    return jsonNoStore({ ok: false, error: message }, { status: 400 });
  }
}
