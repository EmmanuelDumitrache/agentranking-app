import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  findAgentFuzzyNameCandidates,
  orderRowsByFuzzyCandidates,
} from "@/lib/agent-fuzzy-search.server";

export const runtime = "nodejs";

/**
 * Lightweight agent search for the KYA demo flow.
 * Returns Agent.id (DB PK) required by ownership / passport FKs.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? 8);
  const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, limitRaw)) : 8;

  if (!q) {
    return NextResponse.json({ agents: [] });
  }

  const asInt = Number(q);
  const select = {
    id: true,
    agentId: true,
    chainId: true,
    name: true,
    score: true,
    image: true,
    owner: true,
  } as const;
  const exactAgents = await prisma.agent.findMany({
    where: {
      isActive: true,
      publiclyActive: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        ...(Number.isInteger(asInt) && asInt > 0
          ? [{ id: asInt }, { agentId: asInt }]
          : []),
      ],
    },
    select,
    orderBy: [{ score: "desc" }, { id: "asc" }],
    take: limit,
  });

  let agents = exactAgents;
  if (exactAgents.length < limit) {
    const fuzzyCandidates = await findAgentFuzzyNameCandidates({
      query: q,
      limit: Math.min(40, limit * 4),
      activeOnly: true,
      publiclyActiveOnly: true,
    });
    const exactIds = new Set(exactAgents.map((agent) => agent.id));
    const fuzzyIds = fuzzyCandidates
      .map((candidate) => candidate.id)
      .filter((id) => !exactIds.has(id));
    if (fuzzyIds.length > 0) {
      const fuzzyRows = await prisma.agent.findMany({
        where: {
          id: { in: fuzzyIds },
          isActive: true,
          publiclyActive: true,
        },
        select,
      });
      agents = [
        ...exactAgents,
        ...orderRowsByFuzzyCandidates(fuzzyRows, fuzzyCandidates),
      ].slice(0, limit);
    }
  }

  return NextResponse.json({
    agents: agents.map((a) => ({
      id: a.id,
      agentId: a.agentId,
      chainId: a.chainId,
      name: a.name,
      score: a.score,
      image: a.image,
      owner: a.owner,
    })),
  });
}
