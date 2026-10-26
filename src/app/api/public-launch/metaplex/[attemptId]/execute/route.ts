import { NextRequest, NextResponse } from "next/server";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import {
  assertPublicMetaplexLaunchEnabled,
  assertPublicOwnsMetaplexAttempt,
  getPublicMetaplexFundingStatus,
  requirePublicMetaplexSolanaSession,
} from "@/lib/public-launch/metaplex-quick-launch.server";
import {
  markMetaplexLaunchAttemptRecoverableFailure,
  MetaplexAttemptStateConflictError,
  patchMetaplexLaunchAttempt,
} from "@/lib/metaplex-launch/attempt-store.server";
import {
  MetaplexAttemptBusyError,
  MetaplexAttemptLeaseLostError,
} from "@/lib/metaplex-launch/attempt-execution-lease.server";
import { mapMetaplexLaunchError } from "@/lib/metaplex-launch/errors";
import { runMetaplexLaunchPipelineServer } from "@/lib/metaplex-launch/pipeline.server";
import { serializeMetaplexLaunchAttempt } from "@/lib/metaplex-launch/serialize";
import { isValidIrysGatewayUrl, normalizeIrysGatewayUrl } from "@/lib/metaplex-launch/validation";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
function validAttemptId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
async function enforceRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) limited.headers.set("Cache-Control", "no-store");
  return limited;
}
function invalidBodyResponse(error: unknown): NextResponse | null {
  if (error instanceof HttpBodyTooLargeError) {
    return jsonNoStore({ error: "Request body is too large." }, { status: 413 });
  }
  if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
    return jsonNoStore({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  return null;
}
type RouteContext = { params: Promise<{ attemptId: string }> };
export async function POST(request: NextRequest, context: RouteContext) {
  const limited = await enforceRateLimit(request);
  if (limited) return limited;
  const enabled = assertPublicMetaplexLaunchEnabled();
  if (!enabled.ok) return jsonNoStore({ error: enabled.error }, { status: enabled.status });
  const session = await requirePublicMetaplexSolanaSession();
  if (!session.ok) return jsonNoStore({ error: session.error }, { status: session.status });
  const { attemptId } = await context.params;
  if (!validAttemptId(attemptId)) return jsonNoStore({ error: "Invalid attempt id" }, { status: 400 });
  const ownership = await assertPublicOwnsMetaplexAttempt(attemptId, session.creatorWallet);
  if (!ownership.ok) return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonObject(request, 2 * 1024);
  } catch (error) {
    const response = invalidBodyResponse(error);
    if (response) return response;
    throw error;
  }
  if (body.permanentBindConfirmed !== true) {
    return jsonNoStore({ error: "Permanent token binding confirmation is required." }, { status: 400 });
  }
  const funding = await getPublicMetaplexFundingStatus({ attemptId, creatorWallet: session.creatorWallet });
  if (!funding.funded) {
    return jsonNoStore({
      error: funding.fundingMessage,
      custodialWallet: funding.custodialWallet,
      balanceLamports: funding.balanceLamports,
      minLamports: funding.minLamports,
      shortfallLamports: funding.shortfallLamports,
      stage: funding.stage,
    }, { status: 402 });
  }
  const imageUri = normalizeIrysGatewayUrl(ownership.attempt.imageUri ?? "") ?? ownership.attempt.imageUri?.trim() ?? "";
  if (!isValidIrysGatewayUrl(imageUri)) {
    return jsonNoStore({ error: "Upload the token image to Irys after funding, then launch." }, { status: 400 });
  }
  try {
    const confirmed = await patchMetaplexLaunchAttempt(attemptId, {
      permanentBindConfirmed: true,
      errorCode: null,
      errorMessage: null,
    });
    const result = await runMetaplexLaunchPipelineServer(confirmed);
    return jsonNoStore({ ok: true, attempt: serializeMetaplexLaunchAttempt(result) });
  } catch (error) {
    if (
      error instanceof MetaplexAttemptBusyError ||
      error instanceof MetaplexAttemptLeaseLostError ||
      error instanceof MetaplexAttemptStateConflictError
    ) {
      return jsonNoStore(
        { error: error.message, retryable: true },
        { status: 409 },
      );
    }
    console.error("[public-launch/metaplex/execute]", error);
    const mapped = mapMetaplexLaunchError(error);
    await markMetaplexLaunchAttemptRecoverableFailure(
      attemptId,
      mapped.code,
      mapped.message,
    ).catch((patchError) => {
      console.error("[public-launch/metaplex/execute] failed to persist failure", patchError);
    });
    return jsonNoStore({ error: mapped.message, code: mapped.code }, { status: 500 });
  }
}
