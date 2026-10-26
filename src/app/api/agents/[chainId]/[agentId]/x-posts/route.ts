import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { resolveAgentTwitterHandle } from "@/lib/agent-twitter-handle";
import { X_LATEST_POSTS_METADATA_KEY } from "@/lib/agent-x-posts";
import { getCachedXLatestPosts } from "@/lib/social/x-latest-posts-cache";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
export const dynamic = "force-dynamic";
type RouteParams = { params: Promise<{ chainId: string; agentId: string }> };
/** GET /api/agents/[chainId]/[agentId]/x-posts — read-only DB cache; never calls X API. */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { chainId: chainIdStr, agentId: agentIdStr } = await params;
  const chainId = parsePublicChainId(chainIdStr);
  const agentId = parsePublicAgentId(agentIdStr);
  if (chainId == null || agentId == null) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }
  try {
    const metaKeys = [X_LATEST_POSTS_METADATA_KEY, "twitter", "x"] as const;
    const agent = await withTransientPoolRetry(() =>
      prisma.agent.findUnique({
        where: { agentId_chainId: { agentId, chainId } },
        select: {
          chainId: true,
          agentId: true,
          metadata: {
            where: { key: { in: [...metaKeys] } },
            select: { key: true, value: true },
          },
          services: {
            where: {
              OR: [
                { endpoint: { contains: "x.com", mode: "insensitive" } },
                { endpoint: { contains: "twitter.com", mode: "insensitive" } },
              ],
            },
            select: { name: true, endpoint: true },
          },
        },
      }),
    );
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const handle = resolveAgentTwitterHandle({
      chainId: agent.chainId,
      agentId: agent.agentId,
      metadata: agent.metadata,
      services: agent.services,
    });
    if (!handle) {
      return NextResponse.json({ handle: null, posts: [], source: "none" as const });
    }
    const postsMeta = agent.metadata.find((m) => m.key === X_LATEST_POSTS_METADATA_KEY)?.value;
    const { posts, source, embedBlocked } = getCachedXLatestPosts(handle, postsMeta);
    return NextResponse.json(
      { handle, posts, source, embedBlocked },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("GET x-posts error:", { chainId, agentId, error: msg });
    return NextResponse.json(
      { handle: null, posts: [], source: "none" as const, degraded: true },
      { status: 200 },
    );
  }
}
