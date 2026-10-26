import "server-only";
import { cache } from "react";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { agentPublicPath } from "@/lib/agent-public-url";
import { agentProtocolLabel } from "@/lib/agent-rankable";
import { homeArScore, homeTrustDisplayLabel } from "@/lib/home-discovery-display";
import { sanitizeAgentImageUrl } from "@/lib/image-utils";
import { AGENTRANKING_NATIVE_CHAIN_ID } from "@/lib/chain-constants";
import { postgresAccentInsensitivePrefix } from "@/lib/postgres-search";
import { buildAgentsIndexHref } from "@/lib/ranking/agents-index-href";
import {
  getPublicApiCached,
  getPublicApiCacheNamespaceGeneration,
  publicApiCacheKey,
} from "@/lib/public-api-cache";

const PAGE_SIZE = 50;
const FIRST_PAGE_FRESH_TTL_SECONDS = 30;
const FIRST_PAGE_STALE_TTL_SECONDS = 120;
const SUMMARY_FRESH_TTL_SECONDS = 300;
const SUMMARY_STALE_TTL_SECONDS = 900;
const MAX_QUERY_CODE_POINTS = 80;
const MAX_CURSOR_LENGTH = 160;

const PUBLIC_RANKING_VERIFIED_SQL = Prisma.sql`(
  a."isVerified" = TRUE
  OR a."isPremiumVerified" = TRUE
  OR a."public_verification_status" = 'verified'
  OR a."sap_verified" = TRUE
  OR a."metaplex_verified" = TRUE
  OR a."ar_verification_status" = 'verified'
)`;

const PUBLIC_RANKING_VISIBLE_SQL = Prisma.sql`
  a."isActive" = TRUE
  AND a."publicly_active" = TRUE
  AND (
    a.rank > 0
    OR a."chainId" = ${AGENTRANKING_NATIVE_CHAIN_ID}
  )
  AND (
    a."cluster_key" IS NULL
    OR btrim(a."cluster_key") = ''
    OR a."cluster_key" = 'cluster:' || a."chainId"::text || ':' || a."agentId"::text
  )
  AND c."isActive" = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM "AgentBlocklistRule" rule
    WHERE rule.active = TRUE
      AND btrim(rule.value) <> ''
      AND (
        (rule."matchType" = 'name_contains' AND position(lower(rule.value) IN lower(a.name)) > 0)
        OR (rule."matchType" = 'name_exact' AND lower(btrim(a.name)) = lower(btrim(rule.value)))
        OR (rule."matchType" = 'uri_contains' AND position(lower(rule.value) IN lower(a."agentURI")) > 0)
        OR (rule."matchType" = 'uri_exact' AND a."agentURI" = rule.value)
        OR (rule."matchType" = 'owner_wallet' AND lower(btrim(a.owner)) = lower(btrim(rule.value)))
        OR (rule."matchType" = 'agent_key' AND btrim(rule.value) = a."chainId"::text || ':' || a."agentId"::text)
      )
  )
`;

/** One namespace-generation lookup is shared by all ranking reads in an RSC request. */
const readRankingCacheGeneration = cache(() =>
  getPublicApiCacheNamespaceGeneration("ranking"),
);

export type PublicRankingSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type PublicRankingDirection = "after" | "before";

export type PublicRankingCursor = {
  readonly version: 1;
  readonly rank: number;
  readonly id: number;
};

export type PublicRankingInput = {
  readonly query: string;
  readonly chainId: number | null;
  readonly verifiedOnly: boolean;
  readonly x402Only: boolean;
  readonly mppOnly: boolean;
  readonly direction: PublicRankingDirection;
  readonly cursor: PublicRankingCursor | null;
};

export type PublicRankingAgent = {
  readonly id: number;
  readonly rank: number;
  readonly agentId: number;
  readonly name: string;
  readonly image: string;
  readonly description: string;
  readonly lastActiveAt: string | null;
  readonly profilePath: string;
  readonly arScore: number;
  readonly trustLabel: "Verified" | "Low" | "Medium" | "High";
  readonly totalFeedback: number;
  readonly x402Support: boolean;
  readonly verified: boolean;
  readonly protocol: string;
  readonly chain: {
    readonly name: string;
    readonly shortName: string;
  };
};

