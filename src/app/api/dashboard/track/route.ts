import { NextRequest, NextResponse } from "next/server";
import { recordDashboardAnalyticsEvent } from "@/lib/dashboard/analytics";
import { prisma } from "@/lib/db";
import { getClientIp } from "@/lib/public-api-rate-limit";
import { valkeySetStringNxPx } from "@/lib/valkey";
export const dynamic = "force-dynamic";
const ALLOWED_EVENT_TYPES = new Set([
  "view",
  "search_impression",
  "click_endpoint",
  "click_service",
  "click_x402",
  "paid_service_view",
  "paid_service_click",
]);
const THROTTLE_MS = 10_000;
async function shouldThrottle(key: string): Promise<boolean> {
  const accepted = await valkeySetStringNxPx(
    `throttle:dashboard-track:${key}`,
    "1",
    THROTTLE_MS,
  );
  return !accepted;
}
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      agentId?: number;
      eventType?: string;
      serviceId?: number;
    };
    const agentId = body.agentId;
    const eventType = body.eventType?.trim();
    const serviceId =
      typeof body.serviceId === "number" && Number.isFinite(body.serviceId)
        ? body.serviceId
        : undefined;
    if (!agentId || !eventType) {
      return NextResponse.json({ error: "agentId and eventType required" }, { status: 400 });
    }
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
    }
    const agentExists = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true },
    });
    if (!agentExists) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    if (serviceId != null && eventType === "click_service") {
      const service = await prisma.agentService.findFirst({
        where: { id: serviceId, agentId },
        select: { id: true },
      });
      if (!service) {
        return NextResponse.json({ error: "Service not found for agent" }, { status: 400 });
      }
    }
    const ip = getClientIp(request);
    const throttleKey = `${ip}:${agentId}:${eventType}:${serviceId ?? "none"}`;
    if (await shouldThrottle(throttleKey)) {
      return NextResponse.json({ ok: true });
    }
    await recordDashboardAnalyticsEvent(agentId, eventType, serviceId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }
}
