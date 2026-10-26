export const OFFICIAL_LINK_TYPES = [
  "website",
  "x",
  "github",
  "telegram",
  "discord",
  "docs",
  "api",
  "mcp",
  "a2a",
  "x402",
] as const;
export type OfficialLinkType = (typeof OFFICIAL_LINK_TYPES)[number];
export type OfficialLinkDefinition = {
  linkType: OfficialLinkType;
  label: string;
  placeholder: string;
  hint?: string;
};
/** Primary social + profile links shown in agent management. */
export const DASHBOARD_SOCIAL_LINK_DEFINITIONS: OfficialLinkDefinition[] = [
  { linkType: "website", label: "Website", placeholder: "https://youragent.com" },
  { linkType: "x", label: "X / Twitter", placeholder: "https://x.com/handle or @handle" },
  { linkType: "github", label: "GitHub", placeholder: "https://github.com/org/repo" },
  { linkType: "telegram", label: "Telegram", placeholder: "https://t.me/channel or @handle" },
  { linkType: "discord", label: "Discord", placeholder: "https://discord.gg/invite" },
];
export function isOfficialLinkType(value: string): value is OfficialLinkType {
  return (OFFICIAL_LINK_TYPES as readonly string[]).includes(value);
}
/** Metadata keys synced when a link type is saved or removed. */
export function metadataKeysForLinkType(linkType: OfficialLinkType): string[] {
  if (linkType === "x") return ["x", "twitter"];
  return [linkType];
}
export type OfficialLinkMetadataRow = { key: string; value: string };
export type OfficialLinkServiceRow = { name: string; endpoint: string };
function metaValue(metadata: OfficialLinkMetadataRow[], keys: string[]): string {
  for (const key of keys) {
    const row = metadata.find((m) => m.key === key);
    const value = row?.value?.trim();
    if (value) return value;
  }
  return "";
}
function serviceEndpoint(services: OfficialLinkServiceRow[], serviceName: string): string {
  const row = services.find((s) => s.name.toUpperCase() === serviceName.toUpperCase());
  return row?.endpoint?.trim() ?? "";
}
function serviceEndpointMatching(
  services: OfficialLinkServiceRow[],
  predicate: (endpoint: string) => boolean,
): string {
  for (const service of services) {
    const endpoint = service.endpoint?.trim();
    if (endpoint && predicate(endpoint.toLowerCase())) return endpoint;
  }
  return "";
}
/**
 * Resolve a link URL from agent metadata and registered services (on-chain / indexed data).
 * Used to pre-fill the dashboard editor when AgentOfficialLink rows are missing.
 */
export function resolveOfficialLinkUrl(
  linkType: OfficialLinkType,
  metadata: OfficialLinkMetadataRow[],
  services: OfficialLinkServiceRow[],
): string {
  switch (linkType) {
    case "website":
      return metaValue(metadata, ["website", "uri", "url"]) || serviceEndpoint(services, "WEB");
    case "x":
      return (
        metaValue(metadata, ["x", "twitter"]) ||
        serviceEndpointMatching(
          services,
          (ep) => ep.includes("x.com") || ep.includes("twitter.com"),
        )
      );
    case "github":
      return (
        metaValue(metadata, ["github"]) ||
        serviceEndpointMatching(services, (ep) => ep.includes("github.com"))
      );
    case "telegram":
      return metaValue(metadata, ["telegram"]) || serviceEndpoint(services, "TELEGRAM");
    case "discord":
      return metaValue(metadata, ["discord"]) || serviceEndpoint(services, "DISCORD");
    case "docs":
      return metaValue(metadata, ["docs"]);
    case "api":
      return metaValue(metadata, ["api"]) || serviceEndpoint(services, "API");
    case "mcp":
      return metaValue(metadata, ["mcp"]) || serviceEndpoint(services, "MCP");
    case "a2a":
      return metaValue(metadata, ["a2a"]) || serviceEndpoint(services, "A2A");
    case "x402":
      return metaValue(metadata, ["x402"]) || serviceEndpoint(services, "X402");
    default: {
      const _exhaustive: never = linkType;
      return _exhaustive;
    }
  }
}
export type ResolvedOfficialLink = {
  linkType: OfficialLinkType;
  url: string;
  lockedByVerifiedOwner: boolean;
};
/** Merge saved official links with metadata/service fallbacks for dashboard display. */
export function mergeOfficialLinksForEditor(
  saved: Array<{ linkType: string; url: string; lockedByVerifiedOwner?: boolean }>,
  metadata: OfficialLinkMetadataRow[],
  services: OfficialLinkServiceRow[],
): ResolvedOfficialLink[] {
  const savedByType = new Map(saved.map((row) => [row.linkType, row]));
  return OFFICIAL_LINK_TYPES.flatMap((linkType) => {
    const row = savedByType.get(linkType);
    const url = (row?.url?.trim() || resolveOfficialLinkUrl(linkType, metadata, services)).trim();
    if (!url) return [];
    return [
      {
        linkType,
        url,
        lockedByVerifiedOwner: row?.lockedByVerifiedOwner ?? false,
      },
    ];
  });
}
export function officialLinksRecordFromResolved(
  resolved: ResolvedOfficialLink[],
): Record<OfficialLinkType, string> {
  const next = emptyOfficialLinksRecord();
  for (const row of resolved) {
    next[row.linkType] = row.url;
  }
  return next;
}
export function emptyOfficialLinksRecord(): Record<OfficialLinkType, string> {
  return {
    website: "",
    x: "",
    github: "",
    telegram: "",
    discord: "",
    docs: "",
    api: "",
    mcp: "",
    a2a: "",
    x402: "",
  };
}
/** Pre-fill editor fields from saved links, metadata, and registered services. */
export function seedOfficialLinksForEditor(
  metadata: OfficialLinkMetadataRow[],
  services: OfficialLinkServiceRow[],
  saved: Array<{ linkType: string; url: string; lockedByVerifiedOwner?: boolean }> = [],
): Record<OfficialLinkType, string> {
  return officialLinksRecordFromResolved(
    mergeOfficialLinksForEditor(saved, metadata, services),
  );
}
/** Link types whose current value came from metadata/services only (not AgentOfficialLink). */
export function detectedOfficialLinkTypes(
  metadata: OfficialLinkMetadataRow[],
  services: OfficialLinkServiceRow[],
  saved: Array<{ linkType: string; url: string }>,
): Set<OfficialLinkType> {
  const savedTypes = new Set(
    saved.map((row) => row.linkType).filter(isOfficialLinkType),
  );
  const seeded = seedOfficialLinksForEditor(metadata, services, []);
  const detected = new Set<OfficialLinkType>();
  for (const def of DASHBOARD_SOCIAL_LINK_DEFINITIONS) {
    if (!seeded[def.linkType].trim()) continue;
    if (!savedTypes.has(def.linkType)) detected.add(def.linkType);
  }
  return detected;
}
