import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { fetchEarnFiJobs, isEarnFiSyncFailure, type EarnFiFetchResult } from "@/lib/jobs/partners/earnfi";
import { fetchPartnerFeed } from "@/lib/jobs/partners/feed";
import { fetchWurkJobs } from "@/lib/jobs/partners/wurk";
import { fetchWurkPrices } from "@/lib/jobs/partners/wurk-prices";
import { normalizeEarnFiJob, normalizeWurkJob } from "@/lib/jobs/normalize";
import { ensureDefaultJobPartnerSourcesIfEmpty, ENABLED_PARTNER_SOURCE_COUNT } from "@/lib/jobs/partner-sources";
import {
  getEarnFiJobsListUrl,
  getEarnFiStaleGraceHours,
  getPartnerApiKey,
  getPartnerFeedUrl,
} from "@/lib/jobs/partner-env";
import { resolvePartnerSourceStatus } from "@/lib/jobs/partners/branding";
import type { PartnerJobSource, PartnerJobUpsertInput, PartnerSyncResult } from "@/lib/jobs/types";
import { Prisma } from "@/generated/prisma/client";
import { getOrInsertComputed } from "@/lib/map-upsert";
const STALE_CLOSE_STATUSES = ["open", "paused"] as const;
const PARTNER_JOB_UPSERT_BATCH_SIZE = 500;
export async function syncPartnerSource(source: PartnerJobSource): Promise<PartnerSyncResult> {
  const partnerRow = await prisma.jobPartnerSource.findUnique({ where: { source } });
  if (!partnerRow?.enabled) {
    return { source, ok: true, fetched: 0, upserted: 0, staleClosed: 0, error: "disabled" };
  }
  const feedUrl = getPartnerFeedUrl(source);
  if (feedUrl) {
    return syncFromFeed(source, feedUrl);
  }
  return syncFromApi(source);
}
async function syncFromFeed(source: PartnerJobSource, feedUrl: string): Promise<PartnerSyncResult> {
  try {
    const feedResult = await fetchPartnerFeed(feedUrl, source);
    if (feedResult.error && feedResult.jobs.length === 0) {
      await updatePartnerSourceMeta(source, {
        lastSyncStatus: "error",
        lastSyncError: feedResult.error,
        lastIngestionMode: "feed",
      });
      return {
        source,
        ok: false,
        fetched: 0,
        upserted: 0,
        staleClosed: 0,
        error: feedResult.error,
      };
    }
    const now = new Date();
    const jobs = feedResult.jobs.map((job) => ({ ...job, ingestionMode: "feed" as const }));
    const upserted = await upsertPartnerJobs(jobs, now);
    const seenExternalIds = feedResult.jobs.map((job) => job.externalId);
    const staleClosed = await closeStaleJobs(source, seenExternalIds, now, "feed");
    await updatePartnerSourceMeta(source, {
      lastSyncStatus: feedResult.errors.length > 0 ? "partial" : "ok",
      lastSyncError:
        feedResult.errors.length > 0
          ? `Skipped ${feedResult.skipped} rows: ${feedResult.errors.slice(0, 3).join("; ")}`
          : null,
      lastIngestionMode: "feed",
    });
    return {
      source,
      ok: true,
      fetched: feedResult.jobs.length + feedResult.skipped,
      upserted,
      staleClosed,
      error: feedResult.errors.length > 0 ? feedResult.errors.join("; ") : undefined,
    };
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    await updatePartnerSourceMeta(source, {
      lastSyncStatus: "error",
      lastSyncError: msg,
      lastIngestionMode: "feed",
    });
    return { source, ok: false, fetched: 0, upserted: 0, staleClosed: 0, error: msg };
  }
}
async function syncFromApi(source: PartnerJobSource): Promise<PartnerSyncResult> {
  try {
    const fetchResult =
      source === "earnfi"
        ? await fetchEarnFiJobs(process.env.EARNFI_WORK_API_KEY)
        : await fetchWurkJobs(process.env.WURK_API_KEY);
    const earnfiMeta = source === "earnfi" ? extractEarnFiMeta(fetchResult as EarnFiFetchResult) : {};
    if (shouldAbortApiSync(source, fetchResult)) {
      const isWurkAwaitingFeed =
        source === "wurk" && fetchResult.errorCode === "awaiting_feed";
      const isWurkRateLimited =
        source === "wurk" && fetchResult.errorCode === "rate_limited";
      const nonFatal = isWurkAwaitingFeed || isWurkRateLimited;
      await updatePartnerSourceMeta(source, {
        lastSyncAt: new Date(),
        lastSyncStatus: isWurkRateLimited ? "partial" : nonFatal ? "ok" : "error",
        lastSyncError: isWurkAwaitingFeed
          ? null
          : (fetchResult.error ?? "Partner API sync failed"),
        lastIngestionMode: "api",
        ...earnfiMeta,
      });
      return {
        source,
        ok: nonFatal,
        fetched: 0,
        upserted: 0,
        staleClosed: 0,
        error: nonFatal ? undefined : fetchResult.error,
      };
    }
    const normalized =
      source === "earnfi"
        ? fetchResult.jobs.map((j) => ({
            ...normalizeEarnFiJob(j),
            ingestionMode: "api" as const,
            isSample: false,
          }))
        : await (async () => {
            const wurkPrices = await fetchWurkPrices();
            const wurkContext = wurkPrices ? { wurkUsd: wurkPrices.wurkUsd } : undefined;
            return fetchResult.jobs.map((j) => ({
              ...normalizeWurkJob(j, wurkContext),
              ingestionMode: "api" as const,
              isSample: false,
            }));
          })();
    const now = new Date();
    const upserted = await upsertPartnerJobs(normalized, now);
    const seenExternalIds = normalized.map((job) => job.externalId);
    const isCleanSuccess = !fetchResult.error && !hasEarnFiErrorCode(fetchResult);
    const staleClosed =
      isCleanSuccess && seenExternalIds.length > 0
        ? await closeStaleJobs(source, seenExternalIds, now, "api", source === "earnfi")
        : 0;
    const syncStatus = fetchResult.error ? "partial" : "ok";
    await updatePartnerSourceMeta(source, {
      lastSyncAt: now,
      lastSyncStatus: syncStatus,
      lastSyncError: fetchResult.error?.slice(0, 2000) ?? null,
      lastIngestionMode: "api",
      lastSuccessfulSyncAt: syncStatus === "ok" ? now : undefined,
      ...earnfiMeta,
    });
    return {
      source,
      ok: true,
      fetched: fetchResult.jobs.length,
      upserted,
      staleClosed,
      error: fetchResult.error,
    };
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    await updatePartnerSourceMeta(source, {
      lastSyncAt: new Date(),
      lastSyncStatus: "error",
      lastSyncError: msg.slice(0, 2000),
      lastIngestionMode: "api",
      endpointUsed: source === "earnfi" ? `GET ${getEarnFiJobsListUrl()}` : null,
    });
    return { source, ok: false, fetched: 0, upserted: 0, staleClosed: 0, error: msg };
  }
}
function hasEarnFiErrorCode(
  fetchResult: EarnFiFetchResult | { errorCode?: string },
): boolean {
  return "errorCode" in fetchResult && Boolean(fetchResult.errorCode);
}
function shouldAbortApiSync(
  source: PartnerJobSource,
  fetchResult: { jobs: unknown[]; error?: string; errorCode?: string },
): boolean {
  if (fetchResult.jobs.length > 0) return false;
  if (source === "earnfi" && isEarnFiSyncFailure(fetchResult as EarnFiFetchResult)) {
    return true;
  }
  if (fetchResult.errorCode === "missing_api_key" || fetchResult.errorCode === "awaiting_feed") {
    return true;
  }
  return Boolean(fetchResult.error);
}
function extractEarnFiMeta(fetchResult: EarnFiFetchResult): {
  authModeUsed?: string | null;
  lastHttpStatus?: number | null;
  endpointUsed?: string | null;
} {
  return {
    authModeUsed: fetchResult.authModeUsed ?? null,
    lastHttpStatus: fetchResult.httpStatus ?? null,
    endpointUsed: fetchResult.endpointUsed ?? `GET ${getEarnFiJobsListUrl()}`,
  };
}
export async function closeStaleJobs(
  source: PartnerJobSource,
  seenExternalIds: string[],
  now: Date,
  ingestionMode: string,
  applyGrace = false,
): Promise<number> {
  if (seenExternalIds.length === 0) return 0;
  const graceCutoff =
    applyGrace && source === "earnfi"
      ? new Date(now.getTime() - getEarnFiStaleGraceHours() * 60 * 60 * 1000)
      : null;
  const gracePredicate = graceCutoff
    ? Prisma.sql`AND job.last_seen_at < ${graceCutoff}`
    : Prisma.sql``;
  return prisma.$executeRaw(Prisma.sql`
    WITH seen AS MATERIALIZED (
      SELECT value AS external_id
      FROM jsonb_array_elements_text(${JSON.stringify(seenExternalIds)}::jsonb)
    )
    UPDATE partner_jobs AS job
    SET status = 'closed', updated_at = ${now}
    WHERE job.source = ${source}
      AND job.status IN (${Prisma.join([...STALE_CLOSE_STATUSES])})
      AND job.ingestion_mode = ${ingestionMode}
      AND job.is_sample = FALSE
      ${gracePredicate}
      AND NOT EXISTS (
        SELECT 1
        FROM seen
        WHERE seen.external_id = job.external_id
      )
  `);
}

