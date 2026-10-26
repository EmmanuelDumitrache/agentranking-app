import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";

const WurkPricesSchema = z.object({
  wurkUsd: z.coerce.number().positive(),
});

export type WurkPrices = {
  wurkUsd: number;
};
export const WURK_PRICES_URL = "https://wurk.fun/api/prices";
export async function fetchWurkPrices(): Promise<WurkPrices | null> {
  try {
    const res = await fetch(WURK_PRICES_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await parseBoundedJsonBody(res, WurkPricesSchema, 128 * 1024);
    return { wurkUsd: data.wurkUsd };
  } catch {
    return null;
  }
}
