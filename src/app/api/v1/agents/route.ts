import { NextRequest, NextResponse } from "next/server";
import { resolveAgentsListMaxSkip } from "@/lib/agents-list-pagination-policy";
import {
  buildActiveAgentsWhere,
  agentsListOrderBy,
  queryAgentsListShared,
  queryAgentsListProtocolTrustSort,
  formatAgentRow,
  type AgentsListFilterInput,
} from "@/lib/agents-api-shared";
import {
  getPublicAgentListPayload,
  versionedAgentListCacheEligible,
} from "@/lib/public-agent-list-cache";
import {
  buildPublicAgentListCacheSearchParams,
  parseClampedAgentListInteger,
} from "@/lib/public-agent-list-cache-key";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "X-API-Version": "1",
};
const PUBLIC_CACHE_CONTROL = "public, s-maxage=120, stale-while-revalidate=300";
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
type V1AgentsBody = {
  data: ReturnType<typeof formatAgentRow>[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    protocolTrustSort?: { capped: boolean; fullMatchCount: number; poolSize: number };
  };
};
async function loadV1AgentsBody(input: {
  filter: AgentsListFilterInput;
  sort: string;
  page: number;
  perPage: number;
  skip: number;
}): Promise<V1AgentsBody> {
  const where = buildActiveAgentsWhere(input.filter);
  if (input.sort === "protocol_trust_desc" || input.sort === "protocol_trust_asc") {
    const direction = input.sort === "protocol_trust_asc" ? "asc" : "desc";
    const { rows, total, protocolTrustSort } = await queryAgentsListProtocolTrustSort({
      where,
      direction,
      page: input.page,
      perPage: input.perPage,
    });
    return {
      data: rows.map(formatAgentRow),
      meta: {
        page: input.page,
        perPage: input.perPage,
        total,
        totalPages: Math.ceil(total / input.perPage),
        protocolTrustSort,
      },
    };
  }
  const { rows, total } = await queryAgentsListShared({
    where,
    orderBy: agentsListOrderBy(input.sort),
    skip: input.skip,
    take: input.perPage,
  });
  return {
    data: rows.map(formatAgentRow),
    meta: {
      page: input.page,
      perPage: input.perPage,
      total,
      totalPages: Math.ceil(total / input.perPage),
    },
  };
}
/**
 * GET /api/v1/agents
 *
 * Query params:
 *   page        (default: 1)
 *   perPage     (default: 20, max: 50)
 *   chain       chainId number
 *   archetype   trading|sniper|mev|... (see ARCHETYPES)
 *   search      name / description / owner substring
 *   skills      comma-separated: mcp,a2a,oasf
 *   x402        true
 *   verified    true
 *   minScore    number
 *   sort        agent_rank_desc | profile_desc | protocol_trust_desc | execution_desc | activity_desc | created_desc | listed_desc | feedback_desc | verified_first | recommended
 *   owner       0x... wallet address
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseClampedAgentListInteger(searchParams.get("page"), 1, Number.MAX_SAFE_INTEGER);
  const perPage = parseClampedAgentListInteger(searchParams.get("perPage"), 20, 50);
  const skip = (page - 1) * perPage;
  const maxSkip = resolveAgentsListMaxSkip();
  if (skip > maxSkip) {
    return NextResponse.json(
      {
        error: `Refusing deep pagination (offset ${skip} exceeds max ${maxSkip}). Narrow filters or lower the page index.`,
        code: "AGENTS_PAGE_TOO_DEEP",
        maxSkip,
        requestedSkip: skip,
      },
      { status: 400, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
    );
  }
  const filter: AgentsListFilterInput = {
    chain: searchParams.get("chain"),
    search: searchParams.get("search") ?? "",
    skillsParam: searchParams.get("skills") ?? "",
    x402: searchParams.get("x402"),
    verified: searchParams.get("verified"),
    minScore: searchParams.get("minScore"),
    owner: searchParams.get("owner") ?? "",
    archetype: searchParams.get("archetype"),
  };
  const sort = searchParams.get("sort") ?? "profile_desc";
  const cacheEligible = versionedAgentListCacheEligible(searchParams, page, sort);
  try {
    const load = () => loadV1AgentsBody({ filter, sort, page, perPage, skip });
    if (cacheEligible) {
      const cacheSearchParams = buildPublicAgentListCacheSearchParams({
        endpoint: "v1",
        source: searchParams,
        page,
        perPage,
        sort,
      });
      const result = await getPublicAgentListPayload("v1", cacheSearchParams, load);
      return NextResponse.json(result.value, {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": PUBLIC_CACHE_CONTROL,
          "Last-Modified": new Date(result.generatedAt).toUTCString(),
          "X-AgentRanking-Origin-Cache": result.status,
        },
      });
    }
    const body = await load();
    return NextResponse.json(body, {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": sort.startsWith("protocol_trust_") ? "public, s-maxage=30, stale-while-revalidate=120" : PUBLIC_CACHE_CONTROL,
      },
    });
  } catch (error) {
    console.error("[api/v1/agents] unavailable", Error.isError(error) ? error.stack : String(error));
    return NextResponse.json(
      { error: "Agent directory is temporarily unavailable" },
      {
        status: 503,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-store",
          "Retry-After": "5",
        },
      },
    );
  }
}
