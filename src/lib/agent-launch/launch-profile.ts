import type { AgentLaunch } from "@/generated/prisma/client";
import type { AgentPassport } from "@/lib/agent-launch/passport";
import { agentLaunchDisplayName } from "@/lib/agent-launch/passport";
export const LAUNCH_LIFECYCLE_STATUSES = [
  "draft",
  "token_created",
  "bonding",
  "migrated",
  "complete",
  "unknown",
] as const;
export type LaunchLifecycleStatus = (typeof LAUNCH_LIFECYCLE_STATUSES)[number];
export const LAUNCH_MARKET_SOURCES = [
  "unavailable",
  "local-events",
  "pump",
  "dex",
] as const;
export type LaunchMarketSource = (typeof LAUNCH_MARKET_SOURCES)[number];
export type LaunchDisplayProfile = {
  displayName: string;
  shortDescription: string | null;
  longDescription: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  github: string | null;
  tags: string[];
};
export type LaunchProfileEditableFields = {
  profileDisplayName?: string | null;
  profileShortDescription?: string | null;
  profileLongDescription?: string | null;
  profileAvatarUrl?: string | null;
  profileBannerUrl?: string | null;
  profileWebsite?: string | null;
  profileTwitter?: string | null;
  profileTelegram?: string | null;
  profileGithub?: string | null;
  profileTags?: string[];
};
export type LaunchProfileSource = Pick<
  AgentLaunch,
  | "agentId"
  | "tokenName"
  | "tokenSymbol"
  | "tokenDescription"
  | "tokenImageUrl"
  | "profileDisplayName"
  | "profileShortDescription"
  | "profileLongDescription"
  | "profileAvatarUrl"
  | "profileBannerUrl"
  | "profileWebsite"
  | "profileTwitter"
  | "profileTelegram"
  | "profileGithub"
  | "profileTags"
  | "launchKind"
>;
export function isAgentRankingLaunch(
  launch: Pick<AgentLaunch, "launchKind"> | null | undefined,
): boolean {
  return launch?.launchKind === "agentranking";
}
export function isLaunchLifecycleStatus(value: string): value is LaunchLifecycleStatus {
  return (LAUNCH_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}
export function lifecycleStatusLabel(status: LaunchLifecycleStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "token_created":
      return "Token created";
    case "bonding":
      return "Bonding";
    case "migrated":
      return "Migrated";
    case "complete":
      return "Complete";
    case "unknown":
      return "Unknown";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
export function resolveLaunchDisplayProfile(launch: LaunchProfileSource): LaunchDisplayProfile {
  const fallbackName = agentLaunchDisplayName(launch);
  return {
    displayName: launch.profileDisplayName?.trim() || launch.tokenName?.trim() || fallbackName,
    shortDescription:
      launch.profileShortDescription?.trim() ||
      launch.tokenDescription?.trim()?.slice(0, 280) ||
      null,
    longDescription:
      launch.profileLongDescription?.trim() || launch.tokenDescription?.trim() || null,
    avatarUrl: launch.profileAvatarUrl?.trim() || launch.tokenImageUrl?.trim() || null,
    bannerUrl: launch.profileBannerUrl?.trim() || null,
    website: launch.profileWebsite?.trim() || null,
    twitter: launch.profileTwitter?.trim() || null,
    telegram: launch.profileTelegram?.trim() || null,
    github: launch.profileGithub?.trim() || null,
    tags: launch.profileTags?.length ? [...launch.profileTags] : [],
  };
}
export function countPassportCapabilities(passport: AgentPassport | null | undefined): number {
  if (!passport) return 0;
  const { capabilities } = passport;
  return [
    capabilities.mcp.ready,
    capabilities.api.ready,
    capabilities.x402.ready,
    capabilities.github.ready,
  ].filter(Boolean).length;
}
export function passportCapabilityBadges(
  passport: AgentPassport | null | undefined,
): string[] {
  if (!passport) return [];
  const badges: string[] = [];
  if (passport.capabilities.api.ready) badges.push("API");
  if (passport.capabilities.mcp.ready) badges.push("MCP");
  if (passport.capabilities.x402.ready) badges.push("x402");
  if (passport.capabilities.github.ready) badges.push("GitHub");
  return badges;
}
export function normalizeProfileTagsInput(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 24);
}
export function sanitizeLaunchProfilePatch(
  body: Record<string, unknown>,
): LaunchProfileEditableFields {
  const patch: LaunchProfileEditableFields = {};
  const stringFields = [
    "profileDisplayName",
    "profileShortDescription",
    "profileLongDescription",
    "profileAvatarUrl",
    "profileBannerUrl",
    "profileWebsite",
    "profileTwitter",
    "profileTelegram",
    "profileGithub",
  ] as const;
  for (const key of stringFields) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null) {
      patch[key] = null;
      continue;
    }
    if (typeof value === "string") {
      patch[key] = value.trim().slice(0, key.includes("Description") ? 4000 : 512) || null;
    }
  }
  if ("profileTags" in body) {
    patch.profileTags = normalizeProfileTagsInput(body.profileTags);
  }
  return patch;
}
export function formatLamportsCompact(lamports: string | bigint): string {
  return formatLamportsDisplay(lamports).primary;
}
export type LamportsDisplay = {
  primary: string;
  secondary: string;
};
/** Primary SOL display with lamports secondary — does not alter stored values. */
export function formatLamportsDisplay(lamports: string | bigint): LamportsDisplay {
  try {
    const value = typeof lamports === "bigint" ? lamports : BigInt(lamports || "0");
    if (value === BigInt(0)) {
      return { primary: "0 SOL", secondary: "0 lamports" };
    }
    const sol = Number(value) / 1_000_000_000;
    const primary =
      sol >= 0.000000001
        ? `${sol.toFixed(9).replace(/\.?0+$/, "")} SOL`
        : `${value.toLocaleString()} lamports`;
    return {
      primary,
      secondary: `${value.toLocaleString()} lamports`,
    };
  } catch {
    const raw = String(lamports);
    return { primary: raw, secondary: raw };
  }
}
export function launchStatusProductLabel(status: string): string {
  switch (status) {
    case "indexed":
      return "Indexed";
    case "draft":
      return "Draft";
    case "token_created":
      return "Token created";
    case "fee_share_pending":
      return "Fee share pending";
    default:
      return status.replaceAll("_", " ");
  }
}
export function marketSourceLabel(source: string): string {
  switch (source) {
    case "local-events":
      return "Local events";
    case "pump":
      return "Pump";
    case "dex":
      return "DEX";
    case "unavailable":
      return "Unavailable";
    default:
      return source;
  }
}
export const LAUNCH_AVATAR_FALLBACK = "/ar-mark.png";
export function resolveLaunchAvatarUrl(
  profile: LaunchDisplayProfile,
  tokenImageUrl?: string | null,
): string {
  return (
    profile.avatarUrl?.trim() ||
    tokenImageUrl?.trim() ||
    LAUNCH_AVATAR_FALLBACK
  );
}
