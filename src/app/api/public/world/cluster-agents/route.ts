import { NextResponse } from "next/server";
import {
  loadWorldClusterAgents,
  WORLD_CLUSTER_AGENTS_MAX,
} from "@/lib/public-site/world-agent-previews.server";
import {
  buildMockClusterAgents,
  MOCK_CLUSTER_AGENTS_COUNT,
  shouldServeMockClusterAgents,
} from "@/lib/public-site/world-mock-data.server";
import type { AgentWorldClusterAgentsResponse } from "@/lib/public-site/world-types";

export const dynamic = "force-dynamic";

function parseChainId(value: string | null): number | null {
  if (!value) return null;
  const chainId = Number.parseInt(value, 10);
  if (!Number.isFinite(chainId) || chainId <= 0) return null;
  return chainId;
}

export async function GET(request: Request) {
  const chainId = parseChainId(new URL(request.url).searchParams.get("chainId"));
  if (chainId == null) {
    return NextResponse.json({ error: "chainId is required" }, { status: 400 });
  }

  try {
    let agents: AgentWorldClusterAgentsResponse["agents"];
    let total: number;

    if (shouldServeMockClusterAgents(request)) {
      const loaded = buildMockClusterAgents(chainId, { limit: MOCK_CLUSTER_AGENTS_COUNT });
      agents = loaded.agents;
      total = loaded.total;
    } else {
      const loaded = await loadWorldClusterAgents(chainId, { limit: WORLD_CLUSTER_AGENTS_MAX });
      agents = loaded.agents;
      total = loaded.total;
    }

    const payload: AgentWorldClusterAgentsResponse = {
      chainId,
      agents,
      total,
      truncated: total > agents.length,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=180",
      },
    });
  } catch (error) {
    console.error("[public/world/cluster-agents] GET error:", error);
    return NextResponse.json({ error: "Failed to load cluster agents" }, { status: 500 });
  }
}
