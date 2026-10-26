import { resolveHatcherApiBaseUrl } from "@/lib/hatcher/config";
export const HATCHER_SITE_HOST = "https://hatcher.host";
export type HatcherLinks = {
  profile: string;
  chat: string;
  room: string;
  status: string;
  passport: string;
  mcpManifest: string;
  publicStats: string;
};
/** Canonical public id for Hatcher URLs: slug || id */
export function hatcherPublicId(agent: { slug?: string | null; id: string }): string {
  const slug = agent.slug?.trim();
  if (slug) return slug;
  return agent.id.trim();
}
export function buildHatcherLinks(publicId: string, hatcherId: string): HatcherLinks {
  const pid = encodeURIComponent(publicId);
  const hid = encodeURIComponent(hatcherId);
  const api = resolveHatcherApiBaseUrl();
  return {
    profile: `${HATCHER_SITE_HOST}/agent/${pid}`,
    chat: `${HATCHER_SITE_HOST}/agent/${pid}?chat=1`,
    room: `${HATCHER_SITE_HOST}/agent/${pid}/room`,
    status: `${HATCHER_SITE_HOST}/agent/${pid}/status`,
    passport: `${api}/agents/${pid}/passport.json`,
    mcpManifest: `${api}/agents/${pid}/mcp/manifest.json`,
    publicStats: `${api}/agents/${hid}/public-stats`,
  };
}
/** Truncate wallet for display/storage (Hatcher returns truncated; cap defensively). */
export function hatcherTruncateWallet(wallet: string | null | undefined, maxLen = 12): string | undefined {
  const w = wallet?.trim();
  if (!w) return undefined;
  if (w.length <= maxLen) return w;
  return `${w.slice(0, maxLen)}…`;
}
