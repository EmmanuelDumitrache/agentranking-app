import type { Prisma } from "@/generated/prisma/client";
import type { MetaplexDirectorySort } from "@/lib/metaplex/types";

export function normalizeMetaplexDirectorySort(
  sort: string | null | undefined,
): MetaplexDirectorySort {
  return sort === "agent_rank_desc" ? "agent_rank_desc" : "listed_desc";
}

export function metaplexDirectoryOrderBy(
  sort: MetaplexDirectorySort | string | null | undefined,
): Prisma.AgentOrderByWithRelationInput[] {
  if (normalizeMetaplexDirectorySort(sort) === "agent_rank_desc") {
    return [
      { agentRankScore: "desc" },
      { totalFeedback: "desc" },
      { metaplexLastIndexedAt: "desc" },
      { id: "desc" },
    ];
  }
  return [
    { metaplexLastIndexedAt: "desc" },
    { listedAt: "desc" },
    { createdAt: "desc" },
    { id: "desc" },
  ];
}

export type MetaplexSortableRow = {
  id: number;
  agentRankScore: number;
  metaplexLastIndexedAt: string | null;
};

function indexedAtMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function sortMetaplexDirectoryRows<T extends MetaplexSortableRow>(
  rows: T[],
  sort: MetaplexDirectorySort,
): T[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sort === "agent_rank_desc") {
      const rankDiff = b.agentRankScore - a.agentRankScore;
      if (rankDiff !== 0) return rankDiff;
      const timeDiff = indexedAtMs(b.metaplexLastIndexedAt) - indexedAtMs(a.metaplexLastIndexedAt);
      if (timeDiff !== 0) return timeDiff;
      return b.id - a.id;
    }
    const timeDiff = indexedAtMs(b.metaplexLastIndexedAt) - indexedAtMs(a.metaplexLastIndexedAt);
    if (timeDiff !== 0) return timeDiff;
    const rankDiff = b.agentRankScore - a.agentRankScore;
    if (rankDiff !== 0) return rankDiff;
    return b.id - a.id;
  });
  return copy;
}
