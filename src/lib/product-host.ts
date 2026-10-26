const PUBLIC_SITE_HOSTS = new Set(["agentranking.io", "www.agentranking.io"]);
function hostWithoutPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "::1") return trimmed;
  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    return trimmed.slice(1, trimmed.indexOf("]"));
  }
  const portStart = trimmed.lastIndexOf(":");
  if (portStart <= 0) return trimmed;
  return /^\d+$/.test(trimmed.slice(portStart + 1)) ? trimmed.slice(0, portStart) : trimmed;
}
function isLocalNetworkHostname(hostname: string): boolean {
  const h = hostWithoutPort(hostname);
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return false;
  const octets = h.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isFinite(n) || n > 255)) return false;
  const [a, b] = octets;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
/** Local app host used by development-only feature gates. */
export function isLocalAppDevHost(host: string): boolean {
  return isLocalNetworkHostname(host);
}
/** Public-site host (agentranking.io). Local development uses the single localhost origin. */
export function isPublicSiteHost(host: string): boolean {
  return PUBLIC_SITE_HOSTS.has(hostWithoutPort(host));
}
/** App product host (app.agentranking.io, localhost, or a private-LAN development address). */
export function isAppProductHost(host: string): boolean {
  if (isPublicSiteHost(host)) return false;
  const h = hostWithoutPort(host);
  return h === "app.agentranking.io" || h === "beta.agentranking.io" || isLocalNetworkHostname(h);
}
