export type PublicFeedbackSort = "newest" | "oldest" | "highest" | "lowest";
export type PublicFeedbackSource = "all" | "onchain" | "platform";
export type PublicFeedbackQuery = {
  page: number;
  perPage: number;
  search: string;
  sort: PublicFeedbackSort;
  source: PublicFeedbackSource;
};
export type PublicFeedbackItem = {
  id: number;
  agentId: number;
  clientAddress: string;
  value: number;
  tag1: string | null;
  tag2: string | null;
  comment: string | null;
  createdAt: string;
  normalized: { displayScore: number; source: "site" | "onchain" };
  agent: {
    id: number;
    agentId: number;
    chainId: number;
    name: string;
    rank: number;
    slug: string;
    profilePath: string;
    chain: { name: string; shortName: string; color: string; icon: string };
  };
};
export type PublicFeedbackPageData = {
  feedbacks: PublicFeedbackItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  stats: { total: number; avgScore: number; uniqueUsers: number; last24h: number };
  generatedAt: string;
};
type SearchParamRecord = Record<string, string | string[] | undefined>;
function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function positiveInt(raw: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}
export function normalizePublicFeedbackQuery(input: SearchParamRecord): PublicFeedbackQuery {
  const rawSort = first(input.sort);
  const sort: PublicFeedbackSort =
    rawSort === "oldest" || rawSort === "highest" || rawSort === "lowest" ? rawSort : "newest";
  const rawSource = first(input.source);
  const source: PublicFeedbackSource =
    rawSource === "onchain" || rawSource === "platform" ? rawSource : "all";
  return {
    page: positiveInt(first(input.page), 1, 10_000),
    perPage: positiveInt(first(input.perPage), 10, 100),
    search: first(input.search).trim().slice(0, 160),
    sort,
    source,
  };
}
export function publicFeedbackQueryKey(query: PublicFeedbackQuery): readonly [string, number, string, PublicFeedbackSort, PublicFeedbackSource, number] {
  return ["feedback", query.page, query.search, query.sort, query.source, query.perPage];
}