async function upsertPartnerJobs(
  jobs: readonly PartnerJobUpsertInput[],
  now: Date,
): Promise<number> {
  if (jobs.length === 0) return 0;
  const uniqueJobs = new Map<string, PartnerJobUpsertInput>();
  for (const job of jobs) {
    uniqueJobs.set(`${job.source}\u0000${job.externalId}`, job);
  }
  const rows = [...uniqueJobs.values()].map((job) => ({
    id: randomUUID(),
    source: job.source,
    external_id: job.externalId,
    title: job.title,
    description: job.description,
    category: job.category,
    job_type: job.jobType,
    reward_amount:
      job.rewardAmount != null && job.rewardAmount !== ""
        ? new Prisma.Decimal(job.rewardAmount).toString()
        : null,
    reward_currency: job.rewardCurrency,
    chain: job.chain,
    status: job.status,
    apply_url: job.applyUrl,
    source_job_url: job.sourceJobUrl,
    source_status_url: job.sourceStatusUrl,
    source_secret: job.sourceSecret,
    requirements: job.requirements ?? null,
    tags: job.tags,
    facets: job.facets ?? [],
    raw: job.raw ?? null,
    ingestion_mode: job.ingestionMode ?? "api",
    featured: job.featured ?? false,
    curated_by: job.curatedBy ?? null,
    is_sample: job.isSample ?? false,
    expires_at: job.expiresAt,
  }));
  for (let offset = 0; offset < rows.length; offset += PARTNER_JOB_UPSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + PARTNER_JOB_UPSERT_BATCH_SIZE);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO partner_jobs (
        id, source, external_id, title, description, category, job_type,
        reward_amount, reward_currency, chain, status, apply_url,
        source_job_url, source_status_url, source_secret, requirements, tags,
        facets, raw, ingestion_mode, featured, curated_by, is_sample, first_seen_at,
        last_seen_at, expires_at, created_at, updated_at
      )
      SELECT
        incoming.id,
        incoming.source,
        incoming.external_id,
        incoming.title,
        incoming.description,
        incoming.category,
        incoming.job_type,
        incoming.reward_amount,
        incoming.reward_currency,
        incoming.chain,
        incoming.status,
        incoming.apply_url,
        incoming.source_job_url,
        incoming.source_status_url,
        incoming.source_secret,
        incoming.requirements,
        incoming.tags,
        incoming.facets,
        incoming.raw,
        incoming.ingestion_mode,
        incoming.featured,
        incoming.curated_by,
        incoming.is_sample,
        ${now},
        ${now},
        incoming.expires_at,
        ${now},
        ${now}
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS incoming(
        id text,
        source text,
        external_id text,
        title text,
        description text,
        category text,
        job_type text,
        reward_amount numeric,
        reward_currency text,
        chain text,
        status text,
        apply_url text,
        source_job_url text,
        source_status_url text,
        source_secret text,
        requirements jsonb,
        tags text[],
        facets text[],
        raw jsonb,
        ingestion_mode text,
        featured boolean,
        curated_by text,
        is_sample boolean,
        expires_at timestamptz
      )
      ON CONFLICT (source, external_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        job_type = EXCLUDED.job_type,
        reward_amount = EXCLUDED.reward_amount,
        reward_currency = EXCLUDED.reward_currency,
        chain = EXCLUDED.chain,
        status = EXCLUDED.status,
        apply_url = EXCLUDED.apply_url,
        source_job_url = EXCLUDED.source_job_url,
        source_status_url = EXCLUDED.source_status_url,
        source_secret = EXCLUDED.source_secret,
        requirements = EXCLUDED.requirements,
        tags = EXCLUDED.tags,
        facets = EXCLUDED.facets,
        raw = EXCLUDED.raw,
        ingestion_mode = EXCLUDED.ingestion_mode,
        featured = EXCLUDED.featured,
        curated_by = COALESCE(EXCLUDED.curated_by, partner_jobs.curated_by),
        is_sample = EXCLUDED.is_sample,
        last_seen_at = EXCLUDED.last_seen_at,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at
    `);
  }
  return jobs.length;
}
async function updatePartnerSourceMeta(
  source: PartnerJobSource,
  data: {
    lastSyncAt?: Date;
    lastSyncStatus: string;
    lastSyncError: string | null;
    lastIngestionMode: string;
    authModeUsed?: string | null;
    lastHttpStatus?: number | null;
    endpointUsed?: string | null;
    lastSuccessfulSyncAt?: Date;
  },
): Promise<void> {
  await prisma.jobPartnerSource.update({
    where: { source },
    data: {
      lastSyncAt: data.lastSyncAt ?? new Date(),
      lastSyncStatus: data.lastSyncStatus,
      lastSyncError: data.lastSyncError,
      lastIngestionMode: data.lastIngestionMode,
      ...(data.authModeUsed !== undefined ? { authModeUsed: data.authModeUsed } : {}),
      ...(data.lastHttpStatus !== undefined ? { lastHttpStatus: data.lastHttpStatus } : {}),
      ...(data.endpointUsed !== undefined ? { endpointUsed: data.endpointUsed } : {}),
      ...(data.lastSuccessfulSyncAt !== undefined
        ? { lastSuccessfulSyncAt: data.lastSuccessfulSyncAt }
        : {}),
    },
  });
}
export async function upsertPartnerJob(job: PartnerJobUpsertInput, now: Date): Promise<void> {
  const rewardDecimal =
    job.rewardAmount != null && job.rewardAmount !== ""
      ? new Prisma.Decimal(job.rewardAmount)
      : null;
  const ingestionMode = job.ingestionMode ?? "api";
  const featured = job.featured ?? false;
  const isSample = job.isSample ?? false;
  await prisma.partnerJob.upsert({
    where: {
      source_externalId: {
        source: job.source,
        externalId: job.externalId,
      },
    },
    create: {
      source: job.source,
      externalId: job.externalId,
      title: job.title,
      description: job.description,
      category: job.category,
      jobType: job.jobType,
      rewardAmount: rewardDecimal,
      rewardCurrency: job.rewardCurrency,
      chain: job.chain,
      status: job.status,
      applyUrl: job.applyUrl,
      sourceJobUrl: job.sourceJobUrl,
      sourceStatusUrl: job.sourceStatusUrl,
      sourceSecret: job.sourceSecret,
      requirements: job.requirements as Prisma.InputJsonValue,
      tags: job.tags,
      facets: job.facets ?? [],
      raw: job.raw as Prisma.InputJsonValue,
      ingestionMode,
      featured,
      curatedBy: job.curatedBy ?? null,
      isSample,
      firstSeenAt: now,
      lastSeenAt: now,
      expiresAt: job.expiresAt,
    },
    update: {
      title: job.title,
      description: job.description,
      category: job.category,
      jobType: job.jobType,
      rewardAmount: rewardDecimal,
      rewardCurrency: job.rewardCurrency,
      chain: job.chain,
      status: job.status,
      applyUrl: job.applyUrl,
      sourceJobUrl: job.sourceJobUrl,
      sourceStatusUrl: job.sourceStatusUrl,
      sourceSecret: job.sourceSecret,
      requirements: job.requirements as Prisma.InputJsonValue,
      tags: job.tags,
      facets: job.facets ?? [],
      raw: job.raw as Prisma.InputJsonValue,
      ingestionMode,
      featured,
      curatedBy: job.curatedBy ?? undefined,
      isSample,
      lastSeenAt: now,
      expiresAt: job.expiresAt,
    },
  });
}
export type JobsByIngestionMode = {
  api: number;
  feed: number;
  manual: number;
  seed: number;
};
export type PartnerSyncMetaRow = {
  source: string;
  displayName: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  jobCount: number;
  staleJobCount: number;
  websiteUrl: string;
  docsUrl: string | null;
  lastIngestionMode: string | null;
  authModeUsed: string | null;
  lastHttpStatus: number | null;
  endpointUsed: string | null;
  lastSuccessfulSyncAt: string | null;
  apiKeyPresent: boolean;
  jobsByIngestionMode: JobsByIngestionMode;
  displayStatus: string;
  statusDetail: string;
};
function emptyIngestionCounts(): JobsByIngestionMode {
  return { api: 0, feed: 0, manual: 0, seed: 0 };
}
export async function getPartnerSyncMeta(): Promise<PartnerSyncMetaRow[]> {
  await ensureDefaultJobPartnerSourcesIfEmpty();
  const sources = await prisma.jobPartnerSource.findMany({ orderBy: { source: "asc" } });
  const [activeCounts, staleCounts, ingestionGroups] = await Promise.all([
    prisma.partnerJob.groupBy({
      by: ["source"],
      where: { status: { in: ["open", "paused"] }, isSample: false },
      _count: { _all: true },
    }),
    prisma.partnerJob.groupBy({
      by: ["source"],
      where: { status: "closed" },
      _count: { _all: true },
    }),
    prisma.partnerJob.groupBy({
      by: ["source", "ingestionMode"],
      where: { status: { in: ["open", "paused"] }, isSample: false },
      _count: { _all: true },
    }),
  ]);
  const activeMap = new Map(activeCounts.map((c) => [c.source, c._count._all]));
  const staleMap = new Map(staleCounts.map((c) => [c.source, c._count._all]));
  const ingestionBySource = new Map<string, JobsByIngestionMode>();
  for (const row of ingestionGroups) {
    const current = getOrInsertComputed(ingestionBySource, row.source, emptyIngestionCounts);
    const mode = row.ingestionMode as keyof JobsByIngestionMode;
    if (mode in current) {
      current[mode] = row._count._all;
    }
  }
  return sources.map((s) => {
    const jobCount = activeMap.get(s.source) ?? 0;
    const status = resolvePartnerSourceStatus({
      source: s.source,
      enabled: s.enabled,
      lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: s.lastSyncStatus,
      lastSyncError: s.lastSyncError,
      jobCount,
      jobsByIngestionMode: ingestionBySource.get(s.source) ?? emptyIngestionCounts(),
    });
    const sourceKey = s.source as PartnerJobSource;
    return {
      source: s.source,
      displayName: s.displayName,
      enabled: s.enabled,
      lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: s.lastSyncStatus,
      lastSyncError: s.lastSyncError,
      jobCount,
      staleJobCount: staleMap.get(s.source) ?? 0,
      websiteUrl: s.websiteUrl,
      docsUrl: s.docsUrl,
      lastIngestionMode: s.lastIngestionMode,
      authModeUsed: s.authModeUsed,
      lastHttpStatus: s.lastHttpStatus,
      endpointUsed: s.endpointUsed ?? (sourceKey === "earnfi" ? `GET ${getEarnFiJobsListUrl()}` : null),
      lastSuccessfulSyncAt: s.lastSuccessfulSyncAt?.toISOString() ?? null,
      apiKeyPresent: Boolean(getPartnerApiKey(sourceKey)),
      jobsByIngestionMode: ingestionBySource.get(s.source) ?? emptyIngestionCounts(),
      displayStatus: status.displayStatus,
      statusDetail: status.statusDetail,
    };
  });
}
export async function getRecentPartnerJobs(limit = 10) {
  const rows = await prisma.partnerJob.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: limit,
    select: {
      id: true,
      source: true,
      title: true,
      status: true,
      ingestionMode: true,
      lastSeenAt: true,
      applyUrl: true,
      sourceJobUrl: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    title: r.title,
    status: r.status,
    ingestionMode: r.ingestionMode,
    lastSeenAt: r.lastSeenAt.toISOString(),
    applyUrl: r.applyUrl,
    sourceUrl: r.sourceJobUrl,
  }));
}
export async function getJobsPageStats(): Promise<{
  activeJobs: number;
  partners: number;
  categories: number;
  workReadyAgents: number;
  lastSyncedAt: string | null;
}> {
  await ensureDefaultJobPartnerSourcesIfEmpty();
  const publicJobWhere = {
    status: { in: ["open", "paused"] as string[] },
    isSample: false,
  };
  const [activeJobs, partners, categoriesGroup, workReadyAgents, sources] = await Promise.all([
    prisma.partnerJob.count({ where: publicJobWhere }),
    prisma.jobPartnerSource.count({ where: { enabled: true } }),
    prisma.partnerJob.groupBy({
      by: ["category"],
      where: publicJobWhere,
    }),
    prisma.agent.count({
      where: {
        isActive: true,
        OR: [{ featuredWorkReady: true }, { workReadyStatus: "approved" }],
      },
    }),
    prisma.jobPartnerSource.findMany({
      select: { lastSyncAt: true },
      where: { enabled: true },
    }),
  ]);
  const syncTimes = sources
    .map((source: { lastSyncAt: Date | null }) => source.lastSyncAt?.getTime() ?? 0)
    .filter((time: number) => time > 0);
  const lastSyncedAt =
    syncTimes.length > 0 ? new Date(Math.max(...syncTimes)).toISOString() : null;
  return {
    activeJobs,
    partners: partners > 0 ? partners : ENABLED_PARTNER_SOURCE_COUNT,
    categories: categoriesGroup.length,
    workReadyAgents,
    lastSyncedAt,
  };
}
