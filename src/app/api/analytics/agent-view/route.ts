import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { getClientIp } from "@/lib/public-api-rate-limit";
import { slidingWindowLimit } from "@/lib/valkey";

const AgentViewEventSchema = z.strictObject({
  agentId: z.number().int().positive(),
  eventType: z.enum(["view", "click_endpoint", "click_verify"]).default("view"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseBoundedJsonBody(request, AgentViewEventSchema, 8 * 1024);
    const { agentId, eventType } = body;
    const ip = getClientIp(request);
    if (ip !== "unknown") {
      const result = await slidingWindowLimit({
        key: `ratelimit:agent-view:${ip}:${agentId}:${eventType}`,
        limit: 1,
        windowMs: 10 * 60_000,
      });
      if (!result.success) return new NextResponse(null, { status: 204 });
    }
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } });
    if (!agent) return new NextResponse(null, { status: 204 });
    await prisma.agentAnalyticsEvent.create({ data: { agentId, eventType } });
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
