import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  prismaApiErrorLogFields,
  prismaApiRouteErrorResponse,
} from "@/lib/api-prisma-route-error";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureMinimalUserProfile, hasDashboardIdentity } from "@/lib/dashboard/session-profile";
import { computeDashboardUnlocked } from "@/lib/dashboard/access";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { sanitizeAgentImageUrl } from "@/lib/image-utils";
import { getSyncableChainIds } from "@/lib/erc8004-sync";
import { computeTrustScore, trustSignalsFromMetadataAndAgent } from "@/lib/trust-score";
import { computeExecutionScore, computeProtocolTrustScoreFromAgentDimensions } from "@/lib/agent-score";
import { attachAgentScoringPayloadFromStored } from "@/lib/agent-scoring-payload";
import {
  redactAgentExecutionForPublicViewer,
  PROTOCOL_TRUST_SORT_MAX_POOL,
} from "@/lib/agents-api-shared";
import { extendAgentWhereNotBlocked } from "@/lib/agent-blocklist";
import { attachSapTwinMatchToAgentsSync, getCachedSapTwinIndex, type AgentRowForSapTwin } from "@/lib/sap-name-twin";
import { covenantAgentListingWhere } from "@/lib/covenant/detect";
import {
  HATCHER_ID_METADATA_KEY,
  HATCHER_METADATA_KEY,
} from "@/lib/hatcher/config";
import { hatcherAgentListingWhere } from "@/lib/hatcher/detect";
import { buildMetaplexAgentsListWhere } from "@/lib/metaplex/detect";
import { metaplexDirectoryOrderBy } from "@/lib/metaplex/directory-sort";
import { applySocialsAndToWhere, parseSocialsQueryParam } from "@/lib/agent-social-filter";
import { agentHasPublishedXPayWhere } from "@/lib/xpay/agent-list-filter";
import {
  applyVerifiedListEnrichment,
  enrichVerifiedAgentsList,
} from "@/lib/verified-agents-list-enrichment";
import {
  normalizeAgentListSearch,
  resolveAgentsSearchScope,
  isLikelySolanaPubkey,
  isAgentListSearchQueryReady,
  type AgentsSearchScope,
} from "@/lib/agents-search-scope";
import {
  computeAgentSearchRelevanceAgent,
  SEARCH_RELEVANCE_POOL_MAX,
} from "@/lib/agents-search-relevance";
import { dedupeAgentListByCluster } from "@/lib/agent-chain-list-dedupe";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import {
  activeHolderPerksRelationFind,
  parseHolderPerkFlags,
} from "@/lib/leaderboard-filters";
import {
  getPublicAgentListPayload,
  webAgentListCacheEligible,
} from "@/lib/public-agent-list-cache";
import { buildPublicAgentListCacheSearchParams } from "@/lib/public-agent-list-cache-key";
import { PublicApiCacheCoordinationError } from "@/lib/public-api-cache";
import { HOME_SCANNER_PAGE_SIZE } from "@/lib/scanner-pagination";
import { resolveAgentsListMaxSkip } from "@/lib/agents-list-pagination-policy";
import { loadRecommendedAgentPool } from "@/lib/recommended-agent-pool";
/** Order chains for the balanced recent feed so one chain’s bulk insert cannot fill the first page. */
const NEW_FEED_CHAIN_PRIORITY = [
  900001, 8453, 1, 56, 42161, 10, 137, 100, 42220, 534352, 59144, 43114, 5000, 360, 1088, 1187947933, 2741,
  167000, 196, 1868, 2345, 143, 45056, 1776, 4217, 42, 10088, 9745, 4326, 2046399126,
];
/** Include every syncable chain in the first-page round-robin so lower-volume chains remain visible. */
const NEW_FEED_MULTI_MAX_CHAINS = 40;
/** Keep small: each wave holds N concurrent Prisma queries (same pg pool as count + trust sorts). */
const NEW_FEED_MULTI_MAX_PARALLEL = 3;
function orderedChainsForNewFeed(): number[] {
  const syncable = new Set(getSyncableChainIds());
  const out: number[] = [];
  for (const id of NEW_FEED_CHAIN_PRIORITY) {
    if (syncable.has(id)) out.push(id);
  }
  for (const id of getSyncableChainIds()) {
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, NEW_FEED_MULTI_MAX_CHAINS);
}
/** Newest listing first; `listedAt` is non-null in schema (`@default(now())`). */
const listedAtNewestFirstOrder: Prisma.AgentOrderByWithRelationInput[] = [
  { listedAt: "desc" },
  { id: "desc" },
];
type ListViewAgentPayload = Prisma.AgentGetPayload<{ select: Prisma.AgentSelect }>;
/** Round-robin recent listings by chain for the first balanced feed page. Later pages use global listed order. */
async function agentsBalancedRecentRoundRobin(
  where: Prisma.AgentWhereInput,
  perPage: number,
  listSelect: Prisma.AgentSelect
): Promise<ListViewAgentPayload[]> {
  const chainIds = orderedChainsForNewFeed();
  if (chainIds.length === 0) {
    return prisma.agent.findMany({
      where,
      select: listSelect,
      orderBy: listedAtNewestFirstOrder,
      take: perPage,
    });
  }
  const takePerChain = Math.min(
    48,
    Math.max(4, Math.ceil((perPage * 2) / Math.max(1, chainIds.length))),
  );
  const rowsByChain: ListViewAgentPayload[][] = [];
  for (let i = 0; i < chainIds.length; i += NEW_FEED_MULTI_MAX_PARALLEL) {
    const batch = chainIds.slice(i, i + NEW_FEED_MULTI_MAX_PARALLEL);
    /** Sequential: with `pg` pool `max: 1`, parallel `findMany` per chain exhausts checkout timeouts. */
    const part: ListViewAgentPayload[][] = [];
    for (const chainId of batch) {
      part.push(
        await prisma.agent.findMany({
          where: { ...where, chainId },
          select: listSelect,
          orderBy: listedAtNewestFirstOrder,
          take: takePerChain,
        }),
      );
    }
    rowsByChain.push(...part);
  }
  const queues = rowsByChain.filter((q) => q.length > 0);
  const merged: ListViewAgentPayload[] = [];
  let round = 0;
  while (merged.length < perPage && queues.length > 0) {
    let progressed = false;
    for (const q of queues) {
      if (merged.length >= perPage) break;
      const row = q[round];
      if (row) {
        merged.push(row);
        progressed = true;
      }
    }
    round++;
    if (!progressed || round > takePerChain) break;
  }
  return merged;
}
export const dynamic = "force-dynamic";
/** VPS / heavy list+count timeout; keep below the nginx/app request budget. */
export const maxDuration = 120;
/** Database statement/query deadlines are enforced by the pg pool in `src/lib/db.ts`. */
const INTERACTIVE_AGENT_LIST_CACHE_CONTROL = "private, no-store";
async function handleAgentsGet(request: NextRequest, bypassPublicCache: boolean) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPage = Number.parseInt(searchParams.get("page") || "1", 10);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
    const rawPerPage = Number.parseInt(searchParams.get("perPage") || "50", 10);
    const requestedPerPage =
      Number.isFinite(rawPerPage) && rawPerPage >= 1 ? rawPerPage : 50;
    const listViewExplicit = searchParams.get("listView") === "true";
    const listView = listViewExplicit || requestedPerPage > 20;
    const perPageCap = listView ? HOME_SCANNER_PAGE_SIZE : 50;
    const perPage = Math.min(requestedPerPage, perPageCap);
    const searchRaw = searchParams.get("search") || "";
    const searchNormalized = normalizeAgentListSearch(searchRaw);
    const search =
      searchNormalized && isAgentListSearchQueryReady(searchNormalized) ? searchNormalized : "";
    const nameOnly = searchParams.get("nameOnly") === "true";
    const searchScopeParam = searchParams.get("searchScope");
    const skipRank = searchParams.get("skipRank") === "true";
    const compareMode = searchParams.get("compare") === "1";
    const chain = searchParams.get("chain") || "";
    const service = searchParams.get("service") || "";
    const sort = searchParams.get("sort") || "created_desc";
    /** Short-lived memo: skip DB + transforms when identical home/directory URLs repeat */
    const listMemoEligible = webAgentListCacheEligible(searchParams, perPage);
    if (listMemoEligible && !bypassPublicCache) {
      const cacheSearchParams = buildPublicAgentListCacheSearchParams({
        endpoint: "web",
        source: searchParams,
        page,
        perPage,
        sort,
        listView,
      });
      const result = await getPublicAgentListPayload("web", cacheSearchParams, async () => {
        const originResponse = await handleAgentsGet(request, true);
        if (!originResponse.ok) {
          throw new Error(`Origin Agent-list request failed with status ${originResponse.status}`);
        }
        const body: unknown = await originResponse.json();
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          throw new TypeError("Origin Agent-list response was not an object");
        }
        return body;
      });
      return NextResponse.json(result.value, {
        headers: {
          "Cache-Control": INTERACTIVE_AGENT_LIST_CACHE_CONTROL,
          Pragma: "no-cache",
          "Last-Modified": new Date(result.generatedAt).toUTCString(),
          "X-AgentRanking-Origin-Cache": result.status,
        },
      });
    }
    const x402 = searchParams.get("x402");
    const xpay = searchParams.get("xpay");
    const hasWallet = searchParams.get("hasWallet");
    const verified = searchParams.get("verified");
    const minScore = searchParams.get("minScore");
    const minFeedback = searchParams.get("minFeedback");
    const active = searchParams.get("active"); // "7d" | "30d"
    const protocol = searchParams.get("protocol") || "";
    const supportedTrust = searchParams.get("trust") || "";
    const binance = searchParams.get("binanceCompatible");
    const sapVerifiedParam = searchParams.get("sapVerified");
    const covenantParam = searchParams.get("covenant");
    const hatcherParam = searchParams.get("hatcher");
    const metaplexParam = searchParams.get("metaplex");
    // skills=mcp,a2a,oasf — filter agents that have those capability metadata keys
    const skillsParam = searchParams.get("skills") || "";
    const showAll = searchParams.get("showAll") === "true";
    const includeInactive = searchParams.get("includeInactive") === "true" || showAll;
    /** Enable the cross-chain balanced recent feed only when explicitly requested. */
    const balancedRecentFeed =
      searchParams.get("balanced") === "1" || searchParams.get("balanced") === "true";
    // Incremental `.AND.push` builds are awkward under strict `AgentWhereInput` typing.
    let searchUsesSolanaChainShortcut = false;
    let where: Prisma.AgentWhereInput & { AND?: Prisma.AgentWhereInput[] } = {};
    if (search) {
      /** `900001` is our Solana (SAP) pseudo-chain id — not an ERC/EIP agent token ID. */
      const isSolanaChainShortcut =
        /^\d+$/.test(search) && Number.parseInt(search, 10) === SOLANA_CHAIN_ID;
      if (isSolanaChainShortcut) {
        where.chainId = SOLANA_CHAIN_ID;
        searchUsesSolanaChainShortcut = true;
      } else {
        const isNumeric = /^\d+$/.test(search) && !Number.isNaN(Number.parseInt(search, 10));
        const isAddressLike = search.toLowerCase().startsWith("0x");
        const searchScope: AgentsSearchScope = resolveAgentsSearchScope({
          searchScopeParam,
          nameOnly,
          isNumeric,
          isAddressLike,
        });
        const ic = { contains: search, mode: "insensitive" as const };
        const nameClause: Prisma.AgentWhereInput = { name: ic };
        const descClause: Prisma.AgentWhereInput = { description: ic };
        const ownerClause: Prisma.AgentWhereInput = { owner: ic };
        const orClauses: Prisma.AgentWhereInput[] = [];
        switch (searchScope) {
          case "name":
            orClauses.push(nameClause);
            break;
          case "description":
            orClauses.push(descClause);
            break;
          case "text":
            orClauses.push(nameClause, descClause);
            break;
          default:
            orClauses.push(nameClause, descClause, ownerClause);
            break;
        }
        if (isNumeric) {
          orClauses.push({ agentId: Number.parseInt(search, 10) });
        }
        if (isAddressLike && searchScope !== "all") {
          orClauses.push(ownerClause);
        }
        /** OOBE explorer URLs sometimes use wallet; we key SAP by agent PDA + owner wallet */
        if (isLikelySolanaPubkey(search)) {
          orClauses.push(
            { sapAgentPda: search },
            { sapOwnerWallet: search },
            { metaplexAssetAddress: search },
            { metaplexAssetSignerPda: search },
            { metaplexAgentTokenMint: search },
            { owner: { equals: search } },
          );
        }
        where.OR = orClauses;
      }
    }
    if (chain) {
      where.chainId = parseInt(chain);
    }
    if (service) {
      where.services = { some: { name: service } };
    }
    if (protocol) {
      where.services = { some: { name: protocol } };
    }
    if (supportedTrust) {
      where.supportedTrust = { contains: supportedTrust };
    }
    if (x402 === "true") {
      where.x402Support = true;
    }
    if (xpay === "true") {
      const andArr = Array.isArray(where.AND) ? [...where.AND] : [];
      andArr.push(agentHasPublishedXPayWhere());
      where.AND = andArr;
    }
    if (hasWallet === "true") {
      where.metadata = { some: { key: "agentWallet" } };
    }
    if (verified === "true") {
      const andArr = Array.isArray(where.AND) ? where.AND : [];
      andArr.push({
        OR: [{ isVerified: true }, { isPremiumVerified: true }],
      });
      where.AND = andArr;
    }
    if (binance === "true") {
      where.binanceCompatible = true;
    }
    if (sapVerifiedParam === "true") {
      where.sapVerified = true;
    }
    if (covenantParam === "true") {
      const covenantWhere = covenantAgentListingWhere();
      const andArr = Array.isArray(where.AND) ? [...where.AND] : [];
      andArr.push(covenantWhere);
      where.AND = andArr;
    }
    if (hatcherParam === "true") {
      const hatcherWhere = hatcherAgentListingWhere();
      const andArr = Array.isArray(where.AND) ? [...where.AND] : [];
      andArr.push(hatcherWhere);
      where.AND = andArr;
    }
    if (metaplexParam === "true") {
      const metaplexWhere = buildMetaplexAgentsListWhere({
        tradeable: searchParams.get("metaplexTradeable") === "true",
        hasServices: searchParams.get("metaplexHasServices") === "true",
        boundToken: searchParams.get("metaplexBoundToken") === "true",
        active: searchParams.get("metaplexActive") === "true",
        registryDetected: searchParams.get("metaplexRegistryDetected") === "true",
      });
      const andArr = Array.isArray(where.AND) ? [...where.AND] : [];
      andArr.push(metaplexWhere);
      where.AND = andArr;
    }
    // Skills filter: ?skills=mcp,a2a,oasf
    // Maps skill name to the AgentMetadata key that holds the array
    const SKILL_META_KEY_MAP: Record<string, string> = {
      mcp: "mcpTools",
      a2a: "a2aSkills",
      oasf: "oasfSkills",
    };
    if (skillsParam) {
      const requestedSkills = skillsParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const skillMetaKeys = requestedSkills
        .map((s) => SKILL_META_KEY_MAP[s])
        .filter(Boolean);
      if (skillMetaKeys.length > 0) {
        const andArr = Array.isArray(where.AND) ? [...where.AND] : [];
        for (const metaKey of skillMetaKeys) {
          andArr.push({
            metadata: { some: { key: metaKey } },
          });
        }
        where.AND = andArr;
      }
    }
    const socialsParam = searchParams.get("socials") || "";
    const socialsList = parseSocialsQueryParam(socialsParam);
    if (socialsList.length > 0) {
      applySocialsAndToWhere(where, socialsList);
    }
    if (minScore) {
      const n = Number(minScore);
      if (!Number.isNaN(n)) where.score = { gte: n };
    }
    if (minFeedback) {
      const n = Number(minFeedback);
      if (!Number.isNaN(n)) where.totalFeedback = { gte: n };
    }
    if (active === "3h") {
      where.lastActiveAt = { gte: new Date(Date.now() - 3 * 60 * 60 * 1000) };
    } else if (active === "6h") {
      where.lastActiveAt = { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) };
    } else if (active === "24h") {
      where.lastActiveAt = { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
    } else if (active === "3d") {
      where.lastActiveAt = { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) };
    } else if (active === "7d") {
      where.lastActiveAt = { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
    } else if (active === "30d") {
      where.lastActiveAt = { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    }
    // Archetype filter: ?archetype=trading
    const archetypeParam = searchParams.get("archetype") || "";
    if (archetypeParam) {
      where.archetype = archetypeParam;
    }
    // Telegram directory filters (use with archetype=telegram or /telegram page)
    const telegramBotTypeParam = searchParams.get("telegramBotType") || "";
    const telegramTagParam = searchParams.get("tag") || "";
    const telegramSpawnParam = searchParams.get("telegramSpawn") || "";
    const telegramMetaAnd: Prisma.AgentWhereInput[] = [];
    if (telegramBotTypeParam === "standalone" || telegramBotTypeParam === "managed") {
      telegramMetaAnd.push({
        metadata: { some: { key: "telegramBotType", value: telegramBotTypeParam } },
      });
    }
    if (telegramTagParam.trim()) {
      telegramMetaAnd.push({
        metadata: {
          some: {
            key: "tags",
            value: { contains: telegramTagParam.trim(), mode: "insensitive" },
          },
        },
      });
    }
    if (telegramSpawnParam === "true") {
      telegramMetaAnd.push({
        metadata: { some: { key: "telegramSpawnUrl", value: { not: "" } } },
      });
    }
    if (telegramMetaAnd.length > 0) {
      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...existingAnd, ...telegramMetaAnd];
    }
    // Agent mode filter: ?agentMode=autonomous
    const agentModeParam = searchParams.get("agentMode") || "";
    const validModes = ["autonomous", "copilot", "hybrid", "unknown"];
    if (agentModeParam && validModes.includes(agentModeParam)) {
      where.agentMode = agentModeParam;
    }
    // Default: only active agents. Pass includeInactive=true or showAll=true (e.g. /new) for full index counts.
    if (!includeInactive) {
      where.isActive = true;
    }
    where = (await extendAgentWhereNotBlocked(
      where as Prisma.AgentWhereInput
    )) as Prisma.AgentWhereInput & { AND?: Prisma.AgentWhereInput[] };
    let orderBy:
      | Prisma.AgentOrderByWithRelationInput
      | Prisma.AgentOrderByWithRelationInput[];
    switch (sort) {
      case "name_asc":
        orderBy = [{ name: "asc" }, { id: "asc" }];
        break;
      case "name_desc":
        orderBy = [{ name: "desc" }, { id: "asc" }];
        break;
      case "chain_asc":
        orderBy = [{ chainId: "asc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "chain_desc":
        orderBy = [{ chainId: "desc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "profile_asc":
        orderBy = [{ score: "asc" }, { id: "asc" }];
        break;
      case "profile_desc":
        orderBy = [{ score: "desc" }, { totalFeedback: "desc" }, { lastActiveAt: "desc" }, { id: "asc" }];
        break;
      case "protocol_trust_asc":
        orderBy = [{ protocolTrustScore: "asc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "protocol_trust_desc":
        orderBy = [{ protocolTrustScore: "desc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "execution_asc":
        orderBy = [{ executionScore: "asc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "execution_desc":
        orderBy = [{ executionScore: "desc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "activity_asc":
        orderBy = [{ activityScore: "asc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "activity_desc":
        orderBy = [{ activityScore: "desc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "power_asc":
        orderBy = [{ powerScore: "asc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "power_desc":
        orderBy = [{ powerScore: "desc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "feedback_asc":
        orderBy = [{ totalFeedback: "asc" }, { id: "asc" }];
        break;
      case "feedback_desc":
        orderBy = [{ totalFeedback: "desc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "stars_asc":
        orderBy = [{ stars: "asc" }, { id: "asc" }];
        break;
      case "stars_desc":
        orderBy = [{ stars: "desc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "owner_asc":
        orderBy = [{ owner: "asc" }, { id: "asc" }];
        break;
      case "owner_desc":
        orderBy = [{ owner: "desc" }, { id: "asc" }];
        break;
      case "x402_asc":
        orderBy = [{ x402Support: "asc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "x402_desc":
        orderBy = [{ x402Support: "desc" }, { agentRankScore: "desc" }, { id: "asc" }];
        break;
      case "created_asc":
        orderBy = [{ createdAt: "asc" }, { id: "asc" }];
        break;
      case "created_desc":
        orderBy = [{ createdAt: "desc" }, { id: "desc" }];
        break;
      case "listed_asc":
        orderBy = [{ listedAt: "asc" }, { id: "asc" }];
        break;
      case "listed_desc":
      case "balanced_recent":
        orderBy = listedAtNewestFirstOrder;
        break;
      case "agent_rank_asc":
        orderBy = [{ agentRankScore: "asc" }, { id: "asc" }];
        break;
      case "verified_first":
        orderBy = [
          { isPremiumVerified: "desc" },
          { isVerified: "desc" },
          { agentRankScore: "desc" },
          { totalFeedback: "desc" },
          { id: "asc" },
        ];
        break;
      case "recommended":
        orderBy = [
          { discoveryScore: "desc" },
          { agentRankScore: "desc" },
          { totalFeedback: "desc" },
          { id: "asc" },
        ];
        break;
      case "agent_rank_desc":
      default:
        orderBy = [
          { agentRankScore: "desc" },
          { totalFeedback: "desc" },
          { protocolTrustScore: "desc" },
          { score: "desc" },
          { id: "asc" },
        ];
        break;
    }
    const metaplexDirectoryMode = metaplexParam === "true";
    if (metaplexDirectoryMode) {
      orderBy = metaplexDirectoryOrderBy(sort);
    }
    /** SAP / Solana-first listings — newest registrations surface among equal composite scores */
    const chainParsed = chain.trim().length > 0 ? Number.parseInt(chain, 10) : Number.NaN;
    const applySapRankingTieBreak =
      !metaplexDirectoryMode &&
      (sapVerifiedParam === "true" ||
        covenantParam === "true" ||
        hatcherParam === "true" ||
        searchUsesSolanaChainShortcut ||
        (Number.isFinite(chainParsed) && chainParsed === SOLANA_CHAIN_ID));
    const sapRegistrationSort = { sapRegisteredAt: "desc" } as const;
    if (applySapRankingTieBreak) {
      orderBy = Array.isArray(orderBy) ? [...orderBy, sapRegistrationSort] : [orderBy, sapRegistrationSort];
    }
    let compareShowsFullExecution = false;
    if (compareMode && listView) {
      const session = await getServerSession(authOptions);
      if (hasDashboardIdentity(session)) {
        const resolved = await ensureMinimalUserProfile(session);
        if (resolved) {
          const profile = await prisma.userProfile.findUnique({
            where: { id: resolved.id },
            select: {
              subscriptionStatus: true,
              subscriptionExpiresAt: true,
              walletAddress: true,
              solanaWallet: true,
            },
          });
          compareShowsFullExecution = await computeDashboardUnlocked(profile, resolved.id);
        }
      }
    }
    const redactCompareExecution = compareMode && listView && !compareShowsFullExecution;
    const hatcherListMode = hatcherParam === "true";
    const listMetadataKeys = [
      "registrations",
      "agentWallet",
      "admin_trust_dim_metadata",
      "admin_trust_dim_endpoints",
      "admin_trust_dim_social",
      "admin_trust_dim_compliance",
      "admin_trust_dim_quality",
      "admin_trust_dim_popularity",
      "admin_trust_dim_freshness",
      "admin_trust_dim_verified_revenue",
    ];
    if (hatcherListMode) {
      listMetadataKeys.push(HATCHER_METADATA_KEY, HATCHER_ID_METADATA_KEY);
    }
    /** Home passes skipRank=true — drop services JOIN and shrink metadata reads (keeps `chain: true`). */
    const listSelect = listView
      ? {
          id: true,
          agentId: true,
          chainId: true,
          clusterKey: true,
          name: true,
          description: true,
          image: true,
          owner: true,
          score: true,
          rank: true,
          stars: true,
          totalFeedback: true,
          x402Support: true,
          scoreWallet: true,
          scoreMetadata: true,
          scoreServices: true,
          scoreQuality: true,
          scorePopularity: true,
          scoreFreshness: true,
          scoreActivity: true,
          createdAt: true,
          listedAt: true,
          lastActiveAt: true,
          isVerified: true,
          isPremiumVerified: true,
          hotScore: true,
          powerScore: true,
          adminPowerAdjust: true,
          agentRankScore: true,
          discoveryScore: true,
          activityScore: true,
          activeBoosts: true,
          binanceCompatible: true,
          hasDuplicateName: true,
          sapVerified: true,
          agentURI: true,
          sapX402Endpoint: true,
          sapAgentPda: true,
          sapOwnerWallet: true,
          listingRegistrySource: true,
          metaplexVerified: true,
          metaplexAgentTokenMint: true,
          metaplexAssetAddress: true,
          metaplexSupportedTrust: true,
          archetype: true,
          archetypeAuto: true,
          agentMode: true,
          protocolTrustScore: true,
          executionScore: true,
          chain: true,
          isVerifiedRevenue: true,
          verifiedWallet: true,
          perfTxCount: true,
          perfLastComputedAt: true,
          ...(skipRank
            ? {
                // Home tabs only display the first service name; avoid endpoint + metadata payload egress.
                services: { select: { name: true }, take: 1 },
                metadata: {
                  where: { key: "registrations" },
                  select: { key: true, value: true },
                },
              }
            : {
                // Keep list payloads narrow: full metadata rows are large and increase DB/network load.
                services: { select: { name: true, endpoint: true }, take: 12 },
                metadata: {
                  where: { key: { in: listMetadataKeys } },
                  select: { key: true, value: true },
                },
              }),
          ...(skipRank || redactCompareExecution
            ? {}
            : {
                perfWinRate: true,
                perfMonthlyPnlUsd: true,
                perfTotalVolumeUsd: true,
                perfAvgPnlPercent: true,
                perfBurnToEarnRatio: true,
                perfLastComputedAt: true,
                perfProfitableTxCount: true,
                activeWinRate30d: true,
                nativeVolume30d: true,
              }),
          holderAgentPerks: activeHolderPerksRelationFind(new Date()),
        }
      : undefined;
    const isProtocolTrustSort =
      listView &&
      Boolean(listSelect) &&
      (sort === "protocol_trust_desc" || sort === "protocol_trust_asc");
    const maxListSkip = resolveAgentsListMaxSkip();
    const skipRows = (page - 1) * perPage;
    const recommendedPage1 = sort === "recommended" && listSelect && listView && page === 1;
    const balancedRecentPage1 =
      sort === "balanced_recent" && balancedRecentFeed && listSelect && listView && page === 1;
    if (isProtocolTrustSort && listSelect) {
      const maxProtocolTrustPage = Math.max(1, Math.ceil(PROTOCOL_TRUST_SORT_MAX_POOL / Math.max(1, perPage)));
      if (page > maxProtocolTrustPage) {
        return NextResponse.json(
          {
            ok: false,
            error: `Protocol trust leaderboard is limited to the top ${PROTOCOL_TRUST_SORT_MAX_POOL} agents (${maxProtocolTrustPage} page(s) at ${perPage} per page).`,
            code: "AGENTS_LIST_PAGE_TOO_DEEP",
            maxProtocolTrustPage,
          },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
    } else if (!recommendedPage1 && !balancedRecentPage1 && skipRows > maxListSkip) {
      return NextResponse.json(
        {
          ok: false,
          error: `Refusing deep pagination (offset ${skipRows} exceeds max ${maxListSkip}). Narrow filters or lower the page index.`,
          code: "AGENTS_LIST_PAGE_TOO_DEEP",
          maxSkip: maxListSkip,
          requestedSkip: skipRows,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    /** Page-1 text search: pull a larger pool by score, then rank by name/PDA relevance so SAP agents match. */
    const relevanceScoreSortActive =
      Boolean(search) &&
      page === 1 &&
      Boolean(listSelect) &&
      !isProtocolTrustSort &&
      sort !== "recommended" &&
      !(balancedRecentFeed && sort === "balanced_recent" && listView) &&
      sort === "profile_desc";
    let protocolTrustSortMeta:
      | { capped: boolean; fullMatchCount: number; poolSize: number }
      | undefined;
    const listWork = withTransientPoolRetry(async () => {
      const countAgents = () => prisma.agent.count({ where });
      if (isProtocolTrustSort && listSelect) {
        const direction = sort === "protocol_trust_asc" ? "asc" : "desc";
        const fullCount = await countAgents();
        const poolSize = Math.min(PROTOCOL_TRUST_SORT_MAX_POOL, fullCount);
        const pool = await prisma.agent.findMany({
          where,
          select: listSelect,
          orderBy: [
            { score: "desc" },
            { totalFeedback: "desc" },
            { lastActiveAt: "desc" },
            ...(applySapRankingTieBreak ? [sapRegistrationSort] : []),
          ],
          take: poolSize,
        });
        const scored = pool.map((a) => {
          const aa = a as Record<string, unknown>;
          const protocolTrust = typeof aa.scoreMetadata === "number"
            ? computeProtocolTrustScoreFromAgentDimensions(aa as Parameters<typeof computeProtocolTrustScoreFromAgentDimensions>[0])
            : computeTrustScore(
                trustSignalsFromMetadataAndAgent({
                  ...a,
                  metadata: Array.isArray((a as { metadata?: unknown }).metadata)
                    ? ((a as unknown) as { metadata: Array<{ key: string; value: string }> }).metadata
                    : [],
                })
              );
          return { a, protocolTrust };
        });
        scored.sort((x, y) => {
          const td = direction === "desc" ? y.protocolTrust - x.protocolTrust : x.protocolTrust - y.protocolTrust;
          if (td !== 0) return td;
          const sd = y.a.score - x.a.score;
          if (sd !== 0) return sd;
          return y.a.totalFeedback - x.a.totalFeedback;
        });
        const ordered = scored.map((s) => s.a);
        const start = (page - 1) * perPage;
        const slice = ordered.slice(start, start + perPage);
        protocolTrustSortMeta = {
          capped: fullCount > PROTOCOL_TRUST_SORT_MAX_POOL,
          fullMatchCount: fullCount,
          poolSize: ordered.length,
        };
        return [slice, ordered.length] as const;
      }
      if (sort === "recommended" && listSelect && listView && page === 1) {
        const RECOMMENDATION_POOL = Math.min(perPage * 4, 80);
        const mixed = await loadRecommendedAgentPool({
          prisma,
          where,
          select: listSelect,
          poolSize: RECOMMENDATION_POOL,
          limit: perPage,
          extraOrderBy: applySapRankingTieBreak ? [sapRegistrationSort] : undefined,
        });
        const total = await countAgents();
        return [mixed, total] as const;
      }
      if (sort === "balanced_recent" && balancedRecentFeed && listSelect && listView && page === 1) {
        const agents = await agentsBalancedRecentRoundRobin(where, perPage, listSelect);
        const total = await countAgents();
        return [agents, total] as const;
      }
      const poolTake =
        relevanceScoreSortActive && listSelect ? Math.min(SEARCH_RELEVANCE_POOL_MAX, Math.max(perPage * 12, perPage)) : perPage;
      const poolSkip =
        relevanceScoreSortActive && listSelect ? 0 : (page - 1) * perPage;
      /** Sequential findMany + count: `Promise.all` starves the second query when pg pool `max` is 1 (common in .env.local). */
      const agents = listSelect
        ? await prisma.agent.findMany({
            where,
            select: listSelect,
            orderBy,
            skip: poolSkip,
            take: poolTake,
          })
        : await prisma.agent.findMany({
            where,
            include: { chain: true, services: { take: 10 } },
            orderBy,
            skip: poolSkip,
            take: poolTake,
          });
      const total = await countAgents();
      const agentsOut =
        relevanceScoreSortActive && listSelect && agents.length > 0
          ? [...agents]
              .sort((a, b) => {
                const ra = computeAgentSearchRelevanceAgent(
                  {
                    name: a.name,
                    description: a.description,
                    owner: a.owner,
                    sapAgentPda: typeof a.sapAgentPda === "string" ? a.sapAgentPda : null,
                    sapOwnerWallet: typeof a.sapOwnerWallet === "string" ? a.sapOwnerWallet : null,
                  },
                  search,
                );
                const rb = computeAgentSearchRelevanceAgent(
                  {
                    name: b.name,
                    description: b.description,
                    owner: b.owner,
                    sapAgentPda: typeof b.sapAgentPda === "string" ? b.sapAgentPda : null,
                    sapOwnerWallet: typeof b.sapOwnerWallet === "string" ? b.sapOwnerWallet : null,
                  },
                  search,
                );
                if (rb !== ra) return rb - ra;
                return Number(b.score) - Number(a.score);
              })
              .slice(0, perPage)
          : agents;
      return [agentsOut, total] as const;
    });
    const [agents, total] = await listWork;
    /** Verified page needs published MCP counts; a single groupBy avoids per-row `_count` subqueries in findMany (very slow on remote DBs). */
    let publishedMcpOfferCountByAgentId: Map<number, number> | undefined;
    if (verified === "true" && listView && agents.length > 0) {
      const ids = agents
        .map((a) => Number(a.id))
        .filter((id): id is number => Number.isFinite(id));
      const rows = await prisma.agentMcpOffer.groupBy({
        by: ["agentId"],
        where: { agentId: { in: ids }, isPublished: true },
        _count: { _all: true },
      });
      publishedMcpOfferCountByAgentId = new Map(rows.map((row) => [row.agentId, row._count._all]));
    }
    const sapTwinIndex = await getCachedSapTwinIndex();
    // hasDuplicateName is maintained transactionally for the affected normalized-name group.
    let agentsWithRank = attachSapTwinMatchToAgentsSync(
      agents.map((a) => {
      const dbRank = "rank" in a ? Number(a.rank) : 0;
      const dbDuplicate = "hasDuplicateName" in a ? Boolean(a.hasDuplicateName) : false;
      const extra = listView && !("description" in a) ? { description: "" } : {};
      const aa = a as Record<string, unknown>;
      // Always use computeProtocolTrustScoreFromAgentDimensions (dimension-based) for list views — matches the agent detail page.
      // Falls back to metadata-based computation only for non-list views.
      const protocolTrustScore =
        listView && typeof aa.scoreMetadata === "number" && typeof aa.scoreServices === "number"
          ? computeProtocolTrustScoreFromAgentDimensions(aa as Parameters<typeof computeProtocolTrustScoreFromAgentDimensions>[0])
          : computeTrustScore(
              trustSignalsFromMetadataAndAgent({
                isVerified: aa.isVerified === true,
                isPremiumVerified: aa.isPremiumVerified === true,
                stars: typeof aa.stars === "number" ? aa.stars : undefined,
                totalFeedback:
                  typeof aa.totalFeedback === "number" ? aa.totalFeedback : undefined,
                createdAt:
                  aa.createdAt instanceof Date || typeof aa.createdAt === "string"
                    ? (aa.createdAt as Date | string)
                    : undefined,
                metadata:
                  "metadata" in a && Array.isArray((a as { metadata?: unknown }).metadata)
                    ? (a as { metadata: Array<{ key: string; value: string }> }).metadata
                    : [],
              })
            );
      // Fallback protocolTrustScore to live-computed protocolTrustScore until backfill populates the DB column
      const storedProtocolTrustScore = typeof aa.protocolTrustScore === "number" ? aa.protocolTrustScore : 0;
      const storedExecutionScore = typeof aa.executionScore === "number" ? aa.executionScore : 0;
      const metaForScores =
        "metadata" in a && Array.isArray((a as { metadata?: unknown }).metadata)
          ? (a as { metadata: Array<{ key: string; value: string }> }).metadata
          : [];
      const r = aa;
      const liveExecutionScore = redactCompareExecution || skipRank
        ? 0
        : computeExecutionScore({
            isVerifiedRevenue: r.isVerifiedRevenue === true,
            verifiedWallet: typeof r.verifiedWallet === "string" ? r.verifiedWallet : undefined,
            scoreWallet: typeof r.scoreWallet === "number" ? r.scoreWallet : undefined,
            metadata: metaForScores,
            perfWinRate: typeof r.perfWinRate === "number" ? r.perfWinRate : undefined,
            perfMonthlyPnlUsd: typeof r.perfMonthlyPnlUsd === "number" ? r.perfMonthlyPnlUsd : undefined,
            perfBurnToEarnRatio: typeof r.perfBurnToEarnRatio === "number" ? r.perfBurnToEarnRatio : undefined,
            perfTxCount: typeof r.perfTxCount === "number" ? r.perfTxCount : undefined,
            activeWinRate30d: typeof r.activeWinRate30d === "number" ? r.activeWinRate30d : undefined,
            nativeVolume30d: typeof r.nativeVolume30d === "number" ? r.nativeVolume30d : undefined,
          });
      const publicExecutionScore = redactCompareExecution ? 0 : Math.max(storedExecutionScore, liveExecutionScore);
      const vw = typeof r.verifiedWallet === "string" ? r.verifiedWallet : "";
      // Strip optional _count from payload if ever present; verified MCP counts use batch groupBy above.
      const { _count, holderAgentPerks, ...agentRow } = r as typeof r & {
        _count?: unknown;
        holderAgentPerks?: ReadonlyArray<{ id: string; perkType: string; tierId?: string }>;
      };
      const holderPerkFlags = parseHolderPerkFlags(holderAgentPerks);
      const aaRow = aa as Record<string, unknown>;
      const storedScoring = attachAgentScoringPayloadFromStored({
        score: typeof aaRow.score === "number" ? aaRow.score : undefined,
        protocolTrustScore:
          storedProtocolTrustScore > 0
            ? storedProtocolTrustScore
            : protocolTrustScore,
        agentRankScore: typeof aaRow.agentRankScore === "number" ? aaRow.agentRankScore : undefined,
        activityScore: typeof aaRow.activityScore === "number" ? aaRow.activityScore : undefined,
        rank: dbRank,
        totalFeedback: typeof aaRow.totalFeedback === "number" ? aaRow.totalFeedback : undefined,
        stars: typeof aaRow.stars === "number" ? aaRow.stars : undefined,
        scoreQuality: typeof aaRow.scoreQuality === "number" ? aaRow.scoreQuality : undefined,
        x402Support: aaRow.x402Support === true,
        isVerifiedRevenue: aaRow.isVerifiedRevenue === true,
        binanceCompatible: aaRow.binanceCompatible === true,
        services:
          "services" in a && Array.isArray((a as { services?: unknown }).services)
            ? (a as { services: Array<{ name: string; endpoint: string }> }).services
            : [],
      });
      return {
        ...agentRow,
        ...extra,
        ...storedScoring,
        image: sanitizeAgentImageUrl(typeof agentRow.image === "string" ? agentRow.image : ""),
        rank: dbRank,
        organicRank: dbRank,
        hasDuplicateName: dbDuplicate,
        slug: toAgentUrlSlug(typeof aa.name === "string" ? aa.name : ""),
        profilePath: agentPublicPath({
          chainId: Number(aa.chainId),
          agentId: Number(aa.agentId),
          name: typeof aa.name === "string" ? aa.name : "",
        }),
        protocolTrustScore: storedScoring.protocolTrustScore,
        executionScore: publicExecutionScore,
        ...(verified === "true" && publishedMcpOfferCountByAgentId
          ? { publishedMcpOfferCount: publishedMcpOfferCountByAgentId.get(Number(r.id)) ?? 0 }
          : {}),
        ...(redactCompareExecution ? redactAgentExecutionForPublicViewer(vw, "undefined") : {}),
        ...holderPerkFlags,
      };
      }) as unknown as AgentRowForSapTwin[],
      sapTwinIndex,
    );
    if (listView) {
      const deduped = await dedupeAgentListByCluster(
        agentsWithRank as unknown as Parameters<typeof dedupeAgentListByCluster>[0],
      );
      agentsWithRank = deduped.map((row) => ({
        ...row,
        hasDuplicateName:
          row.deploymentCount > 1
            ? false
            : Boolean((row as { hasDuplicateName?: boolean }).hasDuplicateName),
      })) as typeof agentsWithRank;
    }
    if (verified === "true" && listView && agentsWithRank.length > 0) {
      const verifiedIds = (agentsWithRank as Array<{ id?: number }>)
        .map((row) => Number(row.id))
        .filter((id): id is number => Number.isFinite(id));
      const enrichment = await enrichVerifiedAgentsList(verifiedIds);
      agentsWithRank = applyVerifiedListEnrichment(
        agentsWithRank as unknown as Array<{ id: number }>,
        enrichment,
      ) as unknown as typeof agentsWithRank;
    }
    // Any list-style response (incl. perPage>20 without ?listView=): must not be edge-cached or
    // totals stay stale while the indexer runs.
    const explicitListView = listView;
    const cacheControl = explicitListView
      ? INTERACTIVE_AGENT_LIST_CACHE_CONTROL
      : "s-maxage=90, stale-while-revalidate=180";
    const responsePayload = {
      agents: agentsWithRank,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      ...(compareMode ? { compareDashboardUnlocked: compareShowsFullExecution } : {}),
      ...(protocolTrustSortMeta && { protocolTrustSort: protocolTrustSortMeta }),
    };
    return NextResponse.json(responsePayload, {
      headers: {
        "Cache-Control": cacheControl,
        ...(cacheControl.includes("no-store") ? { Pragma: "no-cache" } : {}),
      },
    });
  } catch (err) {
    if (err instanceof PublicApiCacheCoordinationError) {
      console.error("[api/agents] public cache coordination failed", err.cause ?? err);
      return NextResponse.json(
        { error: "Agent directory is temporarily unavailable" },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(err.retryAfterSeconds),
          },
        },
      );
    }
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("GET /api/agents error:", {
      error: msg,
      stack: Error.isError(err) ? err.stack : undefined,
      ...prismaApiErrorLogFields(msg),
    });
    const { body, status, headers } = prismaApiRouteErrorResponse(msg);
    return NextResponse.json(body, { status, headers });
  }
}
export async function GET(request: NextRequest) {
  return handleAgentsGet(request, false);
}
