import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export const revalidate = 60;
const PAGE_SIZE = 50;
export async function GET(request: NextRequest) {
  const updatedSinceRaw = request.nextUrl.searchParams.get("updatedSince");
  const cursor = request.nextUrl.searchParams.get("cursor")?.trim() || null;
  const updatedSince = updatedSinceRaw ? new Date(updatedSinceRaw) : null;
  if (updatedSinceRaw && Number.isNaN(updatedSince?.getTime())) {
    return NextResponse.json({ error: "Invalid updatedSince" }, { status: 400 });
  }
  const rows = await prisma.metaplexLaunchAttempt.findMany({
    where: {
      status: "COMPLETE",
      ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      assetAddress: true,
      publicAttributionId: true,
      tokenMint: true,
      genesisAddress: true,
      metaplexLaunchUrl: true,
      genesisTxSignature: true,
      arAgentId: true,
      updatedAt: true,
      completedAt: true,
    },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;
  const items = await Promise.all(
    page
      .filter((row) => row.assetAddress)
      .map(async (row) => {
        const agent = row.arAgentId
          ? await prisma.agent.findUnique({
              where: { id: row.arAgentId },
              select: {
                agentId: true,
                chainId: true,
                agentRankScore: true,
                metaplexVerified: true,
              },
            })
          : null;
        return {
          coreAssetAddress: row.assetAddress,
          launchedViaAgentRanking: true,
          attributionId: row.publicAttributionId,
          arAgentId: agent?.agentId ?? null,
          agentRankScore: Math.round(agent?.agentRankScore ?? 0),
          scoreVersion: "agentranking.v1",
          arVerified: agent?.metaplexVerified ?? false,
          tokenMint: row.tokenMint,
          genesisAddress: row.genesisAddress,
          launchUrl: row.metaplexLaunchUrl,
          launchTransaction: row.genesisTxSignature ?? null,
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
  );
  return NextResponse.json(
    { items, nextCursor },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
