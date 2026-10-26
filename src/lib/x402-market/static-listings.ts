import type { X402MarketListing } from "@/lib/x402-market/types";

/**
 * Static/demo inventory is intentionally disabled.
 *
 * The marketplace must only advertise services that are backed by an actual
 * published AgentRanking service, a validated inference-provider descriptor,
 * or the worker-indexed external x402 directory. Invented endpoints and prices
 * are misleading and cannot be safely marked online or verified.
 */
export const AGENTRANKING_NATIVE_X402_LISTINGS: readonly X402MarketListing[] = [];
export const CURATED_X402_MARKET_LISTINGS: readonly X402MarketListing[] = [];
export const STATIC_X402_MARKET_LISTINGS: readonly X402MarketListing[] = [];
