import "server-only";
import { getLavaraveConfig } from "@/lib/agent-trading/lavarave/config";

type LavaraveFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
};

async function lavaraveFetch<T>(path: string, options: LavaraveFetchOptions = {}): Promise<T> {
  const config = getLavaraveConfig();
  if (!config.enabled) {
    throw new Error("Lavarave API key is not configured.");
  }
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": config.apiKey,
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { error: text };
    }
  }
  if (!res.ok) {
    throw new Error(
      typeof json === "object" &&
        json != null &&
        "error" in json &&
        typeof (json as { error: unknown }).error === "string"
        ? (json as { error: string }).error
        : `Lavarave API ${res.status}`,
    );
  }
  return json as T;
}

function normalizeOffers(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (typeof input === "object" && input != null) {
    const row = input as Record<string, unknown>;
    if (Array.isArray(row.offers)) return row.offers;
    if (Array.isArray((row.data as { offers?: unknown[] } | undefined)?.offers)) {
      return (row.data as { offers: unknown[] }).offers;
    }
    if (Array.isArray(row.data)) return row.data as unknown[];
  }
  return [];
}

export const lavaraveApi = {
  async offersV2(): Promise<unknown[]> {
    const raw = await lavaraveFetch<unknown>(
      "/api/sdk/v1.0/offers/v2?includeTokens=true&inactiveOffers=false&includeRawData=false",
    );
    return normalizeOffers(raw);
  },

  async openPositionsV2(): Promise<unknown> {
    return lavaraveFetch("/api/sdk/v1.0/positions/open/v2");
  },

  async openPosition(payload: Record<string, unknown>): Promise<{ statusCode: number; data: unknown }> {
    const config = getLavaraveConfig();
    const res = await fetch(`${config.apiBaseUrl}/api/sdk/v1.0/positions/open`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    return { statusCode: res.status, data };
  },

  async sellPosition(payload: Record<string, unknown>): Promise<{ statusCode: number; data: unknown }> {
    const config = getLavaraveConfig();
    const res = await fetch(`${config.apiBaseUrl}/api/sdk/v1.0/positions/sell`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    return { statusCode: res.status, data };
  },
};
