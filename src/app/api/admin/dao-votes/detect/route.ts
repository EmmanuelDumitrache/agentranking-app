import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { parseAgentFromUrl } from "@/lib/agent-url-parse";
import { resolveOnChainIdsFromProfileUrl } from "@/lib/resolve-agent-from-link-url";
import { fetchDaoVotesAdminRow } from "@/lib/admin-dao-votes";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/**
 * POST /api/admin/dao-votes/detect
 * Body: { url: string }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { url?: string };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    const parsed = parseAgentFromUrl(url);
    if (!parsed) {
      return NextResponse.json(
        {
          error:
            "Could not parse URL. Use …/agents/{chainId}/{agentId}/{current-name-slug}.",
        },
        { status: 400 },
      );
    }
    const resolved = await resolveOnChainIdsFromProfileUrl(url);
    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "That profile URL is missing, obsolete, or does not match the Agent's current name.",
        },
        { status: 400 },
      );
    }
    const { chainId, agentId } = resolved;
    let internalId: number | null = null;
    const existing = await prisma.agent.findUnique({
      where: { agentId_chainId: { agentId, chainId } },
      select: { id: true },
    });
    if (existing) {
      internalId = existing.id;
    }
    if (internalId == null) {
      return NextResponse.json(
        {
          error:
            "Agent not found for that current profile URL.",
        },
        { status: 404 },
      );
    }
    const agent = await fetchDaoVotesAdminRow(prisma, internalId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ agent });
  } catch (err) {
    console.error("POST /api/admin/dao-votes/detect error:", err);
    return NextResponse.json({ error: "Detect failed" }, { status: 500 });
  }
}
