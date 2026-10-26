import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { isLikelySolanaPubkey } from "@/lib/agents-search-scope";
import { prisma } from "@/lib/db";

const MIN_FUZZY_QUERY_CODE_POINTS = 3;
const MAX_FUZZY_QUERY_CODE_POINTS = 120;
const MAX_FUZZY_CANDIDATES = 80;
// Match pg_trgm's documented default similarity cutoff, but make it an
// application invariant instead of depending on a mutable session/cluster GUC.
const MIN_FUZZY_NAME_SIMILARITY = 0.3;
const MAX_FUZZY_NAME_DISTANCE = 1 - MIN_FUZZY_NAME_SIMILARITY;

export type AgentFuzzyNameCandidate = {
  readonly id: number;
};

type FindAgentFuzzyNameCandidatesInput = {
  readonly query: string;
  readonly limit?: number;
  readonly activeOnly?: boolean;
  readonly publiclyActiveOnly?: boolean;
};

function boundedQuery(rawQuery: string): string | null {
  const trimmed = rawQuery.trim();
  const length = Array.from(trimmed).length;
  if (length < MIN_FUZZY_QUERY_CODE_POINTS || length > MAX_FUZZY_QUERY_CODE_POINTS) {
    return null;
  }
  // Numeric IDs and pasted EVM/Solana identifiers have exact lookup semantics;
  // treating them as misspelled names only adds unrelated trigram neighbours.
  if (
    /^\d+$/.test(trimmed)
    || /^0x[0-9a-f]{8,}$/i.test(trimmed)
    || isLikelySolanaPubkey(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function boundedLimit(rawLimit: number | undefined): number {
  const limit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit ?? 0) : 0;
  return Math.max(1, Math.min(MAX_FUZZY_CANDIDATES, limit || 16));
}

/**
 * Return typo-tolerant agent-name candidates ordered by PostgreSQL trigram
 * nearest-neighbour distance. The database expression is deliberately identical
 * to the migration-managed GiST expression index, including `unaccent` search
 * normalization. Exact/substring lookup remains the caller's first pass; this
 * helper fills otherwise sparse result sets rather than changing exact-match
 * semantics.
 */
export async function findAgentFuzzyNameCandidates(
  input: FindAgentFuzzyNameCandidatesInput,
): Promise<AgentFuzzyNameCandidate[]> {
  const query = boundedQuery(input.query);
  if (!query) return [];

  const activeFilter = input.activeOnly
    ? Prisma.sql`AND a."isActive" = TRUE`
    : Prisma.empty;
  const publiclyActiveFilter = input.publiclyActiveOnly
    ? Prisma.sql`AND a.publicly_active = TRUE`
    : Prisma.empty;
  const limit = boundedLimit(input.limit);

  const rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT nearest.id
    FROM (
      SELECT
        a.id,
        a.score,
        public.agentranking_search_normalize(a.name)
          <-> public.agentranking_search_normalize(${query}) AS distance
      FROM "Agent" a
      WHERE TRUE
        ${activeFilter}
        ${publiclyActiveFilter}
      -- Keep KNN distance as the sole inner ordering key so the GiST index can
      -- produce the bounded candidate set directly. Stable score/id tie-breaks
      -- are applied only after that set is small. Do not use pg_trgm's
      -- percent-similarity (%) operator here: its cutoff is controlled by a mutable GUC.
      ORDER BY public.agentranking_search_normalize(a.name)
                 <-> public.agentranking_search_normalize(${query})
      LIMIT ${limit}
    ) nearest
    WHERE nearest.distance <= ${MAX_FUZZY_NAME_DISTANCE}
    ORDER BY nearest.distance, nearest.score DESC, nearest.id ASC
  `);

  return rows.map((row) => ({ id: Number(row.id) }));
}

export function orderRowsByFuzzyCandidates<T extends { readonly id: number }>(
  rows: readonly T[],
  candidates: readonly AgentFuzzyNameCandidate[],
): T[] {
  if (rows.length <= 1) return [...rows];
  const rank = new Map(candidates.map((candidate, index) => [candidate.id, index] as const));
  return [...rows].sort(
    (left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
