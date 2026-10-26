import { readBoundedJsonBody } from "@/lib/bounded-http-body";
import type { WurkRawJob } from "@/lib/jobs/normalize";
import {
  getWurkJobsApiBase,
  getWurkListPaths,
  getWurkOpenCustomJobsPath,
  getWurkOpenSocialJobsPath,
  wurkRequiresApiKey,
} from "@/lib/jobs/partner-env";
export type WurkFetchResult = {
  jobs: WurkRawJob[];
  error?: string;
  errorCode?: "missing_api_key" | "awaiting_feed" | "rate_limited" | "api_error";
};
const MAX_PAGES = 40;
const PAGE_SIZE = 100;
const MAX_FETCH_ATTEMPTS = 2;
const MAX_RETRY_DELAY_MS = 15_000;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response, attempt: number): number {
  const raw = response.headers.get("retry-after")?.trim();
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1000));
    }
    const at = Date.parse(raw);
    if (Number.isFinite(at)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, at - Date.now()));
    }
  }
  return Math.min(MAX_RETRY_DELAY_MS, 2_000 * 2 ** attempt);
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchWurkPage(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(25_000),
      });
      if (
        response.ok ||
        !isRetryableStatus(response.status) ||
        attempt === MAX_FETCH_ATTEMPTS - 1
      ) {
        return response;
      }
      const delayMs = retryAfterMs(response, attempt);
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }
      await wait(delayMs);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_FETCH_ATTEMPTS - 1) throw error;
      await wait(Math.min(MAX_RETRY_DELAY_MS, 2_000 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("WURK request failed");
}
export async function fetchWurkJobs(apiKey: string | undefined): Promise<WurkFetchResult> {
  const paths = getWurkListPaths();
  if (paths.length === 0) {
    return {
      jobs: [],
      error:
        "No open jobs feed configured — set WURK_JOBS_FEED_URL or WURK_OPEN_*_JOBS_PATH",
      errorCode: "awaiting_feed",
    };
  }
  if (wurkRequiresApiKey() && !apiKey?.trim()) {
    return {
      jobs: [],
      error: "WURK_API_KEY not configured",
      errorCode: "missing_api_key",
    };
  }
  const base = getWurkJobsApiBase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey?.trim()) {
    headers["X-API-Key"] = apiKey.trim();
  }
  const socialPath = getWurkOpenSocialJobsPath();
  const customPath = getWurkOpenCustomJobsPath();
  const allJobs: WurkRawJob[] = [];
  const errors: string[] = [];
  const errorCodes: Array<"rate_limited" | "api_error"> = [];
  if (socialPath) {
    const { jobs, error, errorCode } = await fetchWurkPathPages(
      base,
      socialPath,
      headers,
      "social",
    );
    allJobs.push(...jobs);
    if (error) errors.push(error);
    if (errorCode) errorCodes.push(errorCode);
  }
  if (customPath) {
    const { jobs, error, errorCode } = await fetchWurkPathPages(
      base,
      customPath,
      headers,
      "custom",
    );
    allJobs.push(...jobs);
    if (error) errors.push(error);
    if (errorCode) errorCodes.push(errorCode);
  }
  if (allJobs.length === 0) {
    return {
      jobs: [],
      error: errors.join("; ") || "WURK list endpoints returned no jobs",
      errorCode:
        errorCodes.length > 0 && errorCodes.every((code) => code === "rate_limited")
          ? "rate_limited"
          : "api_error",
    };
  }
  return {
    jobs: allJobs,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}
async function fetchWurkPathPages(
  base: string,
  path: string,
  headers: Record<string, string>,
  listingKind: "social" | "custom",
): Promise<{
  jobs: WurkRawJob[];
  error?: string;
  errorCode?: "rate_limited" | "api_error";
}> {
  const jobs: WurkRawJob[] = [];
  const errors: string[] = [];
  let errorCode: "rate_limited" | "api_error" | undefined;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = buildWurkListUrl(base, path, page);
    try {
      const res = await fetchWurkPage(url, headers);
      if (!res.ok) {
        errors.push(`${path} page ${page}: HTTP ${res.status}`);
        errorCode = res.status === 429 ? "rate_limited" : "api_error";
        break;
      }
      const data = await readBoundedJsonBody(res, 4 * 1024 * 1024);
      const pageJobs = extractWurkJobList(data);
      if (pageJobs.length === 0) break;
      for (const job of pageJobs) {
        jobs.push({ ...job, _wurkListingKind: listingKind });
      }
      if (pageJobs.length < PAGE_SIZE) break;
    } catch (e) {
      errors.push(`${path} page ${page}: ${Error.isError(e) ? e.message : String(e)}`);
      errorCode = "api_error";
      break;
    }
  }
  return {
    jobs,
    error: errors.length > 0 ? errors.join("; ") : undefined,
    errorCode,
  };
}
function buildWurkListUrl(base: string, path: string, page: number): string {
  if (path.startsWith("http")) {
    const url = new URL(path);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    return url.toString();
  }
  const url = new URL(`${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  return url.toString();
}
function extractWurkJobList(data: unknown): WurkRawJob[] {
  if (!data || typeof data !== "object") return [];
  const rec = data as Record<string, unknown>;
  const candidates = [rec.jobs, rec.data, rec.items, rec.results];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c.filter((j): j is WurkRawJob => j != null && typeof j === "object");
    }
  }
  if (Array.isArray(data)) {
    return data.filter((j): j is WurkRawJob => j != null && typeof j === "object");
  }
  return [];
}