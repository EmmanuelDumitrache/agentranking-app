import { computeNativeAgentScore } from "@/lib/public-site/native-agent-score";
import type { NativeAgentScoreBreakdown } from "@/lib/public-site/native-agent-score";

export const LAUNCH_CAPABILITY_TAG_OPTIONS = [
  "WEB",
  "ONCHAIN-DATA",
  "FARCASTER",
  "MOLTBOOK",
  "API",
  "MCP",
  "x402",
  "autonomous",
  "analytics",
  "trading",
] as const;

export const LAUNCH_ARCHETYPE_OPTIONS = [
  { value: "", label: "— None —" },
  { value: "trading", label: "Trading" },
  { value: "arbitrage", label: "Arbitrage" },
  { value: "sniper", label: "Sniper" },
  { value: "yield", label: "Yield" },
  { value: "builder", label: "Builder" },
  { value: "analytics", label: "Analytics" },
  { value: "bridge", label: "Bridge" },
  { value: "copy_trader", label: "Copy Trader" },
  { value: "social", label: "Social" },
  { value: "mev", label: "MEV" },
] as const;

export type LaunchProfileServiceInput = {
  name: string;
  endpoint: string;
  version?: string;
};

export type LaunchProfileEnrichmentFields = {
  website: string;
  github: string;
  archetype: string;
  capabilityTags: string[];
  services: LaunchProfileServiceInput[];
};

export const EMPTY_LAUNCH_PROFILE_ENRICHMENT: LaunchProfileEnrichmentFields = {
  website: "",
  github: "",
  archetype: "",
  capabilityTags: [],
  services: [],
};

export function normalizeLaunchCapabilityTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim().toUpperCase().replace(/\s+/g, "-").slice(0, 48);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    output.push(tag);
    if (output.length >= 12) break;
  }
  return output;
}

export function normalizeLaunchProfileServices(raw: unknown): LaunchProfileServiceInput[] {
  if (!Array.isArray(raw)) return [];
  const output: LaunchProfileServiceInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; endpoint?: unknown; version?: unknown };
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 64) : "";
    const endpoint = typeof row.endpoint === "string" ? row.endpoint.trim().slice(0, 512) : "";
    if (!name || !endpoint) continue;
    output.push({
      name,
      endpoint,
      version: typeof row.version === "string" ? row.version.trim().slice(0, 32) : "",
    });
    if (output.length >= 8) break;
  }
  return output;
}

export function normalizeGithubUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.startsWith("https://github.com/")) return trimmed;
  const path = trimmed.replace(/^@/, "").replace(/^github\.com\//i, "");
  if (!path || path.includes(" ")) return null;
  return `https://github.com/${path}`;
}

export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^([\w-]+\.)+[a-z]{2,}(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export type LaunchScorePreviewInput = {
  name: string;
  description: string;
  image: string;
  website: string;
  twitter: string;
  telegram: string;
  github: string;
  archetype: string;
  capabilityTags: string[];
  services: LaunchProfileServiceInput[];
  hasAgentWallet: boolean;
  tokenImageUrl: string;
  tokenName: string;
  tokenSymbol: string;
};

export function previewLaunchAgentScore(input: LaunchScorePreviewInput): NativeAgentScoreBreakdown {
  const socialCount = [
    Boolean(input.website?.trim()),
    Boolean(input.twitter?.trim()),
    Boolean(input.telegram?.trim()),
    Boolean(input.github?.trim()),
  ].filter(Boolean).length;
  const capabilitiesCount =
    input.capabilityTags.length +
    input.services.filter((s) => s.name.trim() && s.endpoint.trim()).length +
    (input.archetype ? 1 : 0);
  return computeNativeAgentScore({
    name: input.name || null,
    description: input.description || null,
    image: input.image || input.tokenImageUrl || null,
    hasWebsite: Boolean(input.website?.trim()),
    hasTwitter: Boolean(input.twitter?.trim()),
    hasTelegram: Boolean(input.telegram?.trim()),
    hasGithub: Boolean(input.github?.trim()),
    agentMode: input.archetype || null,
    archetype: input.archetype || null,
    publicVerificationStatus: null,
    isVerified: false,
    arVerificationStatus: null,
    hasAgentWallet: input.hasAgentWallet,
    agentWalletPublicKey: input.hasAgentWallet ? "preview" : null,
    hasTokenLaunched: false,
    tokenMint: null,
    tokenName: input.tokenName || null,
    tokenSymbol: input.tokenSymbol || null,
    tokenImageUrl: input.tokenImageUrl || null,
    tokenHasMetadata: Boolean(input.tokenImageUrl?.trim() && input.tokenName?.trim()),
    tokenHasMarketLinks: socialCount >= 2,
    capabilitiesCount,
    mcpOffersCount: input.capabilityTags.includes("MCP") ? 1 : 0,
    x402Support: input.capabilityTags.includes("x402"),
    sapCapabilitiesCount: 0,
    hasRecentActivity: false,
    hasRecentLaunch: false,
    hasGithubConnection: Boolean(input.github?.trim()),
  });
}
