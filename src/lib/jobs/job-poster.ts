import type { PublicPartnerJob } from "@/lib/jobs/types";
const POSTER_KEYS = [
  "posted_by",
  "postedBy",
  "creator_handle",
  "creatorHandle",
  "creator_name",
  "creatorName",
  "creator",
  "brand_name",
  "brandName",
  "brand",
  "project_name",
  "campaign_name",
  "organization",
] as const;
export type JobPosterInfo = {
  name: string;
  role: "creator" | "campaign" | "marketplace";
};
function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return "";
}
function formatPosterName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("@")) return trimmed;
  if (/^[A-Za-z0-9_]{1,30}$/.test(trimmed)) return `@${trimmed}`;
  return trimmed;
}
function extractFromRequirements(requirements: unknown): string | null {
  if (requirements == null || typeof requirements !== "object" || Array.isArray(requirements)) {
    return null;
  }
  const record = requirements as Record<string, unknown>;
  for (const key of POSTER_KEYS) {
    const value = asString(record[key]);
    if (value) return formatPosterName(value);
  }
  return null;
}
function extractSocialHandle(text: string): string | null {
  const match = text.match(/@([A-Za-z0-9_]{1,30})/);
  return match ? `@${match[1]}` : null;
}
function mentionsPartnerBrand(text: string, partnerName: string): boolean {
  const hay = text.toLowerCase();
  const needle = partnerName.toLowerCase().replace(/\s+/g, "");
  if (!needle || needle.length < 3) return false;
  return hay.includes(needle) || hay.includes(partnerName.toLowerCase());
}
export function getJobPosterInfo(job: PublicPartnerJob): JobPosterInfo {
  const fromRequirements = extractFromRequirements(job.requirements);
  if (fromRequirements) {
    return { name: fromRequirements, role: "creator" };
  }
  const handle =
    extractSocialHandle(job.description) ?? extractSocialHandle(job.title);
  if (handle) {
    return { name: handle, role: "campaign" };
  }
  const partner = job.partnerDisplayName || (job.source === "earnfi" ? "EarnFi" : "WURK");
  if (mentionsPartnerBrand(job.title, partner) || mentionsPartnerBrand(job.description, partner)) {
    return { name: partner, role: "campaign" };
  }
  return { name: partner, role: "marketplace" };
}
export function formatJobPosterLine(job: PublicPartnerJob): string | null {
  const poster = getJobPosterInfo(job);
  switch (poster.role) {
    case "creator":
      return `Posted by ${poster.name}`;
    case "campaign":
      return `Campaign by ${poster.name}`;
    case "marketplace":
      return `Listed on ${poster.name}`;
    default: {
      const _exhaustive: never = poster.role;
      return _exhaustive;
    }
  }
}
export function pickPostedByFromRaw(
  raw: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = asString(raw[key]);
    if (value) return formatPosterName(value);
  }
  return null;
}
export function mergePostedBy(requirements: unknown, postedBy: string | null): unknown {
  if (!postedBy) return requirements;
  if (requirements == null) {
    return { posted_by: postedBy };
  }
  if (typeof requirements === "object" && !Array.isArray(requirements)) {
    return { ...(requirements as Record<string, unknown>), posted_by: postedBy };
  }
  return { details: requirements, posted_by: postedBy };
}