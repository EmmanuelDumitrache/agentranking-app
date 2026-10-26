import { resolveImageUrl } from "@/lib/image-utils";
import {
  buildIpfsGatewayUrl,
  buildIpfsGatewayUrlFallbacks,
} from "@/lib/robinhood-chain/ipfs-gateway";
export type RobinhoodImageSource = {
  tokenLogoGatewayUrl?: string | null;
  tokenLogoIpfsUri?: string | null;
  tokenImageOriginalUrl?: string | null;
  tokenImageUrl?: string | null;
  agentImage?: string | null;
  tokenName?: string | null;
  tokenSymbol?: string | null;
};
export type RobinhoodResolvedImage = {
  url: string | null;
  fallbackKind: "gateway" | "ipfs" | "original" | "stored" | "agent" | "initials" | "none";
};
function asHttpUrl(value: string): string | null {
  return resolveImageUrl(value) ?? (value.startsWith("http") ? value : null);
}
/** Stable Robinhood token image resolver — shared across launch, index, and detail surfaces. */
export function resolveRobinhoodTokenImage(source: RobinhoodImageSource): RobinhoodResolvedImage {
  const gateway = source.tokenLogoGatewayUrl?.trim();
  if (gateway) {
    const resolved = asHttpUrl(gateway);
    if (resolved) return { url: resolved, fallbackKind: "gateway" };
  }
  const fromIpfs = buildIpfsGatewayUrl(source.tokenLogoIpfsUri);
  if (fromIpfs) {
    const resolved = asHttpUrl(fromIpfs);
    if (resolved) return { url: resolved, fallbackKind: "ipfs" };
  }
  const original = source.tokenImageOriginalUrl?.trim();
  if (original) {
    const resolved = asHttpUrl(original);
    if (resolved) return { url: resolved, fallbackKind: "original" };
  }
  const stored = source.tokenImageUrl?.trim();
  if (stored) {
    const resolved = asHttpUrl(stored);
    if (resolved) return { url: resolved, fallbackKind: "stored" };
  }
  const agent = source.agentImage?.trim();
  if (agent) {
    const resolved = asHttpUrl(agent);
    if (resolved) return { url: resolved, fallbackKind: "agent" };
  }
  const label = source.tokenSymbol?.trim() || source.tokenName?.trim();
  if (label) {
    return { url: null, fallbackKind: "initials" };
  }
  return { url: null, fallbackKind: "none" };
}
export function robinhoodTokenImageUrl(source: RobinhoodImageSource): string | null {
  return resolveRobinhoodTokenImage(source).url;
}
export function robinhoodTokenInitials(source: RobinhoodImageSource): string {
  const raw = source.tokenSymbol?.trim() || source.tokenName?.trim() || "?";
  return raw.replace(/^\$/, "").slice(0, 3).toUpperCase();
}
/** Ordered HTTP URLs to try for a token image through the controlled gateway and source fallbacks. */
export function robinhoodTokenImageCandidates(source: RobinhoodImageSource): string[] {
  const urls: string[] = [];
  const push = (value?: string | null) => {
    if (!value?.trim()) return;
    const resolved = asHttpUrl(value.trim());
    if (resolved && !urls.includes(resolved)) urls.push(resolved);
  };
  push(source.tokenLogoGatewayUrl);
  for (const g of buildIpfsGatewayUrlFallbacks(source.tokenLogoIpfsUri)) push(g);
  push(source.tokenImageOriginalUrl);
  push(source.tokenImageUrl);
  push(source.agentImage);
  return urls;
}
