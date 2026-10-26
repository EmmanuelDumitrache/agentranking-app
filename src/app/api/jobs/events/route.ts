import { NextRequest, NextResponse } from "next/server";
import { isAllowedJobEventType, recordJobInteractionEvent } from "@/lib/jobs/events";
import { getClientIp } from "@/lib/public-api-rate-limit";
import { valkeySetStringNxPx } from "@/lib/valkey";
export const dynamic = "force-dynamic";
const THROTTLE_MS = 10_000;
async function shouldThrottle(key: string): Promise<boolean> {
  const accepted = await valkeySetStringNxPx(
    `throttle:jobs-event:${key}`,
    "1",
    THROTTLE_MS,
  );
  return !accepted;
}
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      eventType?: string;
      jobId?: string;
      agentId?: number;
      source?: string;
      metadata?: Record<string, unknown>;
    };
    const eventType = body.eventType?.trim();
    if (!eventType || !isAllowedJobEventType(eventType)) {
      return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
    }
    const ip = getClientIp(request);
    const throttleKey = `${ip}:${eventType}:${body.jobId ?? "none"}:${body.agentId ?? "none"}`;
    if (await shouldThrottle(throttleKey)) {
      return NextResponse.json({ ok: true });
    }
    await recordJobInteractionEvent({
      eventType,
      jobId: typeof body.jobId === "string" ? body.jobId : undefined,
      agentId:
        typeof body.agentId === "number" && Number.isFinite(body.agentId)
          ? body.agentId
          : undefined,
      source: typeof body.source === "string" ? body.source.slice(0, 64) : undefined,
      metadata: body.metadata,
      ip,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }
}
