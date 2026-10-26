import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  buildActiveAgentsWhere,
  agentsListOrderBy,
  queryAgentsListProtocolTrustSort,
  formatExtendedAgentRow,
  EXTENDED_AGENT_LIST_SELECT,
  type AgentsListFilterInput,
} from "@/lib/agents-api-shared";
import { resolveAgentsListMaxSkip } from "@/lib/agents-list-pagination-policy";
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
  "X-API-Version": "2",
};
const PUBLIC_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
type V2AgentsBody = {
  agents: ReturnType<typeof formatExtendedAgentRow>[];
  meta: {
    apiVersion: 2;
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    protocolTrustSort?: { capped: boolean; fullMatchCount: number; poolSize: number };
  };
};
async function loadV2AgentsBody(input: {
  filter: AgentsListFilterInput;
  sort: string;
  page: number;
  perPage: number;
  skip: number;
  verifiedRevenue: boolean;
  minMonthlyPnl: string | null;
  maxBurnToEarn: string | null;
}): Promise<V2AgentsBody> {
  const where = buildActiveAgentsWhere(input.filter);
  if (input.verifiedRevenue) where.isVerifiedRevenue = true;
  if (input.minMonthlyPnl) {
    const value = Number.parseFloat(input.minMonthlyPnl);
    if (!Number.isNaN(value)) where.perfMonthlyPnlUsd = { gte: value };
  }
  if (input.maxBurnToEarn) {
    const value = Number.parseFloat(input.maxBurnToEarn);
    if (!Number.isNaN(value)) where.perfBurnToEarnRatio = { lte: value };
  }
  let agents: ReturnType<typeof formatExtendedAgentRow>[];
  let total: number;
  let protocolTrustSort: { capped: boolean; fullMatchCount: number; poolSize: number } | undefined;
  if (input.sort === "protocol_trust_desc" || input.sort === "protocol_trust_asc") {
    const result = await queryAgentsListProtocolTrustSort({
      where,
      direction: input.sort === "protocol_trust_desc" ? "desc" : "asc",
      page: input.page,
      perPage: input.perPage,
    });
    agents = result.rows.map((row) =>
      formatExtendedAgentRow(row as Parameters<typeof formatExtendedAgentRow>[0]),
    );
    total = result.total;
    protocolTrustSort = result.protocolTrustSort;
  } else {
    const orderBy = input.sort === "monthly_pnl_desc"
      ? { perfMonthlyPnlUsd: "desc" as const }
      : agentsListOrderBy(input.sort);
    const rows = await prisma.agent.findMany({
      where,
      orderBy,
      skip: input.skip,
      take: input.perPage,
      select: EXTENDED_AGENT_LIST_SELECT,
    });
    total = await prisma.agent.count({ where });
    agents = rows.map(formatExtendedAgentRow);
  }
  return {
    agents,
    meta: {
      apiVersion: 2,
      page: input.page,
      perPage: input.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.perPage)),
      ...(protocolTrustSort ? { protocolTrustSort } : {}),
    },
  };
}
/**
 * GET /api/v2/agents
 *
 * Superset of /api/v1/agents. All v1 query params supported, plus:
 *   verifiedRevenue   true — only agents with isVerifiedRevenue=true
 *   minMonthlyPnl     number — minimum perfMonthlyPnlUsd
 *   maxBurnToEarn     number — maximum perfBurnToEarnRatio
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
  const load = () => loadV2AgentsBody({
    filter,
    sort,
    page,
    perPage,
    skip,
    verifiedRevenue: searchParams.get("verifiedRevenue") === "true",
    minMonthlyPnl: searchParams.get("minMonthlyPnl"),
    maxBurnToEarn: searchParams.get("maxBurnToEarn"),
  });
  try {
    if (cacheEligible) {
      const cacheSearchParams = buildPublicAgentListCacheSearchParams({
        endpoint: "v2",
        source: searchParams,
        page,
        perPage,
        sort,
      });
      const result = await getPublicAgentListPayload("v2", cacheSearchParams, load);
      return NextResponse.json(result.value, {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": PUBLIC_CACHE_CONTROL,
          "Last-Modified": new Date(result.generatedAt).toUTCString(),
          "X-AgentRanking-Origin-Cache": result.status,
        },
      });
    }
    return NextResponse.json(await load(), {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": sort.startsWith("protocol_trust_") ? "public, s-maxage=30, stale-while-revalidate=120" : PUBLIC_CACHE_CONTROL,
      },
    });
  } catch (error) {
    console.error("[api/v2/agents] unavailable", Error.isError(error) ? error.stack : String(error));
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