export type PublicRankingPageData = {
  readonly agents: PublicRankingAgent[];
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly previousCursor: string | null;
  readonly nextCursor: string | null;
  readonly generatedAt: string;
};

type PublicRankingPageSnapshot = Omit<PublicRankingPageData, "generatedAt">;

export type PublicRankingChain = {
  readonly chainId: number;
  readonly name: string;
  readonly shortName: string;
  readonly agentCount: number;
};

export type PublicRankingSummary = {
  readonly totalAgents: number;
  readonly verifiedAgents: number;
  readonly totalChains: number;
  readonly x402Agents: number;
  readonly mppAgents: number;
  /** Every stored agent row, including inactive and unranked. */
  readonly indexedAgents: number;
  /** Ranked-list agents that also pass a verification flag. */
  readonly rankedVerifiedAgents: number;
  /** Active in the warehouse but hidden from the ranked list. */
  readonly activeUnrankedAgents: number;
  /** Inactive rows — empty registrations, junk names, blocked, or incomplete. */
  readonly deadOrSpamAgents: number;
  readonly chains: PublicRankingChain[];
};

type PublicRankingDbRow = {
  id: number;
  rank: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string;
  description: string;
  lastActiveAt: Date | string | null;
  agentRankScore: number;
  totalFeedback: number;
  protocolTrustScore: number;
  x402Support: boolean;
  isVerified: boolean;
  isPremiumVerified: boolean;
  publicVerificationStatus: string;
  sapVerified: boolean;
  metaplexVerified: boolean;
  listingRegistrySource: string;
  arVerificationStatus: string;
  chainName: string;
  chainShortName: string;
};

type PublicRankingSummaryDbRow = {
  totalAgents: bigint | number;
  verifiedAgents: bigint | number;
  totalChains: bigint | number;
  x402Agents: bigint | number;
  mppAgents: bigint | number;
  indexedAgents: bigint | number;
  rankedVerifiedAgents: bigint | number;
  activeUnrankedAgents: bigint | number;
  deadOrSpamAgents: bigint | number;
  chainId: number | null;
  chainName: string | null;
  chainShortName: string | null;
  chainAgentCount: bigint | number | null;
};

type QueryRankingBatchInput = {
  readonly queryPrefix: string | null;
  readonly chainId: number | null;
  readonly verifiedOnly: boolean;
  readonly x402Only: boolean;
  readonly mppOnly: boolean;
  readonly direction: PublicRankingDirection;
  readonly cursor: PublicRankingCursor | null;
  readonly limit: number;
};

