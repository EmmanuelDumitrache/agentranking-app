import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  findAgentFuzzyNameCandidates,
  orderRowsByFuzzyCandidates,
} from "@/lib/agent-fuzzy-search.server";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { normalizeAgentListSearch } from "@/lib/agents-search-scope";
export const dynamic = "force-dynamic";
const MAX_RESULTS = 12;
const MIN_QUERY_LEN = 2;
/**
 * Lightweight agent lookup for holder perk apply dialog — avoids full /api/agents list pipeline.
 */
export async function GET(req: NextRequest) {
  const q = normalizeAgentListSearch(req.nextUrl.searchParams.get("q") ?? "");
  if (q.length < MIN_QUERY_LEN) {
    return NextResponse.json({ agents: [] });
  }
  const isNumeric = /^\d+$/.test(q);
  const agentIdFilter = isNumeric ? Number.parseInt(q, 10) : null;
  const indexableWhere = await extendAgentWhereIndexable();
  const searchWhere = {
    OR: [
      { name: { contains: q, mode: "insensitive" as const } },
      ...(agentIdFilter != null && Number.isFinite(agentIdFilter)
        ? [{ agentId: agentIdFilter }, { id: agentIdFilter }]
        : []),
    ],
  };
  const exactWhere = { AND: [indexableWhere, searchWhere] };
  const select = {
    id: true,
    agentId: true,
    chainId: true,
    name: true,
    image: true,
    powerScore: true,
    chain: { select: { shortName: true, color: true, icon: true } },
  } as const;
  const exactAgents = await prisma.agent.findMany({
    where: exactWhere,
    select,
    orderBy: [{ powerScore: "desc" }, { score: "desc" }, { id: "asc" }],
    take: MAX_RESULTS,
  });
  let agents = exactAgents;
  if (exactAgents.length < MAX_RESULTS) {
    const fuzzyCandidates = await findAgentFuzzyNameCandidates({
      query: q,
      limit: 48,
      activeOnly: true,
    });
    const exactIds = new Set(exactAgents.map((agent) => agent.id));
    const fuzzyIds = fuzzyCandidates
      .map((candidate) => candidate.id)
      .filter((id) => !exactIds.has(id));
    if (fuzzyIds.length > 0) {
      const fuzzyRows = await prisma.agent.findMany({
        where: { AND: [indexableWhere, { id: { in: fuzzyIds } }] },
        select,
      });
      agents = [
        ...exactAgents,
        ...orderRowsByFuzzyCandidates(fuzzyRows, fuzzyCandidates),
      ].slice(0, MAX_RESULTS);
    }
  }
  return NextResponse.json({
    agents: agents.map((a) => ({
      id: a.id,
      agentId: a.agentId,
      chainId: a.chainId,
      name: a.name,
      image: a.image ?? "",
      powerScore: a.powerScore,
      slug: toAgentUrlSlug(a.name),
      profilePath: agentPublicPath(a),
      chain: a.chain,
    })),
  });
}
