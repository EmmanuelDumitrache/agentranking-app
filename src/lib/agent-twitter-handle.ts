import { agentPublicUrl } from "@/lib/agent-public-url";
import { getPublicSiteUrl } from "@/lib/site-url";
/**
 * Resolve an X/Twitter @handle for verified-announcement tweets from
 * agent metadata and X/Twitter service endpoints.
 */
export type AgentSocialSlice = {
  chainId: number;
  agentId: number;
  metadata: { key: string; value: string }[];
  services: { name: string; endpoint: string }[];
};
function getMeta(metadata: AgentSocialSlice["metadata"], keys: string[]) {
  return metadata.find((m) => keys.includes(m.key))?.value?.trim() ?? "";
}
const X_PATH_SKIP = new Set([
  "intent",
  "status",
  "home",
  "search",
  "share",
  "i",
  "hashtag",
  "lists",
  "topics",
  "settings",
  "oauth",
  "login",
  "signup",
  "messages",
  "communities",
]);
/** X usernames are alphanumeric + underscore; metadata often uses hyphens in URLs. */
export function normalizeXUsername(raw: string): string | null {
  const bare = raw.replace(/^@+/, "").trim().toLowerCase().replace(/-/g, "_");
  if (!bare || bare.length < 1 || bare.length > 15) return null;
  if (X_PATH_SKIP.has(bare)) return null;
  if (!/^[a-z0-9_]+$/.test(bare)) return null;
  return bare;
}
function extractHandleFromTwitterUrl(url: string): string | null {
  const m = url.match(/(?:twitter\.com|x\.com)\/@?([^/?#]+)/i);
  if (!m?.[1]) return null;
  const seg = m[1].split("/")[0]?.replace(/^@+/, "").trim();
  if (!seg) return null;
  const normalized = normalizeXUsername(seg);
  return normalized ? `@${normalized}` : null;
}
/** Normalized @handle, or null if none (caller uses profile URL fallback). */
export function resolveAgentTwitterHandle(agent: AgentSocialSlice): string | null {
  const twitterMeta = getMeta(agent.metadata, ["twitter", "x"]);
  if (twitterMeta) {
    if (/^https?:\/\//i.test(twitterMeta)) {
      return extractHandleFromTwitterUrl(twitterMeta);
    }
    const normalized = normalizeXUsername(twitterMeta);
    if (normalized) return `@${normalized}`;
  }
  const twitterSvc = agent.services.find((s) => {
    const ep = s.endpoint?.toLowerCase() ?? "";
    return ep.includes("x.com") || ep.includes("twitter.com");
  });
  if (twitterSvc?.endpoint) {
    const ep = twitterSvc.endpoint.trim();
    const full = ep.startsWith("http") ? ep : `https://${ep}`;
    return extractHandleFromTwitterUrl(full);
  }
  return null;
}
export function agentProfilePath(agent: { chainId: number; agentId: number; name: string }) {
  return agentPublicUrl(getPublicSiteUrl(), agent);
}
export function buildVerifiedAnnouncementText(agent: AgentSocialSlice & { name: string }): string {
  const handle = resolveAgentTwitterHandle(agent);
  const linkLine = handle ?? agentProfilePath(agent);
  return [
    "Agent verified on AgentRanking.io",
    "",
    linkLine,
    "",
    "Discover, verify & rank on-chain AI agents.",
    "agentranking.io",
    "",
    "#BlockchainAI #AIAgents #Agent #AI",
  ].join("\n");
}
