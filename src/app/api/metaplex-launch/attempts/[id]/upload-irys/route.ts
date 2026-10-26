import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  HttpBodyTooLargeError,
  MissingHttpContentLengthError,
  assertDeclaredHttpBodyWithinLimit,
} from "@/lib/bounded-http-body";
import {
  assertMetaplexLaunchAttemptAccess,
  loadMetaplexLaunchAttemptById,
  MetaplexAttemptStateConflictError,
  resetMetaplexLaunchAttemptDraftImage,
} from "@/lib/metaplex-launch/attempt-store.server";
import {
  MetaplexAttemptBusyError,
  MetaplexAttemptLeaseLostError,
  withMetaplexAttemptExecutionLease,
} from "@/lib/metaplex-launch/attempt-execution-lease.server";
import { uploadBytesToIrys } from "@/lib/metaplex-launch/pipeline.server";
import { serializeMetaplexLaunchAttempt } from "@/lib/metaplex-launch/serialize";
import {
  isValidIrysGatewayUrl,
  normalizeIrysGatewayUrl,
} from "@/lib/metaplex-launch/validation";

export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_MULTIPART_SIZE = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
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
  try {
    assertDeclaredHttpBodyWithinLimit(request, MAX_MULTIPART_SIZE, { required: true });
  } catch (error) {
    if (error instanceof MissingHttpContentLengthError) {
      return jsonNoStore({ error: "Content-Length is required for uploads." }, { status: 411 });
    }
    if (error instanceof HttpBodyTooLargeError) {
      return jsonNoStore({ error: "Upload request is too large." }, { status: 413 });
    }
    throw error;
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonNoStore({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonNoStore({ error: "No file provided" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    return jsonNoStore({ error: "Invalid file size" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return jsonNoStore({ error: "File must be PNG, JPEG, or WebP" }, { status: 400 });
  }

  try {
    const result = await withMetaplexAttemptExecutionLease(id, async (signal) => {
      const current = await loadMetaplexLaunchAttemptById(id);
      if (!current) throw new Error("Launch attempt not found");
      if (
        !["DRAFT", "METADATA_READY"].includes(current.status) ||
        current.assetAddress?.trim()
      ) {
        throw new MetaplexAttemptStateConflictError(
          id,
          "DRAFT or METADATA_READY",
          current.status,
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const uploaded = await uploadBytesToIrys({
        agentDbId: current.agentDbId,
        network: current.network,
        bytes,
        fileName: file.name || "token-image.png",
        contentType: file.type,
      });
      if (signal.aborted) throw signal.reason;
      const imageUri = normalizeIrysGatewayUrl(uploaded.uri);
      if (!imageUri || !isValidIrysGatewayUrl(imageUri)) {
        throw new Error("Irys upload returned an invalid gateway URL.");
      }
      const snapshot = (current.inputSnapshot ?? {}) as Record<string, unknown>;
      const updated = await resetMetaplexLaunchAttemptDraftImage({
        id: id,
        expectedStatus: current.status as "DRAFT" | "METADATA_READY",
        imageUri,
        inputSnapshot: {
          ...snapshot,
          tokenImageUrl: imageUri,
          tokenImageContentType: uploaded.contentType,
        },
      });
      return { imageUri, attempt: updated };
    });
    return jsonNoStore({
      imageUri: result.imageUri,
      attempt: serializeMetaplexLaunchAttempt(result.attempt),
    });
  } catch (error) {
    if (
      error instanceof MetaplexAttemptBusyError ||
      error instanceof MetaplexAttemptLeaseLostError ||
      error instanceof MetaplexAttemptStateConflictError
    ) {
      return jsonNoStore({ error: error.message, retryable: true }, { status: 409 });
    }
    console.error("[metaplex-launch/upload-irys]", error);
    const message = error instanceof Error ? error.message : "Irys upload failed";
    return jsonNoStore({ error: message }, { status: 502 });
  }
}
