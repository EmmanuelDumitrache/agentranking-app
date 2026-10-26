import type { AgentPassport } from "@/lib/agent-launch/passport";
import {
  AGENTRANKING_CREATOR_SHARE_BPS,
  AGENTRANKING_PLATFORM_SHARE_BPS,
} from "@/lib/agent-launch/fees";
import {
  buildAgentRankingTokenDescription,
  buildAgentRankingTokenExternalUrl,
} from "@/lib/agent-launch/metadata-branding";
import { resolveUploadPublicUrl } from "@/lib/public-media-url";
import { getPublicSiteUrl } from "@/lib/site-url";
export type AgentLaunchTokenMetadataAttribute = {
  trait_type: string;
  value: string;
};
export type AgentLaunchTokenMetadata = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  attributes: AgentLaunchTokenMetadataAttribute[];
  ar_passport_uri: string;
};
const DEFAULT_IMAGE_PLACEHOLDER = "https://agentranking.io/brand/agent-launch-placeholder.png";
export function buildAgentRankingLaunchUrl(mint: string | null): string {
  const base = getPublicSiteUrl();
  if (mint?.trim()) {
    return `${base.replace(/\/$/, "")}/tokens/${mint.trim()}`;
  }
  return `${base.replace(/\/$/, "")}/agents`;
}
function creatorFeeRoutingLabel(creatorBps: number, arBps: number): string {
  return `${creatorBps / 100}/${arBps / 100}`;
}
function networkLabel(network: string): string {
  if (network === "devnet") return "Solana Devnet";
  return network;
}
/**
 * Normalize a raw X/Twitter input into https://x.com/... format.
 * Accepts: @handle, handle, https://x.com/handle, https://twitter.com/handle
 * Returns null if empty after trimming.
 */
export function normalizeTwitterUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  // Already a full X/Twitter URL
  if (trimmed.startsWith("https://x.com/") || trimmed.startsWith("https://twitter.com/")) return trimmed;
  // @handle or handle
  const handle = trimmed.replace(/^@/, "");
  if (!handle || handle.includes("/")) return null; // suspicious input
  return `https://x.com/${handle}`;
}
/**
 * Normalize a raw Telegram input into https://t.me/... format.
 * Accepts: @channel, channel, https://t.me/channel
 * Returns null if empty after trimming.
 */
export function normalizeTelegramUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("https://t.me/")) return trimmed;
  const channel = trimmed.replace(/^@/, "");
  if (!channel || channel.includes("/")) return null;
  return `https://t.me/${channel}`;
}

export function normalizeGithubUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("https://github.com/")) return trimmed;
  const path = trimmed.replace(/^@/, "").replace(/^github\.com\//i, "");
  if (!path || path.includes(" ")) return null;
  return `https://github.com/${path}`;
}
export function buildAgentLaunchTokenMetadata(input: {
  mint: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenDescription: string | null;
  tokenImageUrl: string | null;
  network: string;
  passportUri: string;
  imagePlaceholder?: string | null;
  creatorShareBps?: number;
  arShareBps?: number;
  twitter?: string | null;
  telegram?: string | null;
  github?: string | null;
  capabilityTags?: string[];
}): AgentLaunchTokenMetadata {
  const name = input.tokenName?.trim() || "Agent Launch";
  const symbol = input.tokenSymbol?.trim() || "AGENT";
  const launchUrl = buildAgentRankingLaunchUrl(input.mint);
  const image = resolveUploadPublicUrl(
    input.tokenImageUrl?.trim() ||
      input.imagePlaceholder?.trim() ||
      DEFAULT_IMAGE_PLACEHOLDER,
  );
  const description = buildAgentRankingTokenDescription({
    userDescription:
      input.tokenDescription?.trim() ||
      "Agent launch indexed through AgentRanking.",
  });
  const creatorBps = input.creatorShareBps ?? AGENTRANKING_CREATOR_SHARE_BPS;
  const arBps = input.arShareBps ?? AGENTRANKING_PLATFORM_SHARE_BPS;
  const normalizedTwitter = normalizeTwitterUrl(input.twitter);
  const normalizedTelegram = normalizeTelegramUrl(input.telegram);
  const normalizedGithub = normalizeGithubUrl(input.github);
  const website = buildAgentRankingTokenExternalUrl({ mint: input.mint });
  const attrs: AgentLaunchTokenMetadataAttribute[] = [
    { trait_type: "Launch Source", value: "AgentRanking" },
    { trait_type: "Agent Passport", value: "Enabled" },
    {
      trait_type: "Creator Fee Routing",
      value: creatorFeeRoutingLabel(creatorBps, arBps),
    },
    { trait_type: "Network", value: networkLabel(input.network) },
  ];
  if (normalizedTwitter) {
    attrs.push({ trait_type: "X / Twitter", value: normalizedTwitter });
  }
  if (normalizedTelegram) {
    attrs.push({ trait_type: "Telegram", value: normalizedTelegram });
  }
  if (normalizedGithub) {
    attrs.push({ trait_type: "GitHub", value: normalizedGithub });
  }
  for (const tag of input.capabilityTags ?? []) {
    const trimmed = tag.trim();
    if (trimmed) attrs.push({ trait_type: "Capability", value: trimmed });
  }
  // Build the top-level JSON with separate website/URL fields
  // so Pump.fun can show them as links/buttons.
  const metadata: AgentLaunchTokenMetadata = {
    name,
    symbol,
    description,
    image,
    external_url: launchUrl,
    website,
    ...(normalizedTwitter ? { twitter: normalizedTwitter } : {}),
    ...(normalizedTelegram ? { telegram: normalizedTelegram } : {}),
    attributes: attrs,
    ar_passport_uri: input.passportUri,
  };
  return metadata;
}
export function capabilityAttributesFromPassport(
  passport: AgentPassport,
): AgentLaunchTokenMetadataAttribute[] {
  const attrs: AgentLaunchTokenMetadataAttribute[] = [];
  const { capabilities } = passport;
  if (capabilities.api.ready && capabilities.api.endpoint) {
    attrs.push({ trait_type: "API Endpoint", value: capabilities.api.endpoint });
  }
  if (capabilities.mcp.ready && capabilities.mcp.endpoint) {
    attrs.push({ trait_type: "MCP Endpoint", value: capabilities.mcp.endpoint });
  }
  if (capabilities.x402.ready && capabilities.x402.endpoint) {
    attrs.push({ trait_type: "x402 Endpoint", value: capabilities.x402.endpoint });
  }
  if (capabilities.github.ready && capabilities.github.repo) {
    attrs.push({ trait_type: "GitHub Repo", value: capabilities.github.repo });
  }
  if (passport.analytics.apiCallsTracked) {
    attrs.push({ trait_type: "API Calls Tracked", value: "Yes" });
  }
  return attrs;
}
export function enrichTokenMetadataWithPassport(
  base: AgentLaunchTokenMetadata,
  passport: AgentPassport,
): AgentLaunchTokenMetadata {
  return {
    ...base,
    attributes: [...base.attributes, ...capabilityAttributesFromPassport(passport)],
  };
}