import {
  isPermanentOutboundTargetError,
  requestPublicHttp,
} from "@/lib/outbound-http";
import {
  FAIRSCALE_AGENT_SCORE_BATCH_PATH,
  FAIRSCALE_AGENT_SCORE_PATH,
  FAIRSCALE_BATCH_MAX,
  FAIRSCALE_HUMAN_FAIR_SCORE_PATH,
  FAIRSCALE_HUMAN_SCORE_PATH,
  FAIRSCALE_HUMAN_SOCIAL_SCORE_PATH,
  FAIRSCALE_HUMAN_WALLET_SCORE_PATH,
  FAIRSCALE_REQUEST_TIMEOUT_MS,
  FAIRSCALE_USER_AGENT,
  resolveFairscaleApiBaseUrl,
  resolveFairscaleApiKey,
  resolveFairscaleHumanApiBaseUrl,
  resolveFairscaleScoreSource,
} from "@/lib/fairscale/config";
import { normalizeHumanScoreResponse } from "@/lib/fairscale/normalize-human-score";
import type {
  FairscaleBatchResponse,
  FairscaleFairScoreOnlyResponse,
  FairscaleHumanScoreResponse,
  FairscaleScoreResponse,
  FairscaleSocialScoreOnlyResponse,
  FairscaleWalletScoreOnlyResponse,
} from "@/lib/fairscale/types";

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REQUEST_BYTES = 128 * 1024;

export class FairscaleClientError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "FairscaleClientError";
    this.status = status;
    this.code = code;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}
export function asFairscaleResponseObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function parseErrorBody(body: unknown): { message: string | null; code: string | null } {
  const row = asFairscaleResponseObject(body);
  if (!row) return { message: null, code: null };
  const code = typeof row.error === "string" ? row.error.trim().slice(0, 200) || null : null;
  const message = typeof row.message === "string"
    ? row.message.trim().slice(0, 1_000) || null
    : code;
  return { message, code };
}
function parseJsonBody(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text) as unknown; }
  catch { return text.slice(0, 1_000); }
}
async function fairscaleFetch<T>(
  baseUrl: string,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<{ ok: true; data: T } | { ok: false; error: FairscaleClientError }> {
  const apiKey = resolveFairscaleApiKey();
  if (!apiKey) {
    return { ok: false, error: new FairscaleClientError("FAIRSCALE_API_KEY is not configured", 401, "missing_api_key") };
  }
  const url = new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString();
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  try {
    const response = await requestPublicHttp(url, {
      method: init.method ?? "GET",
      body,
      timeoutMs: FAIRSCALE_REQUEST_TIMEOUT_MS,
      maxRequestBytes: MAX_REQUEST_BYTES,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      maxRedirects: 0,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        fairkey: apiKey,
        "User-Agent": FAIRSCALE_USER_AGENT,
      },
    });
    if (response.truncated) {
      return {
        ok: false,
        error: new FairscaleClientError(
          `FairScale response exceeded ${MAX_RESPONSE_BYTES} bytes`,
          502,
          "response_too_large",
        ),
      };
    }
    const parsed = parseJsonBody(response.body);
    if (response.status < 200 || response.status >= 300) {
      const providerError = parseErrorBody(parsed);
      return {
        ok: false,
        error: new FairscaleClientError(
          providerError.message ?? `FairScale HTTP ${response.status}`,
          response.status,
          providerError.code,
        ),
      };
    }
    const record = asFairscaleResponseObject(parsed);
    if (!record) {
      return {
        ok: false,
        error: new FairscaleClientError(
          "FairScale returned a malformed successful response",
          502,
          "invalid_success_response",
        ),
      };
    }
    return { ok: true, data: record as unknown as T };
  } catch (error) {
    return {
      ok: false,
      error: new FairscaleClientError(
        error instanceof Error ? error.message : String(error),
        isPermanentOutboundTargetError(error) ? 400 : 502,
        isPermanentOutboundTargetError(error) ? "invalid_upstream_target" : "upstream_error",
      ),
    };
  }
}
function withWallet(path: string, wallet: string): string {
  const params = new URLSearchParams({ wallet });
  return `${path}?${params.toString()}`;
}
export function fetchFairscaleScore(wallet: string) {
  return fairscaleFetch<FairscaleScoreResponse>(resolveFairscaleApiBaseUrl(), withWallet(FAIRSCALE_AGENT_SCORE_PATH, wallet));
}
export function fetchFairscaleScoreBatch(wallets: string[]) {
  if (wallets.length < 1 || wallets.length > FAIRSCALE_BATCH_MAX) {
    return Promise.resolve({
      ok: false as const,
      error: new FairscaleClientError(
        `FairScale batch requests require between 1 and ${FAIRSCALE_BATCH_MAX} wallets`,
        400,
        wallets.length < 1 ? "missing_wallets" : "too_many_wallets",
      ),
    });
  }
  return fairscaleFetch<FairscaleBatchResponse>(resolveFairscaleApiBaseUrl(), FAIRSCALE_AGENT_SCORE_BATCH_PATH, {
    method: "POST",
    body: { wallets },
  });
}
export function fetchFairscaleHumanScore(wallet: string) {
  return fairscaleFetch<FairscaleHumanScoreResponse>(resolveFairscaleHumanApiBaseUrl(), withWallet(FAIRSCALE_HUMAN_SCORE_PATH, wallet));
}
export function fetchFairscaleFairScoreOnly(wallet: string) {
  return fairscaleFetch<FairscaleFairScoreOnlyResponse>(resolveFairscaleHumanApiBaseUrl(), withWallet(FAIRSCALE_HUMAN_FAIR_SCORE_PATH, wallet));
}
export function fetchFairscaleWalletScoreOnly(wallet: string) {
  return fairscaleFetch<FairscaleWalletScoreOnlyResponse>(resolveFairscaleHumanApiBaseUrl(), withWallet(FAIRSCALE_HUMAN_WALLET_SCORE_PATH, wallet));
}
export function fetchFairscaleSocialScoreOnly(wallet: string) {
  return fairscaleFetch<FairscaleSocialScoreOnlyResponse>(resolveFairscaleHumanApiBaseUrl(), withWallet(FAIRSCALE_HUMAN_SOCIAL_SCORE_PATH, wallet));
}
export async function fetchFairscaleAssessmentScore(wallet: string) {
  if (resolveFairscaleScoreSource() === "agent") return fetchFairscaleScore(wallet);
  const result = await fetchFairscaleHumanScore(wallet);
  if (!result.ok) return result;
  return { ok: true as const, data: normalizeHumanScoreResponse(result.data) };
}
