import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueApplicationJob } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  MissingHttpContentLengthError,
  assertDeclaredHttpBodyWithinLimit,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

const FairscaleEventSchema = z.strictObject({
  eventType: z.enum([
    "fairscale_card_viewed",
    "fairscale_breakdown_opened",
    "fairscale_methodology_clicked",
    "fairscale_assessment_requested",
    "fairscale_assessment_succeeded",
    "fairscale_assessment_failed",
    "fairscale_unavailable_state_shown",
  ]),
  agentDbId: z.number().int().positive().optional(),
  eventId: z.string().trim().max(96).optional(),
});

function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
export async function POST(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }
  try {
    assertDeclaredHttpBodyWithinLimit(request, MAX_BODY_BYTES, { required: true });
  } catch (error) {
    if (error instanceof MissingHttpContentLengthError) {
      return jsonNoStore({ error: "Content-Length is required" }, { status: 411 });
    }
    if (error instanceof HttpBodyTooLargeError) {
      return jsonNoStore({ error: "Request body is too large" }, { status: 413 });
    }
    throw error;
  }
  let body: z.infer<typeof FairscaleEventSchema>;
  try {
    body = await parseBoundedJsonBody(request, FairscaleEventSchema, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: "Invalid event" }, { status: 400 });
    }
    if (error instanceof HttpBodyTooLargeError) {
      return jsonNoStore({ error: "Request body is too large" }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
      return jsonNoStore({ error: "Invalid JSON" }, { status: 400 });
    }
    throw error;
  }
  const agentDbId = body.agentDbId ?? null;
  const suppliedEventId = body.eventId ?? "";
  const idempotencyKey = `fairscale:${suppliedEventId || randomUUID()}`;
  try {
    const jobId = await enqueueApplicationJob(
      JOB_QUEUES.ANALYTICS_CONVERSION_TRACK,
      {
        v: 1,
        idempotencyKey,
        eventType: body.eventType,
        path: agentDbId ? `/agents/fairscale/${agentDbId}` : "/agents/fairscale",
        productType: "fairscale",
      },
      { singletonKey: idempotencyKey },
    );
    if (!jobId) return jsonNoStore({ error: "Event queue unavailable" }, { status: 503 });
    return jsonNoStore({ accepted: true }, { status: 202 });
  } catch (error) {
    console.error("[fairscale/events] enqueue failed", error);
    return jsonNoStore({ error: "Event queue unavailable" }, { status: 503 });
  }
}
