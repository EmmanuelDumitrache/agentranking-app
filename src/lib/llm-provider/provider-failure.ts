import "server-only";

import { APICallError } from "ai";
import type {
  AgentChatErrorAction,
  AgentChatErrorCode,
} from "@/features/agent-chat/shared/errors";

export type ProviderFailureKind =
  | "authentication"
  | "permission"
  | "billing"
  | "rate_limit"
  | "quota"
  | "model_not_found"
  | "request_invalid"
  | "content_policy"
  | "timeout"
  | "provider_unavailable"
  | "transport"
  | "cancelled"
  | "unknown";

export type CredentialDisposition = "keep" | "invalidate";
export type ProviderFailureSource = "catalog" | "inference";

export type ProviderRuntimeFailure = {
  readonly name: "ProviderRuntimeFailure";
  provider: string;
  modelKey?: string;
  providerModelId?: string;
  source: ProviderFailureSource;
  kind: ProviderFailureKind;
  statusCode: number | null;
  providerCode: string | null;
  providerMessage: string | null;
  providerRequestId: string | null;
  retryable: boolean;
  failoverEligible: boolean;
  credentialDisposition: CredentialDisposition;
  retryAfterMs: number | null;
  publicError: {
    code: AgentChatErrorCode;
    message: string;
    retryable: boolean;
    action?: AgentChatErrorAction;
  };
  cause: unknown;
};

class ProviderRuntimeFailureError extends Error implements ProviderRuntimeFailure {
  readonly name = "ProviderRuntimeFailure" as const;
  readonly provider: string;
  readonly modelKey?: string;
  readonly providerModelId?: string;
  readonly source: ProviderFailureSource;
  readonly kind: ProviderFailureKind;
  readonly statusCode: number | null;
  readonly providerCode: string | null;
  readonly providerMessage: string | null;
  readonly providerRequestId: string | null;
  readonly retryable: boolean;
  readonly failoverEligible: boolean;
  readonly credentialDisposition: CredentialDisposition;
  readonly retryAfterMs: number | null;
  readonly publicError: ProviderRuntimeFailure["publicError"];
  readonly cause: unknown;

  constructor(input: Omit<ProviderRuntimeFailure, "name">) {
    super(input.providerMessage ?? input.publicError.message, { cause: input.cause });
    this.provider = input.provider;
    this.modelKey = input.modelKey;
    this.providerModelId = input.providerModelId;
    this.source = input.source;
    this.kind = input.kind;
    this.statusCode = input.statusCode;
    this.providerCode = input.providerCode;
    this.providerMessage = input.providerMessage;
    this.providerRequestId = input.providerRequestId;
    this.retryable = input.retryable;
    this.failoverEligible = input.failoverEligible;
    this.credentialDisposition = input.credentialDisposition;
    this.retryAfterMs = input.retryAfterMs;
    this.publicError = input.publicError;
    this.cause = input.cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) {
    return value;
  }
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return null;
}

function headerRecord(value: unknown): Record<string, string> | null {
  if (!value) return null;
  if (value instanceof Headers) return Object.fromEntries(value.entries());
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key.toLowerCase()] = item;
    else if (Array.isArray(item)) result[key.toLowerCase()] = item.map(String).join(", ");
  }
  return Object.keys(result).length ? result : null;
}

