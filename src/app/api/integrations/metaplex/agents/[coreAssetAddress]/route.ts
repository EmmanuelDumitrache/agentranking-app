import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPublicSiteUrl } from "@/lib/site-url";
import { METAPLEX_LAUNCH_REGISTRY_ID } from "@/lib/metaplex-launch/constants";
import { agentPublicPath, agentPublicUrl } from "@/lib/agent-public-url";
import { slidingWindowLimit } from "@/lib/valkey";
export const dynamic = "force-dynamic";
export const revalidate = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
async function rateLimit(ip: string): Promise<boolean> {
  const result = await slidingWindowLimit({
    key: `ratelimit:metaplex-agent-integration:${ip}`,
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  return result.success;
}
function agentProfileUrl(chainId: number, agentId: number, name: string): string {
  return agentPublicUrl(getPublicSiteUrl(), { chainId, agentId, name });
}
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ coreAssetAddress: string }> },
) {
  const ip = _request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await rateLimit(ip))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  const { coreAssetAddress } = await context.params;
  const asset = coreAssetAddress.trim();
  if (!asset) {
    return NextResponse.json({ error: "coreAssetAddress is required" }, { status: 400 });
  }
  const attempt = await prisma.metaplexLaunchAttempt.findFirst({
    where: { assetAddress: asset, status: "COMPLETE" },
    orderBy: { completedAt: "desc" },
  });
  const agent = await prisma.agent.findFirst({
    where: { metaplexAssetAddress: asset },
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      metaplexAgentTokenMint: true,
      metaplexLaunchAddress: true,
      metaplexTradeUrl: true,
      metaplexVerified: true,
      agentRankScore: true,
      metaplexLastIndexedAt: true,
    },
  });
  if (!attempt && !agent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const launchedViaAgentRanking = Boolean(attempt?.publicAttributionId || agent);
  const body = {
    coreAssetAddress: asset,
    launchedViaAgentRanking,
    attributionId: attempt?.publicAttributionId ?? null,
    arAgentId: agent?.agentId != null ? String(agent.agentId) : null,
    profilePath:
      agent?.agentId != null && agent.chainId
        ? agentPublicPath(agent)
        : null,
    profileUrl:
      agent?.agentId != null && agent.chainId
        ? agentProfileUrl(agent.chainId, agent.agentId, agent.name)
        : null,
    agentRankScore: Math.round(agent?.agentRankScore ?? 0),
    scoreVersion: "agentranking.v1",
    arVerified: agent?.metaplexVerified ?? false,
    tokenMint: attempt?.tokenMint ?? agent?.metaplexAgentTokenMint ?? null,
    genesisAddress: attempt?.genesisAddress ?? agent?.metaplexLaunchAddress ?? null,
    launchUrl: attempt?.metaplexLaunchUrl ?? agent?.metaplexTradeUrl ?? null,
    launchTransaction: attempt?.genesisTxSignature ?? null,
    agentRegistry: METAPLEX_LAUNCH_REGISTRY_ID,
    updatedAt: (attempt?.updatedAt ?? agent?.metaplexLastIndexedAt ?? new Date()).toISOString(),
  };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
