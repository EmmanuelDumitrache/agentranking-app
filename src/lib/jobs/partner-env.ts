import type { PartnerJobSource } from "@/lib/jobs/types";
export const DEFAULT_PARTNER_SOURCES: PartnerJobSource[] = ["earnfi", "wurk"];
export const ENABLED_PARTNER_SOURCE_COUNT = DEFAULT_PARTNER_SOURCES.length;
export const DEFAULT_EARNFI_API_BASE_URL = "https://app.earnfi.fun/api/work/v1";
export const DEFAULT_EARNFI_APP_BASE_URL = "https://app.earnfi.fun";
export const DEFAULT_EARNFI_JOBS_LIST_PATH = "/jobs";
export function getEarnFiApiBaseUrl(): string {
  const raw = process.env.EARNFI_API_BASE_URL?.trim();
  if (!raw) return DEFAULT_EARNFI_API_BASE_URL;
  return raw.replace(/\/+$/, "");
}
export function getEarnFiAppBaseUrl(): string {
  const raw = process.env.EARNFI_APP_BASE_URL?.trim();
  if (!raw) return DEFAULT_EARNFI_APP_BASE_URL;
  return raw.replace(/\/+$/, "");
}
export function getEarnFiJobsListPath(): string {
  const raw = process.env.EARNFI_JOBS_LIST_PATH?.trim();
  const path = raw || DEFAULT_EARNFI_JOBS_LIST_PATH;
  return path.startsWith("/") ? path : `/${path}`;
}
export function getEarnFiJobsListUrl(): string {
  return `${getEarnFiApiBaseUrl()}${getEarnFiJobsListPath()}`;
}
export function hasEarnFiListEndpointConfigured(): boolean {
  const path = process.env.EARNFI_JOBS_LIST_PATH?.trim();
  return Boolean(path || DEFAULT_EARNFI_JOBS_LIST_PATH);
}
export function getEarnFiStaleGraceHours(): number {
  const raw = process.env.EARNFI_STALE_GRACE_HOURS?.trim();
  const n = raw ? Number(raw) : 24;
  return Number.isFinite(n) && n >= 0 ? n : 24;
}
export function getPartnerFeedUrl(source: PartnerJobSource): string | undefined {
  if (source === "earnfi") return process.env.EARNFI_JOBS_FEED_URL?.trim() || undefined;
  if (source === "wurk") return process.env.WURK_JOBS_FEED_URL?.trim() || undefined;
  return undefined;
}
export function getPartnerApiKey(source: PartnerJobSource): string | undefined {
  if (source === "earnfi") return process.env.EARNFI_WORK_API_KEY?.trim() || undefined;
  if (source === "wurk") return process.env.WURK_API_KEY?.trim() || undefined;
  return undefined;
}
export const DEFAULT_WURK_JOBS_API_BASE = "https://wurk.fun";
export const DEFAULT_WURK_OPEN_SOCIAL_JOBS_PATH = "/api/jobs/cards/open";
// The legacy public custom-card listing path currently returns 404 and is not
// part of WURK's documented external jobs API. Keep custom listings opt-in
// through WURK_OPEN_CUSTOM_JOBS_PATH instead of degrading every sync.
export const DEFAULT_WURK_OPEN_CUSTOM_JOBS_PATH: string | undefined = undefined;
export function getWurkJobsApiBase(): string {
  const raw = process.env.WURK_JOBS_API_BASE?.trim();
  return (raw || DEFAULT_WURK_JOBS_API_BASE).replace(/\/+$/, "");
}
function resolveWurkPath(
  envValue: string | undefined,
  defaultPath?: string,
): string | undefined {
  const raw = envValue?.trim();
  if (raw === "0" || raw === "false") return undefined;
  if (raw) return raw.startsWith("/") ? raw : `/${raw}`;
  return defaultPath;
}
export function getWurkOpenSocialJobsPath(): string | undefined {
  return resolveWurkPath(
    process.env.WURK_OPEN_SOCIAL_JOBS_PATH,
    DEFAULT_WURK_OPEN_SOCIAL_JOBS_PATH,
  );
}
export function getWurkOpenCustomJobsPath(): string | undefined {
  return resolveWurkPath(
    process.env.WURK_OPEN_CUSTOM_JOBS_PATH,
    DEFAULT_WURK_OPEN_CUSTOM_JOBS_PATH,
  );
}
export function getWurkListPaths(): string[] {
  const paths: string[] = [];
  const social = getWurkOpenSocialJobsPath();
  const custom = getWurkOpenCustomJobsPath();
  if (social) paths.push(social);
  if (custom) paths.push(custom);
  return paths;
}
export function hasWurkListEndpointConfigured(): boolean {
  return getWurkListPaths().length > 0;
}
/** Public wurk.fun marketplace cards need no API key; wurkapi.fun partner paths do. */
export function wurkRequiresApiKey(): boolean {
  if (!hasWurkListEndpointConfigured()) return false;
  if (process.env.WURK_API_KEY_REQUIRED?.trim() === "1") return true;
  const base = getWurkJobsApiBase().toLowerCase();
  return base.includes("wurkapi.fun");
}
export type PartnerSourceConfiguration = {
  configured: boolean;
  reason?: string;
};

export function getPartnerSourceConfiguration(
  source: PartnerJobSource,
): PartnerSourceConfiguration {
  if (getPartnerFeedUrl(source)) return { configured: true };
  if (source === "earnfi") {
    if (!hasEarnFiListEndpointConfigured()) {
      return { configured: false, reason: "EarnFi jobs list endpoint is not configured" };
    }
    if (!getPartnerApiKey(source)) {
      return { configured: false, reason: "EARNFI_WORK_API_KEY is not configured" };
    }
    return { configured: true };
  }
  if (!hasWurkListEndpointConfigured()) {
    return { configured: false, reason: "WURK jobs list endpoints are not configured" };
  }
  if (wurkRequiresApiKey() && !getPartnerApiKey(source)) {
    return { configured: false, reason: "WURK_API_KEY is not configured" };
  }
  return { configured: true };
}
