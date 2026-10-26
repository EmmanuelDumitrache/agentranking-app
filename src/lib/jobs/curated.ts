import type { JobIngestionMode, PartnerJobSource, PartnerJobUpsertInput } from "@/lib/jobs/types";
import { PARTNER_JOB_SOURCES } from "@/lib/jobs/types";
import { deriveJobFacets } from "@/lib/jobs/normalize";
export type CuratedJobInput = {
  source: string;
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
  tags?: string[];
  expiresAt?: string | null;
  featured?: boolean;
  ingestionMode?: JobIngestionMode;
  isSample?: boolean;
};
function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
export function validateCuratedJobInput(
  input: CuratedJobInput,
  options?: { allowSample?: boolean },
): { ok: true; job: PartnerJobUpsertInput } | { ok: false; error: string } {
  const source = input.source?.trim().toLowerCase();
  if (!PARTNER_JOB_SOURCES.includes(source as PartnerJobSource)) {
    return { ok: false, error: "source must be earnfi or wurk" };
  }
  const title = input.title?.trim() ?? "";
  const description = input.description?.trim() ?? "";
  const applyUrl = input.applyUrl?.trim() ?? "";
  if (!title) return { ok: false, error: "title is required" };
  if (!description) return { ok: false, error: "description is required" };
  if (!applyUrl || !isValidUrl(applyUrl)) return { ok: false, error: "valid applyUrl is required" };
  const isSample = input.isSample === true;
  if (isSample && !options?.allowSample) {
    return { ok: false, error: "sample jobs are not allowed in this context" };
  }
  const externalId =
    input.externalId?.trim() ||
    `curated-${source}-${Buffer.from(applyUrl).toString("base64url").slice(0, 28)}`;
  const ingestionMode = input.ingestionMode ?? "manual";
  const category = input.category?.trim() || "general";
  const jobType = input.jobType?.trim() || "";
  const tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  return {
    ok: true,
    job: {
      source: source as PartnerJobSource,
      externalId,
      title,
      description,
      category,
      jobType,
      rewardAmount: input.rewardAmount != null ? String(input.rewardAmount) : null,
      rewardCurrency: input.rewardCurrency?.trim() || "USDC",
      chain: input.chain?.trim() || "",
      status: (input.status?.trim() || "open").toLowerCase(),
      applyUrl,
      sourceJobUrl: input.sourceJobUrl?.trim() || applyUrl,
      sourceStatusUrl: null,
      sourceSecret: null,
      requirements: null,
      tags,
      facets: deriveJobFacets(category, jobType, tags),
      raw: { curated: true },
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      ingestionMode,
      featured: input.featured ?? false,
      curatedBy: null,
      isSample,
    },
  };
}