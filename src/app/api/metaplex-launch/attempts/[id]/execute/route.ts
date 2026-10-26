import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import {
  assertMetaplexLaunchAttemptAccess,
  loadMetaplexLaunchAttemptById,
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

export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
type RouteContext = { params: Promise<{ id: string }> };

function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
function validAttemptId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);

  const { id } = await context.params;
  if (!validAttemptId(id)) return jsonNoStore({ error: "Invalid attempt id" }, { status: 400 });

  const session = await getServerSession(authOptions);
  const attempt = await loadMetaplexLaunchAttemptById(id);
  if (!attempt) return jsonNoStore({ error: "Launch attempt not found" }, { status: 404 });

  const access = await assertMetaplexLaunchAttemptAccess(session, attempt.agentDbId);
  if (!access.ok) return jsonNoStore({ error: "Not authorized" }, { status: access.status });

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonObject(request, 2 * 1024);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      return jsonNoStore({ error: "Request body is too large." }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
      return jsonNoStore({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    throw error;
  }
  if (body.permanentBindConfirmed !== true) {
    return jsonNoStore({ error: "Permanent token binding confirmation is required." }, { status: 400 });
  }

  try {
    const confirmed = await patchMetaplexLaunchAttempt(id, {
      permanentBindConfirmed: true,
      errorCode: null,
      errorMessage: null,
    });
    const result = await runMetaplexLaunchPipelineServer(confirmed);
    return jsonNoStore({ attempt: serializeMetaplexLaunchAttempt(result) });
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
    console.error("[metaplex-launch/execute]", error);
    const latest = await loadMetaplexLaunchAttemptById(id);
    if (latest?.status === "COMPLETE") {
      return jsonNoStore({ attempt: serializeMetaplexLaunchAttempt(latest) });
    }
    const mapped = mapMetaplexLaunchError(error);
    await markMetaplexLaunchAttemptRecoverableFailure(id, mapped.code, mapped.message).catch((patchError) => {
      console.error("[metaplex-launch/execute] failed to persist failure", patchError);
    });
    return jsonNoStore({ error: mapped.message, code: mapped.code }, { status: 500 });
  }
}
