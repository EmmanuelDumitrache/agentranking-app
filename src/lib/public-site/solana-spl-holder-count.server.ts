import "server-only";
import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";

const HeliusTokenAccountsResponseSchema = z.object({
  result: z.object({
    total: z.number().int().nonnegative().optional(),
  }).optional(),
});

/**
 * Cheap holder-count probe via Helius `getTokenAccounts` (page 1, limit 1).
 * Returns the indexed `total` account count, or null when unavailable.
 */
export async function getSolanaSplHolderCount(mint: string): Promise<number | null> {
  const apiKey = process.env.HELIUS_API_KEY?.trim();
  if (!apiKey || !mint.trim()) return null;
  try {
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "ar-live-feed-holders",
        method: "getTokenAccounts",
        params: {
          mint: mint.trim(),
          page: 1,
          limit: 1,
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const payload = await parseBoundedJsonBody(response, HeliusTokenAccountsResponseSchema, 256 * 1024);
    const total = payload.result?.total;
    return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}
