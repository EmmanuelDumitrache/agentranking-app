import type { PartnerJobSource } from "@/lib/jobs/types";
import { getEarnFiAppBaseUrl, getWurkJobsApiBase } from "@/lib/jobs/partner-env";
const RAW_JOB_URL_KEYS = [
  "job_url",
  "jobUrl",
  "apply_url",
  "applyUrl",
  "url",
  "link",
  "public_url",
  "publicUrl",
] as const;
function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return "";
}
export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
export function pickRawJobUrl(raw: Record<string, unknown>): string | null {
  for (const key of RAW_JOB_URL_KEYS) {
    const value = asString(raw[key]);
    if (value && isValidHttpUrl(value)) return value;
  }
  return null;
}
export function buildEarnFiApplyUrl(jobId: string | null | undefined): string {
  const base = getEarnFiAppBaseUrl();
  if (jobId?.trim()) {
    return `${base}/task-detail/${encodeURIComponent(jobId.trim())}`;
  }
  return `${base}/tasks`;
}
export function buildWurkApplyUrl(
  externalId: string,
  raw?: Record<string, unknown>,
): string {
  const base = getWurkJobsApiBase().replace(/\/+$/, "");
  if (externalId.startsWith("social:")) {
    const shortId = externalId.slice("social:".length);
    if (shortId) return `${base}/job/${encodeURIComponent(shortId)}`;
  }
  if (externalId.startsWith("custom:")) {
    const shortId = externalId.slice("custom:".length);
    if (shortId) return `${base}/custom/${encodeURIComponent(shortId)}`;
  }
  if (raw) {
    const fromRaw =
      asString(raw.jobLink) ||
      asString(raw.job_link) ||
      asString(raw.url) ||
      asString(raw.apply_url) ||
      asString(raw.applyUrl);
    if (fromRaw && isValidHttpUrl(fromRaw)) return fromRaw;
  }
  if (externalId && !externalId.includes(":")) {
    return `${base}/jobs/${encodeURIComponent(externalId)}`;
  }
  return `${base}/jobs`;
}
export function getPartnerMarketplaceFallbackUrl(source: PartnerJobSource): string {
  if (source === "earnfi") return buildEarnFiApplyUrl(null);
  return `${getWurkJobsApiBase().replace(/\/+$/, "")}/jobs`;
}
/** Canonical apply URL — normalizes malformed source links. */
export function resolvePartnerJobApplyUrl(input: {
  source: string;
  externalId: string;
  applyUrl?: string | null;
  sourceJobUrl?: string | null;
}): string {
  const source = input.source as PartnerJobSource;
  const externalId = input.externalId?.trim() ?? "";
  const stored = input.applyUrl?.trim() || input.sourceJobUrl?.trim() || "";
  if (source === "earnfi") {
    if (externalId) return buildEarnFiApplyUrl(externalId);
    if (stored && isValidHttpUrl(stored) && !isBrokenEarnFiJobsUrl(stored)) return stored;
    return getPartnerMarketplaceFallbackUrl("earnfi");
  }
  if (source === "wurk") {
    if (externalId.startsWith("social:") || externalId.startsWith("custom:")) {
      return buildWurkApplyUrl(externalId);
    }
    if (stored && isValidHttpUrl(stored)) return stored;
    if (externalId) return buildWurkApplyUrl(externalId);
    return getPartnerMarketplaceFallbackUrl("wurk");
  }
  return stored || getPartnerMarketplaceFallbackUrl("earnfi");
}
function isBrokenEarnFiJobsUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return (
      (hostname === "earnfi.fun" || hostname === "www.earnfi.fun") &&
      pathname.startsWith("/jobs")
    );
  } catch {
    return false;
  }
}
