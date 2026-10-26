import {
  readBoundedHttpBodyText,
  readBoundedJsonBody,
} from "@/lib/bounded-http-body";
import type { EarnFiRawJob } from "@/lib/jobs/normalize";
import {
  getEarnFiApiBaseUrl,
  getEarnFiJobsListPath,
  getEarnFiJobsListUrl,
  hasEarnFiListEndpointConfigured,
} from "@/lib/jobs/partner-env";
export type EarnFiAuthMode = "bearer" | "x-earnfi-api-key";
export type EarnFiErrorCode =
  | "missing_api_key"
  | "missing_endpoint"
  | "awaiting_endpoint"
  | "unauthorized"
  | "endpoint_not_found"
  | "rate_limited"
  | "partner_error"
  | "network_error";
export type EarnFiFetchResult = {
  jobs: EarnFiRawJob[];
  error?: string;
  errorCode?: EarnFiErrorCode;
  authModeUsed?: EarnFiAuthMode;
  httpStatus?: number;
  endpointUsed?: string;
};
function mapHttpStatusToErrorCode(status: number): EarnFiErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "endpoint_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "partner_error";
  return "partner_error";
}
export function buildEarnFiListRequestUrl(page: number, perPage: number): string {
  const base = `${getEarnFiApiBaseUrl()}${getEarnFiJobsListPath()}`;
  const url = new URL(base);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("status", "open");
  return url.toString();
}
export async function fetchEarnFiJobs(apiKey: string | undefined): Promise<EarnFiFetchResult> {
  const endpointUsed = `GET ${getEarnFiJobsListUrl()}`;
  if (!apiKey?.trim()) {
    return {
      jobs: [],
      error: "EARNFI_WORK_API_KEY not configured",
      errorCode: "missing_api_key",
      endpointUsed,
    };
  }
  if (!hasEarnFiListEndpointConfigured()) {
    return {
      jobs: [],
      error: "EarnFi jobs list endpoint not configured",
      errorCode: "awaiting_endpoint",
      endpointUsed,
    };
  }
  const key = apiKey.trim();
  try {
    const bearerResult = await fetchEarnFiWithAuth(key, "bearer");
    if (bearerResult.result.jobs.length > 0 || !bearerResult.shouldRetryWithHeader) {
      return bearerResult.result;
    }
    return (await fetchEarnFiWithAuth(key, "x-earnfi-api-key")).result;
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return {
      jobs: [],
      error: msg,
      errorCode: "network_error",
      endpointUsed,
    };
  }
}
async function fetchEarnFiWithAuth(
  apiKey: string,
  mode: EarnFiAuthMode,
): Promise<{ result: EarnFiFetchResult; shouldRetryWithHeader: boolean }> {
  const endpointUsed = `GET ${getEarnFiJobsListUrl()}`;
  const allJobs: EarnFiRawJob[] = [];
  let page = 1;
  const perPage = 50;
  let hasMore = true;
  let lastHttpStatus = 0;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (mode === "bearer") {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers["X-EarnFi-Api-Key"] = apiKey;
  }
  while (hasMore && page <= 50) {
    const url = buildEarnFiListRequestUrl(page, perPage);
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    lastHttpStatus = res.status;
    if (!res.ok) {
      const body = await readBoundedHttpBodyText(res, 4 * 1024).catch(() => "");
      const errorCode = mapHttpStatusToErrorCode(res.status);
      const shouldRetry = mode === "bearer" && (res.status === 401 || res.status === 403);
      return {
        shouldRetryWithHeader: shouldRetry,
        result: {
          jobs: allJobs,
          error: `EarnFi API ${res.status}: ${body.slice(0, 200)}`,
          errorCode,
          authModeUsed: mode,
          httpStatus: res.status,
          endpointUsed,
        },
      };
    }
    const data = await readBoundedJsonBody(
      res,
      4 * 1024 * 1024,
    );
    const batch = extractJobList(data);
    allJobs.push(...batch);
    const dataObj = typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
    const totalPages = Number(dataObj.total_pages ?? dataObj.totalPages ?? 0);
    if (totalPages > 0) {
      hasMore = page < totalPages;
    } else {
      hasMore = batch.length >= perPage;
    }
    page += 1;
  }
  return {
    shouldRetryWithHeader: false,
    result: {
      jobs: allJobs,
      authModeUsed: mode,
      httpStatus: lastHttpStatus || 200,
      endpointUsed,
    },
  };
}
function extractJobList(data: unknown): EarnFiRawJob[] {
  if (Array.isArray(data)) {
    return data.filter((j): j is EarnFiRawJob => j != null && typeof j === "object");
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const candidates = [obj.jobs, obj.data, obj.items, obj.results];
    for (const c of candidates) {
      if (Array.isArray(c)) {
        return c.filter((j): j is EarnFiRawJob => j != null && typeof j === "object");
      }
    }
  }
  return [];
}
/** EarnFi fetch failures that must not upsert or stale-close listings. */
export function isEarnFiSyncFailure(result: EarnFiFetchResult): boolean {
  if (result.jobs.length > 0) return false;
  return Boolean(result.errorCode);
}