import { prisma } from "@/lib/db";
import {
  minRewardThreshold,
  parseMinRewardFilter,
  parsePostedWithinFilter,
  postedWithinCutoff,
} from "@/lib/jobs/list-filters";
import { compareJobsRecommended } from "@/lib/jobs/job-listing-quality";
import { resolvePartnerSourceStatus } from "@/lib/jobs/partners/branding";
import { PUBLIC_PARTNER_JOB_SELECT, PUBLIC_JOB_LIST_WHERE, toPublicPartnerJob } from "@/lib/jobs/public-job";
import type { JobSortOption, PublicPartnerJob } from "@/lib/jobs/types";
import type { Prisma } from "@/generated/prisma/client";
import { getOrInsertComputed } from "@/lib/map-upsert";
export type ListJobsParams = {
  source?: string;
  category?: string;
  q?: string;
  sort?: JobSortOption;
  minReward?: string;
  postedWithin?: string;
  page?: number;
  perPage?: number;
};
/** Semantic facets persisted natively on each row; source pseudo-filters map to the source column. */
const FACET_FILTERS = [
  "social",
  "human_feedback",
  "research",
  "data",
  "growth",
  "contests",
  "manual",
  "on_chain",
] as const;
function buildOrderBy(
  sort: JobSortOption,
): Prisma.PartnerJobOrderByWithRelationInput | Prisma.PartnerJobOrderByWithRelationInput[] {
  switch (sort) {
    case "reward_desc":
      return [{ rewardAmount: { sort: "desc", nulls: "last" } }, { lastSeenAt: "desc" }];
    case "reward_asc":
      return [{ rewardAmount: { sort: "asc", nulls: "last" } }, { lastSeenAt: "desc" }];
    case "oldest":
      return [{ firstSeenAt: "asc" }, { rewardAmount: "desc" }];
    default:
      return [{ lastSeenAt: "desc" }, { rewardAmount: "desc" }];
  }
}
function sortBestJobs(jobs: PublicPartnerJob[]): PublicPartnerJob[] {
  return [...jobs].sort(compareJobsRecommended);
}
export async function listPublicPartnerJobs(params: ListJobsParams) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(50, Math.max(1, params.perPage ?? 20));
  const sort = params.sort ?? "best";
  const categoryFilter = params.category?.toLowerCase() ?? "all";
  const sourceFilter = params.source?.toLowerCase();
  const minRewardFilter = parseMinRewardFilter(params.minReward);
  const postedWithinFilter = parsePostedWithinFilter(params.postedWithin);
  const minReward = minRewardThreshold(minRewardFilter);
  const postedAfter = postedWithinCutoff(postedWithinFilter);
  const where: Prisma.PartnerJobWhereInput = {
    ...PUBLIC_JOB_LIST_WHERE,
  };
  if (sourceFilter && sourceFilter !== "all") {
    where.source = sourceFilter;
  }
  // Category filtering is pushed fully into PostgreSQL. Source pseudo-filters
  // (`earnfi`/`wurk`) map to the native source column; semantic facets map to
  // the persisted `facets` array (GIN-indexed) instead of Node-side evaluation.
  if (categoryFilter === "earnfi" || categoryFilter === "wurk") {
    if (where.source && where.source !== categoryFilter) {
      // source and category filters are mutually exclusive — match nothing.
      where.id = "__none__";
    } else {
      where.source = categoryFilter;
    }
  } else if ((FACET_FILTERS as readonly string[]).includes(categoryFilter)) {
    where.facets = { has: categoryFilter };
  }
  if (minReward != null) {
    where.rewardAmount = { gte: minReward };
  }
  if (postedAfter) {
    where.firstSeenAt = { gte: postedAfter };
  }
  if (params.q?.trim()) {
    const q = params.q.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { jobType: { contains: q, mode: "insensitive" } },
    ];
  }
  const orderBy = buildOrderBy(sort);
  // Only the curated "best" ranking requires the full matching set in Node;
  // every other sort now runs with native predicates/ordering and SQL pagination.
  const requiresSemanticEvaluation = sort === "best";
  const [total, partners, syncMeta, activeBySource, ingestionGroups] = await Promise.all([
    prisma.partnerJob.count({ where }),
    prisma.jobPartnerSource.findMany(),
    prisma.jobPartnerSource.findMany({ select: { lastSyncAt: true, enabled: true } }),
    prisma.partnerJob.groupBy({
      by: ["source"],
      where: { status: { in: ["open", "paused"] }, isSample: false },
      _count: { _all: true },
    }),
    prisma.partnerJob.groupBy({
      by: ["source", "ingestionMode"],
      where: { status: { in: ["open", "paused"] }, isSample: false },
      _count: { _all: true },
    }),
  ]);
  const rows = requiresSemanticEvaluation
    ? await prisma.partnerJob.findMany({
        where,
        select: PUBLIC_PARTNER_JOB_SELECT,
        orderBy: { lastSeenAt: "desc" },
      })
    : await prisma.partnerJob.findMany({
        where,
        select: PUBLIC_PARTNER_JOB_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      });
  const activeCountMap = new Map(activeBySource.map((c) => [c.source, c._count._all]));
  const ingestionBySource = new Map<string, { api: number; feed: number; manual: number; seed: number }>();
  for (const row of ingestionGroups) {
    const current = getOrInsertComputed(ingestionBySource, row.source, () => ({
      api: 0,
      feed: 0,
      manual: 0,
      seed: 0,
    }));
    const mode = row.ingestionMode as keyof typeof current;
    if (mode in current) {
      current[mode] = row._count._all;
    }
  }
  const partnerMap = new Map(partners.map((p) => [p.source, p.displayName]));
  let jobs = rows.map((r) => toPublicPartnerJob(r, partnerMap.get(r.source) ?? r.source));
  let listTotal = total;
  if (requiresSemanticEvaluation) {
    jobs = sortBestJobs(jobs);
    listTotal = jobs.length;
    const start = (page - 1) * perPage;
    jobs = jobs.slice(start, start + perPage);
  }
  const syncTimes = syncMeta
    .filter((s) => s.enabled)
    .map((s) => s.lastSyncAt?.getTime() ?? 0)
    .filter((t) => t > 0);
  const lastSyncedAt =
    syncTimes.length > 0 ? new Date(Math.max(...syncTimes)).toISOString() : null;
  return {
    jobs,
    pagination: {
      page,
      perPage,
      total: listTotal,
      totalPages: Math.max(1, Math.ceil(listTotal / perPage)),
    },
    lastSyncedAt,
    partners: partners.map((p) => {
      const jobCount = activeCountMap.get(p.source) ?? 0;
      const status = resolvePartnerSourceStatus({
        source: p.source,
        enabled: p.enabled,
        lastSyncAt: p.lastSyncAt?.toISOString() ?? null,
        lastSyncStatus: p.lastSyncStatus,
        lastSyncError: p.lastSyncError,
        jobCount,
        jobsByIngestionMode: ingestionBySource.get(p.source),
      });
      return {
        source: p.source,
        displayName: p.displayName,
        websiteUrl: p.websiteUrl,
        docsUrl: p.docsUrl,
        enabled: p.enabled,
        lastSyncAt: p.lastSyncAt?.toISOString() ?? null,
        lastSyncStatus: p.lastSyncStatus,
        lastSyncError: p.lastSyncError,
        jobCount,
        displayStatus: status.displayStatus,
        statusDetail: status.statusDetail,
      };
    }),
  };
}