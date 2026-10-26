import type { Prisma } from "@/generated/prisma/client";
const VALID_SOCIAL = new Set(["twitter", "discord", "telegram", "website", "email", "github"]);
/** Comma list for ?socials= — agents must satisfy every selected platform (AND). */
export const ALL_SOCIAL_PLATFORMS_CSV = "twitter,discord,telegram,website,email,github";
export const SOCIAL_FILTER_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "twitter", label: "X / Twitter" },
  { id: "discord", label: "Discord" },
  { id: "telegram", label: "Telegram" },
  { id: "website", label: "Website" },
  { id: "email", label: "Email" },
  { id: "github", label: "GitHub" },
];
export function parseSocialsQueryParam(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => VALID_SOCIAL.has(s));
}
/** Non-empty metadata value (trimmed). */
function metaValuePresent(): Prisma.StringFilter {
  return { not: "" };
}
/**
 * One platform = agent has that link (metadata and/or services), aligned with `resolveSocialUrls` in agent detail.
 * Multiple platforms in the URL are combined with AND elsewhere.
 */
export function agentWhereHasSocialPlatform(platform: string): Prisma.AgentWhereInput | null {
  switch (platform) {
    case "twitter":
      return {
        OR: [
          { metadata: { some: { key: "twitter", value: metaValuePresent() } } },
          { metadata: { some: { key: "x", value: metaValuePresent() } } },
          { services: { some: { endpoint: { contains: "twitter.com", mode: "insensitive" } } } },
          { services: { some: { endpoint: { contains: "x.com", mode: "insensitive" } } } },
        ],
      };
    case "discord":
      return {
        OR: [
          { metadata: { some: { key: "discord", value: metaValuePresent() } } },
          { services: { some: { name: "DISCORD", endpoint: metaValuePresent() } } },
        ],
      };
    case "telegram":
      return {
        OR: [
          { metadata: { some: { key: "telegram", value: metaValuePresent() } } },
          { services: { some: { name: "TELEGRAM", endpoint: metaValuePresent() } } },
        ],
      };
    case "website":
      return {
        OR: [
          { metadata: { some: { key: "website", value: metaValuePresent() } } },
          { metadata: { some: { key: "uri", value: metaValuePresent() } } },
          { services: { some: { name: "WEB", endpoint: metaValuePresent() } } },
        ],
      };
    case "email":
      return {
        OR: [
          { metadata: { some: { key: "email", value: metaValuePresent() } } },
          { services: { some: { name: "EMAIL", endpoint: metaValuePresent() } } },
        ],
      };
    case "github":
      return {
        OR: [
          { metadata: { some: { key: "github", value: metaValuePresent() } } },
          { services: { some: { endpoint: { contains: "github.com", mode: "insensitive" } } } },
        ],
      };
    default:
      return null;
  }
}
/** Mutates `where` to AND each platform clause (agent must have every selected social). */
export function applySocialsAndToWhere(
  where: Prisma.AgentWhereInput & { AND?: Prisma.AgentWhereInput[] },
  platforms: string[]
): void {
  const clauses = platforms
    .map((p) => agentWhereHasSocialPlatform(p))
    .filter((c): c is Prisma.AgentWhereInput => c != null);
  if (clauses.length === 0) return;
  const prev = where.AND;
  const base = Array.isArray(prev) ? [...prev] : prev ? [prev] : [];
  where.AND = [...base, ...clauses];
}