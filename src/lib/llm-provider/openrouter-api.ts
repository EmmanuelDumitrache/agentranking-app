import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";

const OpenRouterGenerationSchema = z.object({
  id: z.string().optional(),
  total_cost: z.union([z.number(), z.string()]).optional(),
  total_tokens: z.number().optional(),
  origin: z.string().optional(),
  created_at: z.string().optional(),
});

export type OpenRouterGenerationResponse = {
  id: string;
  total_cost: number;
  total_tokens: number;
  origin: string;
  created_at: string;
};
/**
 * Fetch an OpenRouter generation by ID.
 * Returns null when the generation is not yet available (404) or on any error —
 * the caller owns retry logic.
 */
export async function fetchGeneration(
  generationId: string,
): Promise<OpenRouterGenerationResponse | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await parseBoundedJsonBody(res, OpenRouterGenerationSchema, 256 * 1024);
    // total_cost may arrive as a decimal string or number. Reject malformed
    // values without forcing a pointless Number -> BigInt conversion.
    const parsedTotalCostUsd =
      typeof data.total_cost === "number"
        ? data.total_cost
        : typeof data.total_cost === "string"
          ? Number(data.total_cost)
          : 0;
    const totalCostUsd =
      Number.isFinite(parsedTotalCostUsd) && parsedTotalCostUsd >= 0
        ? parsedTotalCostUsd
        : 0;
    return {
      id: String(data.id ?? generationId),
      total_cost: totalCostUsd,
      total_tokens: typeof data.total_tokens === "number" ? data.total_tokens : 0,
      origin: String(data.origin ?? ""),
      created_at: String(data.created_at ?? ""),
    };
  } catch {
    return null;
  }
}
