import type { HatcherMetadata } from "@/lib/hatcher/types";
export type HatcherX402ReadinessStatus = "not_ready" | "eligible" | "live";
export type HatcherX402PaymentMode = "none" | "manual" | "x402" | "unknown";
export type HatcherX402Readiness = {
  status: HatcherX402ReadinessStatus;
  label: string;
  reasons: string[];
  missing: string[];
  capabilities: string[];
  paymentMode: HatcherX402PaymentMode;
  disclaimer: string;
  rows: {
    passport: boolean;
    mcpManifest: boolean;
    publicChat: boolean;
    publishedOffer: boolean;
    paymentSupport: boolean;
  };
};
export const HATCHER_X402_READINESS_DISCLAIMER =
  "x402 readiness reflects public Hatcher metadata and any owner-published offers on AgentRanking. It is not a paid listing or payment guarantee.";
function hasSnapshot(v: unknown): boolean {
  return v != null && typeof v === "object" && Object.keys(v as object).length > 0;
}
function hasX402ServiceEndpoint(
  services?: Array<{ endpoint?: string | null }>,
): boolean {
  if (!services?.length) return false;
  return services.some((s) => {
    const ep = s.endpoint?.trim().toLowerCase() ?? "";
    return ep.includes("x402") || ep.includes("402");
  });
}
/**
 * Profile-level x402 readiness for Hatcher agents — no fake offers or market listings.
 */
export function buildHatcherX402Readiness(input: {
  hatcher: HatcherMetadata | null;
  publishedOfferCount?: number;
  x402Support?: boolean;
  services?: Array<{ endpoint?: string | null }>;
}): HatcherX402Readiness {
  const snap = input.hatcher;
  const publishedOfferCount = input.publishedOfferCount ?? 0;
  const passport = hasSnapshot(snap?.passportSnapshot);
  const mcpManifest = hasSnapshot(snap?.mcpManifestSnapshot);
  const publicChat = snap?.publicChatEnabled === true;
  const profileLink = Boolean(snap?.links?.profile?.trim());
  const publishedOffer = publishedOfferCount > 0;
  const paymentSupport =
    input.x402Support === true || hasX402ServiceEndpoint(input.services);
  const x402Service = hasX402ServiceEndpoint(input.services);
  const capabilities: string[] = [];
  if (passport) capabilities.push("passport");
  if (mcpManifest) capabilities.push("mcp_manifest");
  if (publicChat) capabilities.push("public_chat");
  if (profileLink) capabilities.push("hatcher_profile");
  if (publishedOffer) capabilities.push("published_offer");
  if (paymentSupport) capabilities.push("payment_signal");
  const missing: string[] = [];
  if (!passport) missing.push("passport");
  if (!mcpManifest) missing.push("mcp_manifest");
  if (!publicChat && !profileLink) missing.push("public_surface");
  if (!publishedOffer) missing.push("published_offer");
  let paymentMode: HatcherX402PaymentMode = "none";
  if (publishedOffer) paymentMode = "manual";
  else if (input.x402Support === true && x402Service) paymentMode = "x402";
  else if (input.x402Support === true) paymentMode = "x402";
  else if (paymentSupport) paymentMode = "unknown";
  const reasons: string[] = [];
  let status: HatcherX402ReadinessStatus = "not_ready";
  let label = "Not ready";
  if (publishedOffer || (input.x402Support === true && x402Service)) {
    status = "live";
    label = "Live";
    if (publishedOffer) {
      reasons.push("Owner has published MCP offer(s) on AgentRanking.");
    }
    if (x402Service) {
      reasons.push("Indexed services include an x402-compatible endpoint.");
    }
  } else if ((publicChat || profileLink) && (passport || mcpManifest)) {
    status = "eligible";
    label = "Eligible";
    reasons.push("Public Hatcher profile/chat plus passport or MCP manifest indexed.");
    reasons.push("Ready for paid skill listing once owner opts in and publishes offers.");
  } else {
    reasons.push("Add passport, MCP manifest, or a public chat/profile link to improve readiness.");
  }
  return {
    status,
    label,
    reasons,
    missing,
    capabilities,
    paymentMode,
    disclaimer: HATCHER_X402_READINESS_DISCLAIMER,
    rows: {
      passport,
      mcpManifest,
      publicChat,
      publishedOffer,
      paymentSupport,
    },
  };
}
