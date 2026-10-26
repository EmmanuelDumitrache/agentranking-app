import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatEther } from "viem";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";
import { mapWithConcurrency } from "@/lib/async-pool";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import { getLaunchWalletSession } from "@/lib/launch-wallet-session/session";
import { assertLaunchWalletOwnsRobinhoodLaunch } from "@/lib/public-launch/my-launches.server";
import {
  getRobinhoodClaimableFeesForLaunch,
  prepareRobinhoodFeeClaimTransaction,
  recordRobinhoodFeeClaimFromTx,
} from "@/lib/robinhood-chain/fee-claim.server";
import { getEthUsdPrice } from "@/lib/eth-price";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
type RouteContext = { params: Promise<{ launchId: string }> };

const PrepareFeesBodySchema = z.strictObject({
  force: z.boolean().optional(),
});

const RecordFeesBodySchema = z.strictObject({
  txHash: z.string().trim().optional(),
  txHashes: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
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
async function limited(request: NextRequest): Promise<NextResponse | null> {
  const response = await rateLimitPublicApi(request, "standard");
  if (response) response.headers.set("Cache-Control", "no-store");
  return response;
}
async function ownedLaunch(request: NextRequest, launchId: string) {
  const rateLimited = await limited(request);
  if (rateLimited) return { response: rateLimited } as const;
  if (!validOpaqueId(launchId)) {
    return { response: jsonNoStore({ ok: false, error: "Invalid launch id" }, { status: 400 }) } as const;
  }
  const session = await getLaunchWalletSession();
  if (!session || session.chain !== "evm") {
    return { response: jsonNoStore({ ok: false, error: "EVM wallet session required" }, { status: 401 }) } as const;
  }
  const owned = await assertLaunchWalletOwnsRobinhoodLaunch(launchId, session.wallet);
  if (!owned.ok) {
    return { response: jsonNoStore({ ok: false, error: owned.error }, { status: owned.status }) } as const;
  }
  return { owned } as const;
}
function bodyError(error: unknown): NextResponse | null {
  if (error instanceof z.ZodError) {
    return jsonNoStore({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  if (error instanceof HttpBodyTooLargeError) {
    return jsonNoStore({ ok: false, error: "Request body is too large" }, { status: 413 });
  }
  if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
    return jsonNoStore({ ok: false, error: "Request body must be valid JSON" }, { status: 400 });
  }
  return null;
}
export async function GET(request: NextRequest, context: RouteContext) {
  const { launchId } = await context.params;
  const access = await ownedLaunch(request, launchId);
  if ("response" in access) return access.response;
  const launch = access.owned.launch;
  try {
    const fees = await getRobinhoodClaimableFeesForLaunch({
      tokenAddress: launch.tokenAddress,
      creatorWallet: launch.creatorWallet,
      poolAddress: launch.poolAddress,
      positionId: launch.positionId,
      feeSplitterAddress: launch.feeSplitterAddress,
    });
    const creatorFeeBps = fees.creatorFeeBps;
    const splitEnabled = fees.feeSplitEnabled;
    const creatorNetWei = splitEnabled
      ? (fees.claimableWei * BigInt(creatorFeeBps)) / 10_000n
      : fees.claimableWei;
    const creatorNetWeth = formatEther(creatorNetWei);
    const creatorNetTokenRaw = splitEnabled
      ? (fees.claimableTokenRaw * BigInt(creatorFeeBps)) / 10_000n
      : fees.claimableTokenRaw;
    const ethPrice = await getEthUsdPrice().catch(() => null);
    const claimableUsd = ethPrice != null && creatorNetWei > 0n
      ? (Number(creatorNetWeth) * ethPrice).toFixed(2)
      : null;
    return jsonNoStore({
      ok: true,
      canClaim: fees.canClaim,
      reason: fees.reason,
      claimableWeth: creatorNetWeth,
      claimableWei: creatorNetWei.toString(),
      claimableTokenRaw: creatorNetTokenRaw.toString(),
      hasIndexedFees: creatorNetWei > 0n || creatorNetTokenRaw > 0n,
      claimableUsd,
      creatorWallet: fees.creatorWallet,
      tokenAddress: fees.tokenAddress,
      checkedAt: fees.checkedAt,
      feeSplitEnabled: splitEnabled,
      creatorFeeBps,
      arFeeBps: fees.arFeeBps,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load claimable fees";
    return jsonNoStore({ ok: false, error: message }, { status: 502 });
  }
}
export async function POST(request: NextRequest, context: RouteContext) {
  const { launchId } = await context.params;
  const access = await ownedLaunch(request, launchId);
  if ("response" in access) return access.response;
  let body: z.infer<typeof PrepareFeesBodySchema>;
  try {
    body = await parseBoundedJsonBody(request, PrepareFeesBodySchema, 2 * 1024);
  } catch (error) {
    const response = bodyError(error);
    if (response) return response;
    throw error;
  }
  try {
    const prepared = await prepareRobinhoodFeeClaimTransaction({
      tokenAddress: access.owned.launch.tokenAddress,
      creatorWallet: access.owned.launch.creatorWallet,
      feeSplitterAddress: access.owned.launch.feeSplitterAddress,
      force: body.force === true,
    });
    return jsonNoStore({ ok: true, prepared, force: body.force === true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare claim";
    return jsonNoStore({ ok: false, error: message }, { status: 400 });
  }
}
export async function PUT(request: NextRequest, context: RouteContext) {
  const { launchId } = await context.params;
  const access = await ownedLaunch(request, launchId);
  if ("response" in access) return access.response;
  const launch = access.owned.launch;
  if (!launch.agentDbId || launch.agentDbId <= 0) {
    return jsonNoStore({ ok: false, error: "Launch is not linked to an AgentRanking agent" }, { status: 409 });
  }
  let body: z.infer<typeof RecordFeesBodySchema>;
  try {
    body = await parseBoundedJsonBody(request, RecordFeesBodySchema, 4 * 1024);
  } catch (error) {
    const response = bodyError(error);
    if (response) return response;
    throw error;
  }
  const txHashes = normalizeHashes(body.txHashes ?? body.txHash);
  if (txHashes.length === 0) {
    return jsonNoStore({ ok: false, error: "At least one valid transaction hash is required" }, { status: 400 });
  }
  if (txHashes.length > 8) {
    return jsonNoStore({ ok: false, error: "At most 8 claim transactions may be recorded at once" }, { status: 400 });
  }
  try {
    const recorded = await mapWithConcurrency(txHashes, 2, async (txHash) => ({
      txHash,
      ...(await recordRobinhoodFeeClaimFromTx({
        launchId: launch.id,
        agentDbId: launch.agentDbId!,
        tokenAddress: launch.tokenAddress,
        positionId: launch.positionId ?? "0",
        creatorWallet: launch.creatorWallet,
        claimTxHash: txHash,
        feeSplitterAddress: launch.feeSplitterAddress,
      })),
    }));
    return jsonNoStore({ ok: true, recorded });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record claim";
    return jsonNoStore({ ok: false, error: message }, { status: 400 });
  }
}
