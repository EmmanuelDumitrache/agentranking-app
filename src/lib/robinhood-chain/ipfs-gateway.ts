import { browserIpfsGatewayUrl, extractIpfsPath } from "@/lib/ipfs/uri";
/** Client-safe URL builder using only the configured AgentRanking Kubo gateway. */
export function buildIpfsGatewayUrl(cidOrUri: string | null | undefined): string | null {
  if (!cidOrUri?.trim()) return null;
  const trimmed = cidOrUri.trim();
  if (extractIpfsPath(trimmed)) return browserIpfsGatewayUrl(trimmed);
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return null;
}
/** Resolve the single authoritative self-hosted gateway. */
export function buildIpfsGatewayUrlFallbacks(cidOrUri: string | null | undefined): string[] {
  const url = buildIpfsGatewayUrl(cidOrUri);
  return url ? [url] : [];
}
