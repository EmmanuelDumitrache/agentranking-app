import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import { getPublicSiteUrl } from "@/lib/site-url";
import { agentPublicPath, agentPublicUrl, toAgentUrlSlug } from "@/lib/agent-public-url";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "X-API-Version": "1",
};
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
/**
 * GET /api/v1/wallets/:address/agents
 *
 * Returns all active agents owned by the given wallet address.
 * Address matching is case-insensitive.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  if (!address || !address.startsWith("0x")) {
    return NextResponse.json(
      { error: "Invalid wallet address" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  try {
    const where = await extendAgentWhereIndexable({
      owner: { equals: address, mode: "insensitive" },
    });
    const agents = await prisma.agent.findMany({
      where,
      orderBy: { score: "desc" },
      take: 100,
      select: {
        agentId: true,
        chainId: true,
        name: true,
        description: true,
        image: true,
        owner: true,
        score: true,
        rank: true,
        x402Support: true,
        stars: true,
        totalFeedback: true,
        isVerified: true,
        isPremiumVerified: true,
        binanceCompatible: true,
        isActive: true,
        createdAt: true,
        lastActiveAt: true,
        supportedTrust: true,
        chain: { select: { name: true, shortName: true, color: true } },
        services: { select: { name: true, endpoint: true, version: true } },
        metadata: { select: { key: true, value: true } },
      },
    });
    const formatted = agents.map((a) => ({
      agentId: a.agentId,
      chainId: a.chainId,
      name: a.name,
      slug: toAgentUrlSlug(a.name),
      profilePath: agentPublicPath(a),
      description: a.description,
      image: a.image,
      owner: a.owner,
      score: a.score,
      rank: a.rank,
      x402Support: a.x402Support,
      stars: a.stars,
      totalFeedback: a.totalFeedback,
      isVerified: a.isVerified,
      isPremiumVerified: a.isPremiumVerified,
      binanceCompatible: a.binanceCompatible,
      isActive: a.isActive,
      createdAt: a.createdAt,
      lastActiveAt: a.lastActiveAt,
      supportedTrust: a.supportedTrust,
      chain: a.chain,
      services: a.services,
      profileUrl: agentPublicUrl(getPublicSiteUrl(), a),
    }));
    return NextResponse.json(
      {
        data: formatted,
        meta: {
          address,
          total: formatted.length,
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", message: Error.isError(err) ? err.message : String(err) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