function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeQuery(value: string | undefined): string {
  const normalized = (value ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .replace(/\s+/g, " ");
  return Array.from(normalized).slice(0, MAX_QUERY_CODE_POINTS).join("");
}

function parsePositivePostgresInt(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647
    ? parsed
    : null;
}

function parseBooleanFlag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function encodePublicRankingCursor(
  cursor: PublicRankingCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodePublicRankingCursor(
  value: string | undefined,
): PublicRankingCursor | null {
  if (!value || value.length > MAX_CURSOR_LENGTH) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<PublicRankingCursor>;
    const rank = parsed.rank;
    const id = parsed.id;
    if (
      parsed.version !== 1 ||
      typeof rank !== "number" ||
      typeof id !== "number" ||
      !Number.isSafeInteger(rank) ||
      !Number.isSafeInteger(id) ||
      rank < 0 ||
      id <= 0
    ) {
      return null;
    }
    return { version: 1, rank, id };
  } catch {
    return null;
  }
}

export function parsePublicRankingInput(
  searchParams: PublicRankingSearchParams,
): PublicRankingInput {
  const beforeRaw = firstSearchParam(searchParams.before);
  const afterRaw = firstSearchParam(searchParams.after);
  const before = decodePublicRankingCursor(beforeRaw);
  const after = decodePublicRankingCursor(afterRaw);
  return {
    query: normalizeQuery(firstSearchParam(searchParams.q)),
    chainId: parsePositivePostgresInt(firstSearchParam(searchParams.chain)),
    verifiedOnly: parseBooleanFlag(firstSearchParam(searchParams.verified)),
    x402Only: parseBooleanFlag(firstSearchParam(searchParams.x402)),
    mppOnly: parseBooleanFlag(firstSearchParam(searchParams.mpp)),
    direction: before ? "before" : "after",
    cursor: before ?? after,
  };
}

export function buildPublicRankingHref(
  input: PublicRankingInput,
  pagination?: { readonly after?: string | null; readonly before?: string | null },
): string {
  return buildAgentsIndexHref(input, pagination);
}

function verifiedSqlForRow(row: PublicRankingDbRow): boolean {
  return (
    row.isVerified ||
    row.isPremiumVerified ||
    row.sapVerified ||
    row.metaplexVerified ||
    row.publicVerificationStatus === "verified" ||
    row.arVerificationStatus === "verified"
  );
}

function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toPublicRankingAgent(row: PublicRankingDbRow): PublicRankingAgent {
  const verified = verifiedSqlForRow(row);
  return {
    id: row.id,
    rank: row.rank,
    agentId: row.agentId,
    name: row.name,
    image: sanitizeAgentImageUrl(row.image),
    description: (row.description ?? "").trim().slice(0, 4_000),
    lastActiveAt: toIsoTimestamp(row.lastActiveAt),
    profilePath: agentPublicPath(row),
    arScore: homeArScore(row),
    trustLabel: homeTrustDisplayLabel({
      protocolTrustScore: row.protocolTrustScore,
      isVerified: verified,
      isPremiumVerified: false,
    }),
    totalFeedback: Math.max(0, row.totalFeedback),
    x402Support: row.x402Support,
    verified,
    protocol: agentProtocolLabel(row),
    chain: {
      name: row.chainName,
      shortName: row.chainShortName,
    },
  };
}

function cursorForRow(row: PublicRankingDbRow): PublicRankingCursor {
  return { version: 1, rank: row.rank, id: row.id };
}

async function queryRankingBatch(
  input: QueryRankingBatchInput,
): Promise<PublicRankingDbRow[]> {
  const chainFilter =
    input.chainId == null
      ? Prisma.empty
      : Prisma.sql`AND a."chainId" = ${input.chainId}`;
  const queryFilter =
    input.queryPrefix == null
      ? Prisma.empty
      : Prisma.sql`AND ${postgresAccentInsensitivePrefix(Prisma.sql`a.name`, input.queryPrefix)}`;
  const verifiedFilter = input.verifiedOnly
    ? Prisma.sql`AND ${PUBLIC_RANKING_VERIFIED_SQL}`
    : Prisma.empty;
  const x402Filter = input.x402Only
    ? Prisma.sql`AND a."x402Support" = TRUE`
    : Prisma.empty;
  const mppFilter = input.mppOnly
    ? Prisma.sql`AND a."mppSupport" = TRUE`
    : Prisma.empty;
  const cursorFilter =
    input.cursor == null
      ? Prisma.empty
      : input.direction === "before"
        ? Prisma.sql`AND (a.rank, a.id) < (${input.cursor.rank}, ${input.cursor.id})`
        : Prisma.sql`AND (a.rank, a.id) > (${input.cursor.rank}, ${input.cursor.id})`;
  const orderBy =
    input.direction === "before"
      ? Prisma.sql`a.rank DESC, a.id DESC`
      : Prisma.sql`a.rank ASC, a.id ASC`;

  return prisma.$queryRaw<PublicRankingDbRow[]>`
    SELECT
      a.id,
      a.rank,
      a."agentId",
      a."chainId",
      a.name,
      a.image,
      a.description,
      a."lastActiveAt",
      a."agentRankScore",
      a."totalFeedback",
      a."protocolTrustScore",
      a."x402Support",
      a."isVerified",
      a."isPremiumVerified",
      a."public_verification_status" AS "publicVerificationStatus",
      a."sap_verified" AS "sapVerified",
      a."metaplex_verified" AS "metaplexVerified",
      a."listing_registry_source" AS "listingRegistrySource",
      a."ar_verification_status" AS "arVerificationStatus",
      c.name AS "chainName",
      c."shortName" AS "chainShortName"
    FROM "Agent" a
    INNER JOIN "Chain" c ON c."chainId" = a."chainId"
    WHERE ${PUBLIC_RANKING_VISIBLE_SQL}
      ${chainFilter}
      ${queryFilter}
      ${verifiedFilter}
      ${x402Filter}
      ${mppFilter}
      ${cursorFilter}
    ORDER BY ${orderBy}
    LIMIT ${input.limit}
  `;
}

async function queryPublicRankingPage(
  input: PublicRankingInput,
): Promise<PublicRankingPageSnapshot> {
  const rows = await queryRankingBatch({
    queryPrefix: input.query || null,
    chainId: input.chainId,
    verifiedOnly: input.verifiedOnly,
    x402Only: input.x402Only,
    mppOnly: input.mppOnly,
    direction: input.direction,
    cursor: input.cursor,
    limit: PAGE_SIZE + 1,
  });
  const hasMoreInDirection = rows.length > PAGE_SIZE;
  const selected = rows.slice(0, PAGE_SIZE);
  const displayRows = input.direction === "before" ? selected.reverse() : selected;
  const first = displayRows[0];
  const last = displayRows.at(-1);

  return {
    agents: displayRows.map(toPublicRankingAgent),
    hasPrevious:
      input.direction === "before" ? hasMoreInDirection : input.cursor != null,
    hasNext:
      input.direction === "before" ? input.cursor != null : hasMoreInDirection,
    previousCursor: first
      ? encodePublicRankingCursor(cursorForRow(first))
      : input.direction === "after" && input.cursor
        ? encodePublicRankingCursor(input.cursor)
        : null,
    nextCursor: last
      ? encodePublicRankingCursor(cursorForRow(last))
      : input.direction === "before" && input.cursor
        ? encodePublicRankingCursor(input.cursor)
        : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isNullableBoundedString(
  value: unknown,
  maxLength: number,
): value is string | null {
  return value === null || isBoundedString(value, maxLength);
}

function isPublicRankingAgent(value: unknown): value is PublicRankingAgent {
  if (!isRecord(value) || !isRecord(value.chain)) return false;
  return (
    isSafePositiveInteger(value.id) &&
    isSafeNonNegativeInteger(value.rank) &&
    // Application-native agents use negative compatibility IDs; the database
    // row ID remains the positive public identity boundary.
    Number.isSafeInteger(value.agentId) &&
    isBoundedString(value.name, 512) &&
    isBoundedString(value.image, 2_048) &&
    isBoundedString(value.description, 4_096) &&
    isNullableBoundedString(value.lastActiveAt, 64) &&
    isBoundedString(value.profilePath, 2_048) &&
    typeof value.arScore === "number" &&
    Number.isFinite(value.arScore) &&
    ["Verified", "Low", "Medium", "High"].includes(
      String(value.trustLabel),
    ) &&
    isSafeNonNegativeInteger(value.totalFeedback) &&
    typeof value.x402Support === "boolean" &&
    typeof value.verified === "boolean" &&
    isBoundedString(value.protocol, 128) &&
    isBoundedString(value.chain.name, 256) &&
    isBoundedString(value.chain.shortName, 64)
  );
}

function isPublicRankingPageSnapshot(
  value: unknown,
): value is PublicRankingPageSnapshot {
  if (
    !isRecord(value) ||
    !Array.isArray(value.agents) ||
    value.agents.length > PAGE_SIZE
  ) {
    return false;
  }
  return (
    value.agents.every(isPublicRankingAgent) &&
    typeof value.hasPrevious === "boolean" &&
    typeof value.hasNext === "boolean" &&
    isNullableBoundedString(value.previousCursor, MAX_CURSOR_LENGTH) &&
    isNullableBoundedString(value.nextCursor, MAX_CURSOR_LENGTH)
  );
}

function firstRankingPageCacheKey(
  input: PublicRankingInput,
  generation: number,
): string {
  const params = new URLSearchParams();
  if (input.chainId != null) params.set("chain", String(input.chainId));
  if (input.verifiedOnly) params.set("verified", "1");
  if (input.x402Only) params.set("x402", "1");
  if (input.mppOnly) params.set("mpp", "1");
  return publicApiCacheKey(`ranking:g${generation}:first-page`, params);
}

export async function readPublicRankingPage(
  input: PublicRankingInput,
): Promise<PublicRankingPageData> {
  if (!input.query && input.cursor == null && input.direction === "after") {
    const generation = await readRankingCacheGeneration();
    const result = await getPublicApiCached({
      key: firstRankingPageCacheKey(input, generation),
      freshTtlSeconds: FIRST_PAGE_FRESH_TTL_SECONDS,
      staleTtlSeconds: FIRST_PAGE_STALE_TTL_SECONDS,
      maxPayloadBytes: 512 * 1_024,
      leaseTtlMs: 45_000,
      leaseWaitMs: 15_000,
      load: () => queryPublicRankingPage(input),
      validate: isPublicRankingPageSnapshot,
    });
    return { ...result.value, generatedAt: result.generatedAt };
  }

  const snapshot = await queryPublicRankingPage(input);
  return { ...snapshot, generatedAt: new Date().toISOString() };
}

function toSafeCount(value: bigint | number | undefined, label: string): number {
  const numberValue = typeof value === "bigint" ? Number(value) : value ?? 0;
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new Error(`${label} is outside the safe integer range`);
  }
  return numberValue;
}

async function queryPublicRankingSummary(): Promise<PublicRankingSummary> {
  // Ranked-list counts still come from the visibility predicate (canonical
  // cluster member, active, ranked). Corpus counts scan every Agent row so the
  // ranking page can show indexed vs dead/spam vs the scored subset.
  const rows = await prisma.$queryRaw<PublicRankingSummaryDbRow[]>`
    WITH ranked_visible AS MATERIALIZED (
      SELECT
        a.id,
        a."chainId" AS "chainId",
        c.name AS "chainName",
        c."shortName" AS "chainShortName",
        (${PUBLIC_RANKING_VERIFIED_SQL}) AS verified,
        a."x402Support" AS "x402Support",
        a."mppSupport" AS "mppSupport"
      FROM "Agent" a
      INNER JOIN "Chain" c ON c."chainId" = a."chainId"
      WHERE ${PUBLIC_RANKING_VISIBLE_SQL}
    ),
    per_chain AS MATERIALIZED (
      SELECT
        "chainId",
        "chainName",
        "chainShortName",
        COUNT(*)::bigint AS "agentCount",
        COUNT(*) FILTER (WHERE verified)::bigint AS "verifiedCount",
        COUNT(*) FILTER (WHERE "x402Support" = TRUE)::bigint AS "x402Count",
        COUNT(*) FILTER (WHERE "mppSupport" = TRUE)::bigint AS "mppCount"
      FROM ranked_visible
      GROUP BY "chainId", "chainName", "chainShortName"
    ),
    totals AS (
      SELECT
        COALESCE(SUM("agentCount"), 0)::bigint AS "totalAgents",
        COALESCE(SUM("verifiedCount"), 0)::bigint AS "verifiedAgents",
        COUNT(*)::bigint AS "totalChains",
        COALESCE(SUM("x402Count"), 0)::bigint AS "x402Agents",
        COALESCE(SUM("mppCount"), 0)::bigint AS "mppAgents"
      FROM per_chain
    ),
    corpus AS (
      SELECT
        COUNT(*)::bigint AS "indexedAgents",
        COUNT(*) FILTER (WHERE rv.id IS NOT NULL AND rv.verified)::bigint AS "rankedVerifiedAgents",
        COUNT(*) FILTER (WHERE rv.id IS NULL AND a."isActive" = TRUE)::bigint AS "activeUnrankedAgents",
        COUNT(*) FILTER (WHERE rv.id IS NULL AND a."isActive" = FALSE)::bigint AS "deadOrSpamAgents"
      FROM "Agent" a
      LEFT JOIN ranked_visible rv ON rv.id = a.id
    )
    SELECT
      totals."totalAgents",
      totals."verifiedAgents",
      totals."totalChains",
      totals."x402Agents",
      totals."mppAgents",
      corpus."indexedAgents",
      corpus."rankedVerifiedAgents",
      corpus."activeUnrankedAgents",
      corpus."deadOrSpamAgents",
      per_chain."chainId",
      per_chain."chainName",
      per_chain."chainShortName",
      per_chain."agentCount" AS "chainAgentCount"
    FROM totals
    CROSS JOIN corpus
    LEFT JOIN per_chain ON TRUE
    ORDER BY per_chain."chainName" ASC NULLS LAST, per_chain."chainId" ASC NULLS LAST
  `;
  const summary = rows[0];
  const chains = rows.flatMap((row: PublicRankingSummaryDbRow): PublicRankingChain[] => {
    if (
      row.chainId == null ||
      row.chainName == null ||
      row.chainShortName == null ||
      row.chainAgentCount == null
    ) {
      return [];
    }
    return [
      {
        chainId: row.chainId,
        name: row.chainName,
        shortName: row.chainShortName,
        agentCount: toSafeCount(row.chainAgentCount, "Ranking chain agent count"),
      },
    ];
  });

  return {
    totalAgents: toSafeCount(summary?.totalAgents, "Ranking agent count"),
    verifiedAgents: toSafeCount(
      summary?.verifiedAgents,
      "Verified ranking agent count",
    ),
    totalChains: toSafeCount(summary?.totalChains, "Ranking chain count"),
    x402Agents: toSafeCount(summary?.x402Agents, "x402 ranking agent count"),
    mppAgents: toSafeCount(summary?.mppAgents, "MPP ranking agent count"),
    indexedAgents: toSafeCount(summary?.indexedAgents, "Indexed agent count"),
    rankedVerifiedAgents: toSafeCount(
      summary?.rankedVerifiedAgents,
      "Ranked verified agent count",
    ),
    activeUnrankedAgents: toSafeCount(
      summary?.activeUnrankedAgents,
      "Active unranked agent count",
    ),
    deadOrSpamAgents: toSafeCount(
      summary?.deadOrSpamAgents,
      "Dead or spam agent count",
    ),
    chains,
  };
}

function isPublicRankingChain(value: unknown): value is PublicRankingChain {
  return (
    isRecord(value) &&
    isSafePositiveInteger(value.chainId) &&
    isBoundedString(value.name, 256) &&
    isBoundedString(value.shortName, 64) &&
    isSafeNonNegativeInteger(value.agentCount)
  );
}

function isPublicRankingSummary(value: unknown): value is PublicRankingSummary {
  if (
    !isRecord(value) ||
    !Array.isArray(value.chains) ||
    value.chains.length > 10_000
  ) {
    return false;
  }
  return (
    isSafeNonNegativeInteger(value.totalAgents) &&
    isSafeNonNegativeInteger(value.verifiedAgents) &&
    isSafeNonNegativeInteger(value.totalChains) &&
    isSafeNonNegativeInteger(value.x402Agents) &&
    isSafeNonNegativeInteger(value.mppAgents) &&
    isSafeNonNegativeInteger(value.indexedAgents) &&
    isSafeNonNegativeInteger(value.rankedVerifiedAgents) &&
    isSafeNonNegativeInteger(value.activeUnrankedAgents) &&
    isSafeNonNegativeInteger(value.deadOrSpamAgents) &&
    value.verifiedAgents <= value.totalAgents &&
    value.x402Agents <= value.totalAgents &&
    value.mppAgents <= value.totalAgents &&
    value.rankedVerifiedAgents <= value.totalAgents &&
    value.indexedAgents >= value.totalAgents &&
    value.totalChains === value.chains.length &&
    value.chains.every(isPublicRankingChain)
  );
}

export async function readPublicRankingSummary(): Promise<PublicRankingSummary> {
  const generation = await readRankingCacheGeneration();
  const result = await getPublicApiCached({
    key: `ranking:g${generation}:summary:v3`,
    freshTtlSeconds: SUMMARY_FRESH_TTL_SECONDS,
    staleTtlSeconds: SUMMARY_STALE_TTL_SECONDS,
    maxPayloadBytes: 256 * 1_024,
    leaseTtlMs: 60_000,
    leaseWaitMs: 20_000,
    load: queryPublicRankingSummary,
    validate: isPublicRankingSummary,
  });
  return result.value;
}
