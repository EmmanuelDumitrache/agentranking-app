import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { searchJupiterTokens } from "@/lib/agent-trading/jupiter-client";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getDashboardAccess(session);
  if (!access.ownedAgents.some((agent) => agent.id === id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ tokens: [] });
  }

  try {
    const tokens = await searchJupiterTokens(query);
    return NextResponse.json({ tokens });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Token search failed",
      },
      { status: 502 },
    );
  }
}
