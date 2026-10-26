import { fetchPublicJson } from "@/lib/outbound-http";
import { normalizeModelsCatalog } from "@/lib/inference-providers/models-catalog";
import type { InferenceModelCatalog } from "@/lib/inference-providers/types";

/**
 * Fetch and normalize a provider model catalog from a public HTTPS endpoint.
 *
 * This module is intentionally separated from the pure catalog helpers so
 * Client Components can format catalog rows without importing Node-only DNS
 * and socket validation code through `outbound-http`.
 */
export async function fetchModelsCatalog(
  providerId: string,
  catalogUrl: string,
): Promise<InferenceModelCatalog | null> {
  const json = await fetchPublicJson<unknown>(catalogUrl, {
    timeoutMs: 20_000,
    maxResponseBytes: 4 * 1024 * 1024,
    headers: {
      Accept: "application/json",
      "User-Agent": "AgentRanking-InferenceIndexer/2.0",
    },
  });
  return normalizeModelsCatalog(providerId, catalogUrl, json);
}
