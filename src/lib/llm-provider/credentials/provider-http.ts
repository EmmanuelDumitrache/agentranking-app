import "server-only";

import { setTimeout as delay } from "node:timers/promises";
import {
  assertProviderCredentialCircuitAvailable,
  ProviderCredentialCircuitOpenError,
  recordProviderCredentialSuccess,
  recordProviderCredentialTransientFailure,
} from "./circuit-breaker";
import {
  classifyProviderFailure,
  createProviderRuntimeFailure,
  type ProviderRuntimeFailure,
} from "@/lib/llm-provider/provider-failure";

export type ProviderOperation = "catalog" | "inference";

export function providerCircuitKey(args: {
  provider: string;
  credentialFingerprint: string;
  operation: ProviderOperation;
}): string {
  return [args.provider, args.credentialFingerprint, args.operation].join(":");
}

export function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === "AbortError" || error.name === "TimeoutError");
}

function signalAbortKind(signal: AbortSignal | null | undefined): "cancelled" | "timeout" | null {
  if (!signal?.aborted) return null;
  const reason = signal.reason;
  return reason instanceof Error && reason.name === "TimeoutError"
    ? "timeout"
    : "cancelled";
}

async function delayCatalogRetry(params: {
  delayMs: number;
  provider: string;
  providerLabel: string;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    await delay(params.delayMs, undefined, { signal: params.signal });
  } catch (error) {
    const kind = signalAbortKind(params.signal) ?? (isAbortLikeError(error) ? "cancelled" : "transport");
    throw createProviderRuntimeFailure({
      provider: params.provider,
      source: "catalog",
      kind,
      providerMessage: kind === "cancelled"
        ? `${params.providerLabel} API request was cancelled`
        : `${params.providerLabel} API retry backoff failed`,
      cause: error,
    });
  }
}

export function createCircuitAwareProviderFetch(input: {
  circuitKey: string;
  provider: string;
  providerModelId?: string;
}): typeof fetch {
  return async (request, init) => {
    try {
      assertProviderCredentialCircuitAvailable(input.circuitKey);
      const response = await fetch(request, init);
      if (response.ok) {
        recordProviderCredentialSuccess(input.circuitKey);
      } else if (response.status === 408 || response.status === 429 || response.status >= 500) {
        recordProviderCredentialTransientFailure(input.circuitKey);
      }
      return response;
    } catch (error) {
      if (error instanceof ProviderCredentialCircuitOpenError) {
        throw createProviderRuntimeFailure({
          provider: input.provider,
          source: "inference",
          kind: "provider_unavailable",
          providerModelId: input.providerModelId,
          retryAfterMs: error.retryAfterMs,
          providerMessage: "Provider credential inference circuit is temporarily open",
          cause: error,
        });
      }
      if (!isAbortLikeError(error)) {
        recordProviderCredentialTransientFailure(input.circuitKey);
      }
      const requestSignal = init?.signal
        ?? (request instanceof Request ? request.signal : undefined);
      const abortKind = signalAbortKind(requestSignal);
      if (abortKind) {
        throw createProviderRuntimeFailure({
          provider: input.provider,
          source: "inference",
          kind: abortKind,
          providerModelId: input.providerModelId,
          providerMessage: abortKind === "timeout"
            ? "Provider inference request timed out"
            : "Provider inference request was cancelled",
          cause: error,
        });
      }
      throw classifyProviderFailure({
        error,
        provider: input.provider,
        source: "inference",
        model: input.providerModelId
          ? { providerModelId: input.providerModelId }
          : undefined,
      });
    }
  };
}

export async function fetchProviderCredentialEndpoint(input: {
  provider: string;
  providerLabel: string;
  url: URL;
  init?: RequestInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  attempts?: number;
  classify(response: Response): Promise<ProviderRuntimeFailure>;
}): Promise<Response> {
  const attempts = Math.max(1, input.attempts ?? 3);
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? 10_000);
  let lastError: ProviderRuntimeFailure | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const requestSignal = input.signal
        ? AbortSignal.any([input.signal, timeoutSignal])
        : timeoutSignal;
      response = await fetch(input.url, {
        ...input.init,
        signal: requestSignal,
        cache: "no-store",
      });
    } catch (error) {
      const kind = input.signal?.aborted
        ? "cancelled"
        : isAbortLikeError(error)
          ? "timeout"
          : "transport";
      lastError = createProviderRuntimeFailure({
        provider: input.provider,
        source: "catalog",
        kind,
        providerMessage:
          kind === "timeout"
            ? `${input.providerLabel} API request timed out`
            : kind === "cancelled"
              ? `${input.providerLabel} API request was cancelled`
              : `${input.providerLabel} API request failed`,
        cause: error,
      });
      if (input.signal?.aborted || !lastError.retryable || attempt >= attempts - 1) {
        throw lastError;
      }
      await delayCatalogRetry({
        delayMs: 250 * 2 ** attempt + Math.floor(Math.random() * 250),
        provider: input.provider,
        providerLabel: input.providerLabel,
        signal: input.signal,
      });
      continue;
    }

    if (response.ok) return response;

    const classified = await input.classify(response);
    lastError = classified;
    if (!classified.retryable || attempt >= attempts - 1) throw classified;
    const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 300);
    const retryAfter = classified.retryAfterMs ?? 0;
    await delayCatalogRetry({
      delayMs: Math.min(15_000, Math.max(backoff, retryAfter)),
      provider: input.provider,
      providerLabel: input.providerLabel,
      signal: input.signal,
    });
  }

  throw lastError ?? createProviderRuntimeFailure({
    provider: input.provider,
    source: "catalog",
    kind: "provider_unavailable",
    providerMessage: `${input.providerLabel} API request failed`,
    cause: null,
  });
}
