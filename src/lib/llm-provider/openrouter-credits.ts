import { createHash } from "node:crypto";
import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { getExternalProviderCached } from "@/lib/external-provider-cache";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";

const OpenRouterKeyResponseSchema = z.object({
  data: z.object({
    // OpenRouter keys can be created without a spending limit. In that case
    // the key endpoint can report null instead of a finite USD ceiling.
    limit: z.number().nonnegative().nullable().optional().default(null),
    usage: z.number().nonnegative().optional().default(0),
    limit_remaining: z.number().nonnegative().nullable().optional(),
  }),
});

function cacheKeyForApiKey(apiKey: string): string {
  const fingerprint = createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  return `openrouter:credits:${fingerprint}`;
}

const CACHE_FRESH_TTL_SECONDS = 60;
const CACHE_STALE_TTL_SECONDS = 5 * 60;
const CACHE_MAX_PAYLOAD_BYTES = 2 * 1_024;
export const OPENROUTER_BALANCE_WARN_USD_CENTS = 2_500;
export const OPENROUTER_BALANCE_CRITICAL_USD_CENTS = 500;
const BALANCE_WARN_THRESHOLD_USD = OPENROUTER_BALANCE_WARN_USD_CENTS / 100;
const BALANCE_CRITICAL_THRESHOLD_USD = OPENROUTER_BALANCE_CRITICAL_USD_CENTS / 100;

export type OpenRouterCredits = {
  limit: number | null;
  usage: number;
  remaining: number | null;
};

export type OpenRouterCreditsStatus = "ok" | "warn" | "critical" | "unknown";

class OpenRouterCreditsUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "OpenRouterCreditsUnavailableError";
  }
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableNonnegativeFiniteNumber(value: unknown): value is number | null {
  return value === null || isNonnegativeFiniteNumber(value);
}

function isCredits(value: unknown): value is OpenRouterCredits {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Partial<OpenRouterCredits>;
  return (
    isNullableNonnegativeFiniteNumber(row.limit)
    && isNonnegativeFiniteNumber(row.usage)
    && isNullableNonnegativeFiniteNumber(row.remaining)
  );
}

export function getCreditsStatus(
  credits: OpenRouterCredits,
): OpenRouterCreditsStatus {
  if (credits.remaining === null) return "unknown";
  if (credits.remaining <= BALANCE_CRITICAL_THRESHOLD_USD) return "critical";
  if (credits.remaining <= BALANCE_WARN_THRESHOLD_USD) return "warn";
  return "ok";
}

async function loadOpenRouterCredits(apiKey: string, signal: AbortSignal): Promise<OpenRouterCredits> {
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
  } catch (error) {
    throw new OpenRouterCreditsUnavailableError("OpenRouter credits request failed", error);
  }
  if (!response.ok) {
    throw new OpenRouterCreditsUnavailableError(
      `OpenRouter credits API returned HTTP ${response.status}`,
    );
  }
  let data: z.infer<typeof OpenRouterKeyResponseSchema>;
  try {
    data = await parseBoundedJsonBody(response, OpenRouterKeyResponseSchema, 256 * 1_024);
  } catch (error) {
    throw new OpenRouterCreditsUnavailableError("OpenRouter credits response was invalid", error);
  }
  const limit = data.data.limit;
  const usage = data.data.usage;
  const remaining = data.data.limit_remaining
    ?? (limit === null ? null : Math.max(0, limit - usage));
  const credits = { limit, usage, remaining };
  if (!isCredits(credits)) {
    throw new OpenRouterCreditsUnavailableError("OpenRouter returned invalid credit values");
  }
  return credits;
}

export async function fetchOpenRouterCredits(): Promise<OpenRouterCredits | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const cached = await getExternalProviderCached({
      key: cacheKeyForApiKey(apiKey),
      validate: isCredits,
      freshTtlSeconds: CACHE_FRESH_TTL_SECONDS,
      staleTtlSeconds: CACHE_STALE_TTL_SECONDS,
      maxPayloadBytes: CACHE_MAX_PAYLOAD_BYTES,
      leaseTtlMs: 20_000,
      load: (signal) => loadOpenRouterCredits(apiKey, signal),
    });
    return cached.value;
  } catch (error) {
    if (error instanceof OpenRouterCreditsUnavailableError) {
      console.error("[openrouter-credits] fetch error", safeErrorDetails(error));
      return null;
    }
    throw error;
  }
}
