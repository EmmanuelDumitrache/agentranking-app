import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAgentActivity } from "@/lib/blockchain/fetch-activity";
import { enqueueApplicationJob } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
/** Cache TTL in milliseconds — skip live fetch if data is fresher than this. */
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
type RouteParams = { params: Promise<{ chainId: string; agentId: string }> };
/**
 * GET /api/agents/[chainId]/[agentId]/activity
 *
 * Returns recent on-chain swap activity for an agent with a linked wallet.
 * Reads from Agent.recentActivity cache when fresh (< 10 min); otherwise
 * fetches live from Helius / Moralis and writes back to DB.
 *
 * Only available for agents with verifiedWallet set.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { chainId: chainIdStr, agentId: agentIdStr } = await params;
  const chainId = parsePublicChainId(chainIdStr);
  const agentId = parsePublicAgentId(agentIdStr);
  if (chainId == null || agentId == null) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }
  const agent = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: {
      id: true,
      verifiedWallet: true,
      verifiedWalletChainId: true,
      recentActivity: true,
      activityUpdatedAt: true,
    },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  if (!agent.verifiedWallet) {
    return NextResponse.json(
      { activity: [], cached: false, reason: "no_wallet" },
      { status: 200 }
    );
  }
  // Serve from cache if fresh
  const now = Date.now();
  if (
    agent.activityUpdatedAt &&
    now - agent.activityUpdatedAt.getTime() < CACHE_TTL_MS &&
    agent.recentActivity != null
  ) {
    return NextResponse.json({
      activity: agent.recentActivity,
      cached: true,
      updatedAt: agent.activityUpdatedAt.toISOString(),
    });
  }
  // Live fetch — use verifiedWalletChainId if available, else route param
  const walletChainId = agent.verifiedWalletChainId ?? chainId;
  let activity;
  try {
    activity = await getAgentActivity(agent.verifiedWallet, walletChainId);
  } catch (err) {
    console.error(`[activity-route] fetch error for agent ${agent.id}:`, err);
    // Return stale cache if available rather than a hard error
    if (agent.recentActivity != null) {
      return NextResponse.json({
        activity: agent.recentActivity,
        cached: true,
        stale: true,
        updatedAt: agent.activityUpdatedAt?.toISOString() ?? null,
      });
    }
    return NextResponse.json(
      { error: "Failed to fetch activity", activity: [] },
      { status: 502 }
    );
  }
  const fetchedAt = new Date();
  try {
    await enqueueApplicationJob(JOB_QUEUES.AGENT_ACTIVITY_PERSIST, {
      v: 1,
      agentId: agent.id,
      walletChainId,
      verifiedWallet: agent.verifiedWallet,
      fetchedAt: fetchedAt.toISOString(),
      activity: activity.map((item) => ({
        ...item,
        timestamp: item.timestamp.toISOString(),
      })),
    });
  } catch (err) {
    console.error(`[activity-route] failed to enqueue persistence for agent ${agent.id}:`, err);
  }
  return NextResponse.json({
    activity,
    cached: false,
    updatedAt: fetchedAt.toISOString(),
  });
}
