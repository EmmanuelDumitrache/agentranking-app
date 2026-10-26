import {
  readBoundedHttpBodyText,
  readBoundedJsonBody,
} from "@/lib/bounded-http-body";
import type { PartnerJobSource, PartnerJobUpsertInput } from "@/lib/jobs/types";
import { deriveJobFacets } from "@/lib/jobs/normalize";
export type PartnerFeedJob = {
  id?: string;
  externalId?: string;
  title: string;
  description: string;
  category?: string;
  jobType?: string;
  rewardAmount?: string | null;
  rewardCurrency?: string;
  chain?: string;
  status?: string;
  applyUrl: string;
  sourceJobUrl?: string;
  sourceStatusUrl?: string | null;
  tags?: string[];
  requirements?: unknown;
  expiresAt?: string | null;
};
export type PartnerFeedEnvelope = {
  source?: string;
  jobs: PartnerFeedJob[];
};
export type FeedFetchResult = {
  jobs: PartnerJobUpsertInput[];
  skipped: number;
  errors: string[];
};
function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
export function validateFeedJob(
  job: PartnerFeedJob,
  expectedSource: PartnerJobSource,
): { ok: true; job: PartnerJobUpsertInput } | { ok: false; error: string } {
  const title = asString(job.title);
  const description = asString(job.description);
  const applyUrl = asString(job.applyUrl);
  if (!title) return { ok: false, error: "missing title" };
  if (!description) return { ok: false, error: "missing description" };
  if (!applyUrl || !isValidUrl(applyUrl)) return { ok: false, error: "invalid applyUrl" };
  const externalId =
    asString(job.externalId) ||
    asString(job.id) ||
    `feed-${Buffer.from(applyUrl).toString("base64url").slice(0, 24)}`;
  const status = (asString(job.status) || "open").toLowerCase();
  const tags = Array.isArray(job.tags)
    ? job.tags.map((t) => asString(t)).filter(Boolean)
    : [];
  const category = asString(job.category) || "general";
  const jobType = asString(job.jobType) || "";
  return {
    ok: true,
    job: {
      source: expectedSource,
      externalId,
      title,
      description,
      category,
      jobType,
      rewardAmount: job.rewardAmount != null ? asString(job.rewardAmount) || null : null,
      rewardCurrency: asString(job.rewardCurrency) || "USDC",
      chain: asString(job.chain) || "",
      status,
      applyUrl,
      sourceJobUrl: asString(job.sourceJobUrl) || applyUrl,
      sourceStatusUrl: job.sourceStatusUrl ? asString(job.sourceStatusUrl) || null : null,
      sourceSecret: null,
      requirements: job.requirements ?? null,
      tags,
      facets: deriveJobFacets(category, jobType, tags),
      raw: { feed: true },
      expiresAt: job.expiresAt ? new Date(job.expiresAt) : null,
      ingestionMode: "feed",
      featured: false,
      curatedBy: null,
      isSample: false,
    },
  };
}
export function parsePartnerFeed(
  data: unknown,
  expectedSource: PartnerJobSource,
): FeedFetchResult {
  const errors: string[] = [];
  let skipped = 0;
  const jobs: PartnerJobUpsertInput[] = [];
  const envelope = data as PartnerFeedEnvelope;
  const rows = Array.isArray(envelope?.jobs) ? envelope.jobs : [];
  if (envelope?.source && envelope.source !== expectedSource) {
    errors.push(`Feed source mismatch: expected ${expectedSource}, got ${envelope.source}`);
  }
  for (const row of rows) {
    const result = validateFeedJob(row, expectedSource);
    if (!result.ok) {
      skipped += 1;
      errors.push(result.error);
      continue;
    }
    jobs.push(result.job);
  }
  return { jobs, skipped, errors };
}
export async function fetchPartnerFeed(
  feedUrl: string,
  source: PartnerJobSource,
): Promise<FeedFetchResult & { error?: string }> {
  try {
    const res = await fetch(feedUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await readBoundedHttpBodyText(res, 4 * 1024).catch(() => "");
      return {
        jobs: [],
        skipped: 0,
        errors: [],
        error: `Feed ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const data = await readBoundedJsonBody(res, 8 * 1024 * 1024);
    const parsed = parsePartnerFeed(data, source);
    return parsed;
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return { jobs: [], skipped: 0, errors: [], error: msg };
  }
}