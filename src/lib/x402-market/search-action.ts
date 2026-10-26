"use server";
import type { X402MarketListing, X402MarketListingSource } from "@/lib/x402-market/types";
import {
  searchX402MarketListings,
  type X402MarketSearchMeta,
} from "@/lib/x402-market/listings.server";
export type X402MarketSearchActionResult = {
  data: X402MarketListing[];
  meta: X402MarketSearchMeta;
  error?: string;
};
const EMPTY_SOURCES: Record<X402MarketListingSource, number> = {
  curated: 0,
  native: 0,
  published: 0,
  inference: 0,
  external: 0,
};
const EMPTY_META: X402MarketSearchMeta = {
  total: 0,
  page: 1,
  perPage: 25,
  sources: EMPTY_SOURCES,
};
export async function searchX402MarketAction(
  query: string,
): Promise<X402MarketSearchActionResult> {
  const q = query.trim();
  if (!q) {
    return { data: [], meta: EMPTY_META };
  }
  try {
    return await searchX402MarketListings({ q, page: 1 });
  } catch (error) {
    console.error("[x402-market/search-action]", error);
    return {
      data: [],
      meta: EMPTY_META,
      error: "Could not load listings. Try again in a moment.",
    };
  }
}
