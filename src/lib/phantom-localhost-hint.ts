import { isLocalAppDevHost } from "@/lib/product-host";
import {
  appendDraftIdToDevUrl,
  readStoredAgentLaunchDraftId,
} from "@/lib/agent-launch/draft-session";
/** Convert a non-loopback local development URL to the canonical localhost origin. */
export function phantomFriendlyLocalUrl(): string | null {
  if (typeof globalThis.window === "undefined") return null;
  const { host, pathname, search, port, protocol } = globalThis.window.location;
  const hostname = host.split(":")[0]?.toLowerCase() ?? host;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    return null;
  }
  if (!isLocalAppDevHost(host)) return null;
  const devPort = port && port !== "80" && port !== "443" ? port : "3000";
  const base = `${protocol}//localhost:${devPort}${pathname}${search}`;
  return appendDraftIdToDevUrl(base, readStoredAgentLaunchDraftId());
}
export function phantomUnfriendlyHostLabel(): string | null {
  if (typeof globalThis.window === "undefined") return null;
  const host = globalThis.window.location.host;
  return isLocalAppDevHost(host) ? host : null;
}
export function phantomLocalConnectBlockedMessage(): string | null {
  const url = phantomFriendlyLocalUrl();
  if (!url) return null;
  return `Phantom cannot connect on ${phantomUnfriendlyHostLabel()}. Use plain localhost for Solana wallets in local dev — open ${url}.`;
}