function parseJsonBody(value: unknown): unknown {
  if (isRecord(value) || Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function nestedError(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  return isRecord(payload.error) ? payload.error : payload;
}

function responseRequestId(headers: Record<string, string> | null): string | null {
  if (!headers) return null;
  for (const key of [
    "request-id",
    "x-request-id",
    "x-goog-request-id",
    "anthropic-request-id",
    "openai-request-id",
  ]) {
    const value = headers[key];
    if (value?.trim()) return value.trim();
  }
  return null;
}

export function parseRetryAfterHeaderMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function parseRateLimitResetMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const duration = /^(\d+(?:\.\d+)?)\s*(ms|s|m)$/.exec(normalized);
  if (duration) {
    const amount = Number(duration[1]);
    if (!Number.isFinite(amount) || amount < 0) return null;
    const multiplier = duration[2] === "ms" ? 1 : duration[2] === "m" ? 60_000 : 1_000;
    return Math.round(amount * multiplier);
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric >= 0) {
    const now = Date.now();
    // Reset headers are commonly Unix seconds or Unix milliseconds. Small
    // values are treated as a relative seconds delay.
    if (numeric >= 1_000_000_000_000) return Math.max(0, Math.round(numeric - now));
    if (numeric >= 1_000_000_000) return Math.max(0, Math.round(numeric * 1_000 - now));
    return Math.round(numeric * 1_000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function providerRetryAfterMs(headers: Record<string, string> | null): number | null {
  if (!headers) return null;
  const standard = parseRetryAfterHeaderMs(headers["retry-after"]);
  if (standard !== null) return standard;
  const milliseconds = Number(headers["retry-after-ms"]);
  if (Number.isFinite(milliseconds) && milliseconds >= 0) return Math.round(milliseconds);
  return parseRateLimitResetMs(
    headers["x-ratelimit-reset"]
      ?? headers["x-rate-limit-reset"]
      ?? headers["ratelimit-reset"],
  );
}

export function extractProviderErrorEnvelope(error: unknown): {
  statusCode: number | null;
  responseBody: string | null;
  headers: Record<string, string> | null;
  providerCode: string | null;
  providerMessage: string | null;
  requestId: string | null;
} {
  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let headers: Record<string, string> | null = null;
  let data: unknown = null;

  if (APICallError.isInstance(error)) {
    statusCode = error.statusCode ?? null;
    responseBody = typeof error.responseBody === "string" ? error.responseBody : null;
    headers = headerRecord(error.responseHeaders);
    data = error.data ?? null;
  } else if (isRecord(error)) {
    statusCode = asStatus(error.statusCode) ?? asStatus(error.status);
    responseBody = asString(error.responseBody);
    headers = headerRecord(error.responseHeaders ?? error.headers);
    const rawProviderPayload =
      isRecord(error.error)
      || asString(error.code) !== null
      || asStatus(error.code) !== null
      || asString(error.type) !== null
      || asString(error.reason) !== null
      || asString(error.status) !== null
        ? error
        : null;
    data = error.data
      ?? rawProviderPayload
      ?? parseJsonBody(responseBody);
    if (!statusCode && isRecord(error.response)) {
      statusCode = asStatus(error.response.status);
      headers ??= headerRecord(error.response.headers);
    }
  }

  const payload = data ?? parseJsonBody(responseBody);
  const root = isRecord(payload) ? payload : null;
  const bodyError = nestedError(payload);
  statusCode ??= asStatus(bodyError?.code) ?? asStatus(root?.code);
  const detailCode = Array.isArray(bodyError?.details)
    ? bodyError.details
        .map((detail) => isRecord(detail) ? detail : null)
        .filter((detail): detail is Record<string, unknown> => detail !== null)
        .map((detail) =>
          asString(detail.reason) ??
          asString(detail.code) ??
          asString(detail.type) ??
          asString(detail.status),
        )
        .find((value): value is string => value !== null) ?? null
    : null;
  // Prefer provider-native machine codes/reasons over broad error categories.
  // OpenAI, for example, can pair type=invalid_request_error with
  // code=invalid_api_key; Google can surface API_KEY_INVALID in details[].reason.
  const providerCode =
    asString(bodyError?.code) ??
    asString(bodyError?.reason) ??
    detailCode ??
    asString(bodyError?.type) ??
    asString(bodyError?.status) ??
    asString(root?.code);
  const providerMessage =
    asString(bodyError?.message) ??
    asString(root?.message) ??
    (error instanceof Error ? error.message : null);
  const requestId =
    asString(root?.request_id) ??
    asString(root?.requestId) ??
    asString(bodyError?.request_id) ??
    responseRequestId(headers);

  return {
    statusCode,
    responseBody,
    headers,
    providerCode,
    providerMessage,
    requestId,
  };
}

function normalizeCode(value: string | null): string {
  return (value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function genericKindFromStatus(statusCode: number | null): ProviderFailureKind {
  switch (statusCode) {
    case 400:
    case 413:
    case 422:
      return "request_invalid";
    case 401:
      return "authentication";
    case 402:
      return "billing";
    case 403:
      return "permission";
    case 404:
      return "model_not_found";
    case 408:
      return "timeout";
    case 429:
      return "rate_limit";
    case 500:
    case 502:
    case 503:
    case 504:
    case 529:
      return "provider_unavailable";
    default:
      return statusCode !== null && statusCode >= 500
        ? "provider_unavailable"
        : "unknown";
  }
}

function anthropicKind(code: string): ProviderFailureKind | null {
  const map: Record<string, ProviderFailureKind> = {
    authentication_error: "authentication",
    billing_error: "billing",
    permission_error: "permission",
    not_found_error: "model_not_found",
    rate_limit_error: "rate_limit",
    timeout_error: "timeout",
    api_error: "provider_unavailable",
    overloaded_error: "provider_unavailable",
    invalid_request_error: "request_invalid",
  };
  return map[code] ?? null;
}

function googleKind(code: string): ProviderFailureKind | null {
  const map: Record<string, ProviderFailureKind> = {
    authentication: "authentication",
    unauthenticated: "authentication",
    api_key_invalid: "authentication",
    permission_denied: "permission",
    model_not_found: "model_not_found",
    not_found: "model_not_found",
    rate_limit_exceeded: "rate_limit",
    resource_exhausted: "quota",
    quota_exceeded: "quota",
    service_unavailable: "provider_unavailable",
    unavailable: "provider_unavailable",
    api_error: "provider_unavailable",
    cancelled: "cancelled",
    canceled: "cancelled",
    safety: "content_policy",
    prohibited_content: "content_policy",
    content_blocked: "content_policy",
    recitation: "content_policy",
    invalid_argument: "request_invalid",
  };
  return map[code] ?? null;
}

function openAiKind(code: string): ProviderFailureKind | null {
  const map: Record<string, ProviderFailureKind> = {
    invalid_api_key: "authentication",
    authentication_error: "authentication",
    insufficient_permissions: "permission",
    permission_denied: "permission",
    insufficient_quota: "quota",
    billing_hard_limit_reached: "billing",
    rate_limit_exceeded: "rate_limit",
    free_usage_limit_error: "quota",
    free_usage_limit: "quota",
    usage_limit_exceeded: "quota",
    model_not_found: "model_not_found",
    invalid_request_error: "request_invalid",
    content_policy_violation: "content_policy",
    content_filter: "content_policy",
    server_error: "provider_unavailable",
  };
  return map[code] ?? null;
}

function codeSpecificKind(provider: string, code: string): ProviderFailureKind | null {
  if (!code) return null;
  switch (provider) {
    case "anthropic":
      return anthropicKind(code);
    case "google":
    case "google-ai-studio":
      return googleKind(code);
    case "openai":
      return openAiKind(code);
    case "deepseek":
      return null;
    default:
      return anthropicKind(code) ?? googleKind(code) ?? openAiKind(code);
  }
}

function inferKindFromMessage(message: string | null): ProviderFailureKind | null {
  const normalized = (message ?? "").toLowerCase();
  if (!normalized) return null;
  if (/\b(api[_ -]?key[_ -]?invalid|invalid api key|api key (?:is )?not valid|authentication failed|unauthenticated)\b/.test(normalized)) {
    return "authentication";
  }
  if (/\b(permission denied|insufficient permissions?|not permitted)\b/.test(normalized)) {
    return "permission";
  }
  if (
    /\b(insufficient credits?|insufficient (?:account )?balance|billing hard limit|payment required)\b/.test(
      normalized,
    )
  ) {
    return "billing";
  }
  if (/\b(quota exceeded|insufficient quota|usage limit exceeded|free usage limit)\b/.test(normalized)) {
    return "quota";
  }
  if (/\b(rate limit(?:ed)?|too many requests)\b/.test(normalized)) {
    return "rate_limit";
  }
  if (/\b(content policy|prohibited content|safety block|content blocked|recitation)\b/.test(normalized)) {
    return "content_policy";
  }
  if (/\b(timed? out|timeout)\b/.test(normalized)) return "timeout";
  // @ai-sdk/openai-compatible >=3.0.33 reports a truncated SSE response as
  // InvalidResponseDataError instead of silently treating it as a successful
  // `other` finish. This is a transport-level failure: retrying or failing over
  // is safe because the durable chat run only commits the assistant message
  // after a terminal successful finish.
  if (normalized.includes("response stream ended without a finish reason")) {
    return "transport";
  }
  return null;
}

function failureBehavior(kind: ProviderFailureKind, providerCode: string): {
  retryable: boolean;
  failoverEligible: boolean;
  credentialDisposition: CredentialDisposition;
} {
  switch (kind) {
    case "authentication":
      return { retryable: false, failoverEligible: true, credentialDisposition: "invalidate" };
    case "permission":
    case "billing":
    case "model_not_found":
      return { retryable: false, failoverEligible: true, credentialDisposition: "keep" };
    case "rate_limit":
      return { retryable: true, failoverEligible: true, credentialDisposition: "keep" };
    case "quota":
      return {
        retryable: !/(billing|hard_limit|insufficient_balance|daily_quota|free_usage_limit|usage_limit_exceeded)/.test(providerCode),
        failoverEligible: true,
        credentialDisposition: "keep",
      };
    case "request_invalid":
    case "content_policy":
      return { retryable: false, failoverEligible: false, credentialDisposition: "keep" };
    case "timeout":
    case "provider_unavailable":
    case "transport":
      return { retryable: true, failoverEligible: true, credentialDisposition: "keep" };
    case "cancelled":
      return { retryable: false, failoverEligible: false, credentialDisposition: "keep" };
    case "unknown":
      return { retryable: false, failoverEligible: false, credentialDisposition: "keep" };
  }
}

function publicErrorFor(kind: ProviderFailureKind): ProviderRuntimeFailure["publicError"] {
  switch (kind) {
    case "authentication":
      return {
        code: "PROVIDER_AUTH_FAILED",
        message: "Your provider credential is invalid or has been revoked.",
        retryable: false,
        action: "OPEN_SETTINGS",
      };
    case "permission":
      return {
        code: "PROVIDER_PERMISSION_DENIED",
        message: "The provider credential is valid, but it does not have permission for this model or operation.",
        retryable: false,
        action: "SELECT_MODEL",
      };
    case "billing":
      return {
        code: "PROVIDER_BILLING_FAILED",
        message: "The provider account cannot currently bill this request.",
        retryable: false,
        action: "OPEN_SETTINGS",
      };
    case "rate_limit":
      return {
        code: "PROVIDER_RATE_LIMITED",
        message: "The selected model is temporarily rate limited. Try again later or choose another model.",
        retryable: true,
        action: "RETRY",
      };
    case "quota":
      return {
        code: "PROVIDER_QUOTA_EXHAUSTED",
        message: "The selected model has reached its current usage quota. Choose another model or try again later.",
        retryable: false,
        action: "SELECT_MODEL",
      };
    case "model_not_found":
      return {
        code: "PROVIDER_MODEL_NOT_FOUND",
        message: "The selected model is not available to this provider account.",
        retryable: false,
        action: "SELECT_MODEL",
      };
    case "request_invalid":
      return {
        code: "PROVIDER_REQUEST_INVALID",
        message: "The provider rejected this model request as invalid.",
        retryable: false,
        action: "SELECT_MODEL",
      };
    case "content_policy":
      return {
        code: "PROVIDER_REQUEST_INVALID",
        message: "The provider declined this request under its content policy.",
        retryable: false,
      };
    case "cancelled":
      return {
        code: "REQUEST_CANCELLED",
        message: "Run cancelled",
        retryable: false,
      };
    case "timeout":
      return {
        code: "PROVIDER_UNAVAILABLE",
        message: "The model provider timed out.",
        retryable: true,
        action: "RETRY",
      };
    case "provider_unavailable":
    case "transport":
      return {
        code: "PROVIDER_UNAVAILABLE",
        message: "The model provider is temporarily unavailable.",
        retryable: true,
        action: "RETRY",
      };
    case "unknown":
      return {
        code: "PROVIDER_UNAVAILABLE",
        message: "The model provider could not complete the response.",
        retryable: false,
      };
  }
}

export function createProviderRuntimeFailure(input: {
  provider: string;
  source: ProviderFailureSource;
  kind: ProviderFailureKind;
  statusCode?: number | null;
  providerCode?: string | null;
  providerMessage?: string | null;
  providerRequestId?: string | null;
  retryAfterMs?: number | null;
  retryable?: boolean;
  failoverEligible?: boolean;
  credentialDisposition?: CredentialDisposition;
  publicError?: ProviderRuntimeFailure["publicError"];
  modelKey?: string;
  providerModelId?: string;
  cause?: unknown;
}): ProviderRuntimeFailure {
  const providerCode = normalizeCode(input.providerCode ?? null);
  const behavior = failureBehavior(input.kind, providerCode);
  const retryable = input.retryable ?? behavior.retryable;
  const freeUsageLimit = input.kind === "quota"
    && /^(?:free_usage_limit_error|free_usage_limit|usage_limit_exceeded)$/.test(providerCode);
  const publicError = input.publicError
    ?? (freeUsageLimit
      ? {
          code: "PROVIDER_QUOTA_EXHAUSTED" as const,
          message: "The selected free model has reached its current usage limit. Choose another model or try again later.",
          retryable: false,
          action: "SELECT_MODEL" as const,
        }
      : publicErrorFor(input.kind));
  return new ProviderRuntimeFailureError({
    provider: input.provider,
    ...(input.modelKey ? { modelKey: input.modelKey } : {}),
    ...(input.providerModelId ? { providerModelId: input.providerModelId } : {}),
    source: input.source,
    kind: input.kind,
    statusCode: input.statusCode ?? null,
    providerCode: input.providerCode ?? null,
    providerMessage: input.providerMessage ?? null,
    providerRequestId: input.providerRequestId ?? null,
    retryable,
    failoverEligible: input.failoverEligible ?? behavior.failoverEligible,
    credentialDisposition: input.credentialDisposition ?? behavior.credentialDisposition,
    retryAfterMs: input.retryAfterMs ?? null,
    publicError: { ...publicError, retryable },
    cause: input.cause,
  });
}

export function isProviderRuntimeFailure(error: unknown): error is ProviderRuntimeFailure {
  if (!isRecord(error)) return false;
  return error.name === "ProviderRuntimeFailure"
    && typeof error.provider === "string"
    && typeof error.source === "string"
    && typeof error.kind === "string"
    && isRecord(error.publicError);
}

export function classifyProviderFailure(input: {
  error: unknown;
  provider: string;
  source: ProviderFailureSource;
  model?: { modelKey?: string; providerModelId?: string };
}): ProviderRuntimeFailure {
  if (isProviderRuntimeFailure(input.error)) {
    const modelKey = input.model?.modelKey ?? input.error.modelKey;
    const providerModelId = input.model?.providerModelId ?? input.error.providerModelId;
    if (
      modelKey === input.error.modelKey
      && providerModelId === input.error.providerModelId
    ) {
      return input.error;
    }
    return createProviderRuntimeFailure({
      provider: input.error.provider,
      source: input.error.source,
      kind: input.error.kind,
      statusCode: input.error.statusCode,
      providerCode: input.error.providerCode,
      providerMessage: input.error.providerMessage,
      providerRequestId: input.error.providerRequestId,
      retryAfterMs: input.error.retryAfterMs,
      retryable: input.error.retryable,
      failoverEligible: input.error.failoverEligible,
      credentialDisposition: input.error.credentialDisposition,
      publicError: input.error.publicError,
      ...(modelKey ? { modelKey } : {}),
      ...(providerModelId ? { providerModelId } : {}),
      cause: input.error.cause,
    });
  }

  const envelope = extractProviderErrorEnvelope(input.error);
  const code = normalizeCode(envelope.providerCode);
  const errorName = input.error instanceof Error ? input.error.name : "";
  const apiCause = APICallError.isInstance(input.error) ? input.error.cause : undefined;
  const causeName = apiCause instanceof Error ? apiCause.name : "";
  const aborted = errorName === "AbortError" || causeName === "AbortError";
  const timedOut = errorName === "TimeoutError"
    || causeName === "TimeoutError"
    || /timeout/i.test(errorName)
    || /timeout/i.test(causeName);

  const statusKind = genericKindFromStatus(envelope.statusCode);
  const genericCodeKind = /^(?:free_usage_limit_error|free_usage_limit|usage_limit_exceeded)$/.test(code)
    ? "quota" as const
    : null;
  let kind = genericCodeKind ?? codeSpecificKind(input.provider, code) ?? statusKind;
  if (kind === "unknown") {
    kind = inferKindFromMessage(envelope.providerMessage) ?? "unknown";
  }

  if (input.provider === "deepseek" && envelope.statusCode !== null) {
    kind = statusKind;
  }
  if (timedOut) kind = "timeout";
  else if (aborted) kind = "cancelled";
  else if (kind === "unknown" && (input.error instanceof TypeError || apiCause instanceof TypeError)) {
    kind = "transport";
  } else if (kind === "unknown" && APICallError.isInstance(input.error) && input.error.isRetryable) {
    kind = "provider_unavailable";
  }

  const retryAfterMs = providerRetryAfterMs(envelope.headers);

  return createProviderRuntimeFailure({
    provider: input.provider,
    source: input.source,
    kind,
    statusCode: envelope.statusCode,
    providerCode: envelope.providerCode,
    providerMessage: envelope.providerMessage,
    providerRequestId: envelope.requestId,
    retryAfterMs,
    ...(input.model?.modelKey ? { modelKey: input.model.modelKey } : {}),
    ...(input.model?.providerModelId ? { providerModelId: input.model.providerModelId } : {}),
    cause: input.error,
  });
}
