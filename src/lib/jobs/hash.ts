import { hash } from "node:crypto";
/** Stable external id when partner omits one. */
export function stableExternalIdFromUrl(source: string, url: string): string {
  const digest = hash("sha256", `${source}:${url}`, "hex").slice(0, 24);
  return `url_${digest}`;
}
export function hashClientIp(ip: string): string {
  return hash("sha256", `jobs-event:${ip}`, "hex").slice(0, 32);
}
