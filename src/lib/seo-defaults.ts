/**
 * Canonical SEO strings and defaults for AgentRanking (agentranking.io).
 * Single source for homepage title/description, default OG image path, and Twitter handle.
 */
import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
/** Short brand for og:site_name, applicationName, and JSON-LD Organization.name */
export const SITE_BRAND_NAME = "AgentRanking";
/** Exact homepage <title> — front-loaded for branded + protocol intent (CTR in SERPs). */
export const HOME_PAGE_TITLE =
  "AgentRanking | AI Agent Directory & On-Chain Agent Intelligence";
/**
 * Meta description (~150–158 chars targets mobile SERPs).
 */
export const HOME_PAGE_DESCRIPTION =
  "Discover, compare, and verify on-chain AI agents across Solana, Base, Ethereum, x402, MCP, ERC-8004, Metaplex, and SAP.";
/** Public-site `<title>` — keep ~55–65 chars for SERP display. */
export const PUBLIC_HOME_TITLE =
  "AgentRanking | The Trust Layer for the Agent Economy";
/** Longer headline for Open Graph / Twitter cards. */
export const PUBLIC_HOME_OG_TITLE =
  "AgentRanking — The trust layer for the agent economy";
/** Public-site Open Graph image (under public/og/social/). */
export const PUBLIC_SITE_OG_IMAGE_PATH = "/og/social/home.png";
/** Public-site meta description (~155 chars): discovery + protocols + app CTA without duplicating the app homepage verbatim. */
export const PUBLIC_HOME_DESCRIPTION =
  "Verify, deploy, and tokenize AI agents on AgentRanking. Live rankings across 35+ chains, token launchpad, AR Score discovery, and $AR staking.";
/** Stake marketing host `<title>`. */
export const STAKE_PAGE_TITLE =
  "Stake $AR — AI Agent Flywheel Rewards | AgentRanking";
/** Stake host meta description. */
export const STAKE_PAGE_DESCRIPTION =
  "Stake $AR on Solana for fee-backed rewards from the AgentRanking flywheel. Non-custodial Streamflow locks — crypto AI agent rankings and ecosystem perks, not fixed APY.";
/** Stake Open Graph headline. */
export const STAKE_PAGE_OG_TITLE =
  "Stake $AR | AgentRanking — Crypto Agent Economy & Flywheel Rewards";
/** X (Twitter) handle for twitter:site / twitter:creator */
export const SITE_TWITTER_HANDLE = "@agentranking";
/** Default Open Graph / Twitter image under public/og/social/. */
export const DEFAULT_OG_IMAGE_PATH = "/og/social/home.png";
export function defaultOgImageAbsoluteUrl(): string {
  return absoluteUrl(DEFAULT_OG_IMAGE_PATH);
}
export function defaultOgImageMetadata(): {
  url: string;
  width: number;
  height: number;
  alt: string;
} {
  return {
    url: defaultOgImageAbsoluteUrl(),
    width: 1200,
    height: 630,
    alt: HOME_PAGE_TITLE,
  };
}
/**
 * English-only site: pass into `metadata.alternates` together with `canonical`.
 * Example: `alternates: { canonical: url, languages: hreflangLanguages(url) }`
 */
export function hreflangLanguages(canonicalUrl: string): Record<string, string> {
  return {
    en: canonicalUrl,
    "x-default": canonicalUrl,
  };
}
/** Utility / account routes disallowed in robots.txt — avoid "indexed but blocked" in GSC. */
export const ROBOTS_NOINDEX_UTILITY: Metadata["robots"] = {
  index: false,
  follow: false,
};

/** Cache-bust favicon/icon assets after the 2026 brand refresh. */
export const SITE_ICON_VERSION = "20260720";
export function siteIconUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return absoluteUrl(`${normalized}?v=${SITE_ICON_VERSION}`);
}
