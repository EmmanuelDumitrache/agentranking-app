import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getFairscaleAssessmentForAgent,
  refreshFairscaleAssessmentForAgent,
} from "@/lib/fairscale/assess.server";
import {
  fairscaleAutoRefreshEnabled,
  fairscaleEnabled,
  resolveFairscaleScoreSource,
} from "@/lib/fairscale/config";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
export const dynamic = "force-dynamic";
type RouteParams = { params: Promise<{ chainId: string; agentId: string }> };
function jsonNoStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(body, { ...init, headers });
}
function parsePositiveInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
async function resolveAgentDbId(chainIdRaw: string, agentIdRaw: string): Promise<number | null> {
  const chainId = parsePositiveInt(chainIdRaw);
  const agentId = parsePositiveInt(agentIdRaw);
  if (chainId === null || agentId === null) return null;
  const agent = await prisma.agent.findFirst({
    where: { chainId, agentId },
    select: { id: true },
  });
  return agent?.id ?? null;
}
export async function GET(request: NextRequest, { params }: RouteParams) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  if (!fairscaleEnabled()) {
    return jsonNoStore({ enabled: false, assessment: null }, { status: 404 });
  }
  const { chainId, agentId } = await params;
  const agentDbId = await resolveAgentDbId(chainId, agentId);
  if (agentDbId === null) return jsonNoStore({ error: "Agent not found" }, { status: 404 });
  const assessment = await getFairscaleAssessmentForAgent(agentDbId, {
    queueRefresh: fairscaleAutoRefreshEnabled(),
  });
  return jsonNoStore({
    enabled: true,
    assessment,
    autoRefresh: fairscaleAutoRefreshEnabled(),
  });
}
export async function POST(request: NextRequest, { params }: RouteParams) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  if (!fairscaleEnabled()) {
    return jsonNoStore({ enabled: false, assessment: null }, { status: 404 });
  }
  const { chainId, agentId } = await params;
  const agentDbId = await resolveAgentDbId(chainId, agentId);
  if (agentDbId === null) return jsonNoStore({ error: "Agent not found" }, { status: 404 });
  try {
    const result = await refreshFairscaleAssessmentForAgent(agentDbId);
    return jsonNoStore(
      {
        enabled: true,
        assessment: result.assessment,
        requested: result.enqueued,
        refreshed: false,
        cooldown: result.cooldown,
        endpoint:
          resolveFairscaleScoreSource() === "agent" ? "agent:/v1/score" : "human:/score",
      },
      { status: result.enqueued ? 202 : 200 },
    );
  } catch (error) {
    console.error("[fairscale] failed to enqueue assessment refresh", {
      agentDbId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore(
      { error: "FairScale refresh could not be scheduled" },
      { status: 503 },
    );
  }
}
