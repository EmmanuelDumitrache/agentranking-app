import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  assertMetaplexLaunchAttemptAccess,
  loadMetaplexLaunchAttemptById,
  markMetaplexLaunchAttemptRecoverableFailure,
  MetaplexAttemptStateConflictError,
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

export async function POST(_request: Request, context: RouteContext) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);

  const { id } = await context.params;
  if (!validAttemptId(id)) {
    return jsonNoStore({ error: "Invalid attempt id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const attempt = await loadMetaplexLaunchAttemptById(id);
  if (!attempt) {
    return jsonNoStore({ error: "Launch attempt not found" }, { status: 404 });
  }

  const access = await assertMetaplexLaunchAttemptAccess(session, attempt.agentDbId);
  if (!access.ok) {
    return jsonNoStore({ error: "Not authorized" }, { status: access.status });
  }
  if (!['GENESIS_REGISTERED', 'AR_INDEX_PENDING'].includes(attempt.status)) {
    return jsonNoStore({ error: "Launch is not ready for indexing." }, { status: 409 });
  }

  try {
    // Use the same durable PostgreSQL execution lease as the full launch
    // pipeline. Calling the index stage directly allowed a concurrent execute
    // request to mutate the same attempt and publish duplicate work.
    const result = await runMetaplexLaunchPipelineServer(attempt);
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
    const mapped = mapMetaplexLaunchError(error);
    await markMetaplexLaunchAttemptRecoverableFailure(
      id,
      mapped.code,
      mapped.message,
    ).catch((patchError) => {
      console.error("[metaplex-launch/index] failed to persist failure", patchError);
    });
    return jsonNoStore(
      { error: mapped.message, code: mapped.code },
      { status: 500 },
    );
  }
}
