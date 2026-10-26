export type McpReadiness = "mcp_ready" | "mcp_claimed" | "mcp_unknown" | "not_mcp";
export type OrbitMcpServiceLike = {
  name?: string | null;
  endpoint?: string | null;
};
export type OrbitMcpOfferLike = {
  title?: string | null;
  summary?: string | null;
  ctaUrl?: string | null;
  isPublished?: boolean | null;
  linkedService?: OrbitMcpServiceLike | null;
};
export type OrbitMcpOfficialLinkLike = {
  linkType?: string | null;
  url?: string | null;
  status?: string | null;
  lockedByVerifiedOwner?: boolean | null;
};
export type OrbitMcpPaidServiceLike = {
  serviceType?: string | null;
  endpointUrl?: string | null;
  isPublished?: boolean | null;
};
export type OrbitMcpSignalLike = {
  signalType?: string | null;
  status?: string | null;
  value?: string | null;
};
export type OrbitMcpReadinessInput = {
  name?: string | null;
  description?: string | null;
  agentURI?: string | null;
  services?: OrbitMcpServiceLike[];
  metadata?: Array<{ key?: string | null; value?: string | null }>;
  mcpOffers?: OrbitMcpOfferLike[];
  officialLinks?: OrbitMcpOfficialLinkLike[];
  paidServices?: OrbitMcpPaidServiceLike[];
  verificationSignals?: OrbitMcpSignalLike[];
  sapProtocols?: string[] | null;
};
export type OrbitMcpReadinessResult = {
  readiness: McpReadiness;
  endpoint: string | null;
  evidence: string[];
};
const MCP_SIGNAL_TYPES = new Set(["mcp_detected", "mcp_verified", "endpoint_live"]);
const READY_SIGNAL_STATUSES = new Set(["verified", "live", "detected"]);
const CLAIMED_SIGNAL_STATUSES = new Set(["submitted", "claimed", "unknown"]);
function isLikelyUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) return false;
  try {
    const url = new URL(trimmed);
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}
function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
function includesMcp(value: string | null | undefined): boolean {
  return /\bmcp\b|model context protocol/i.test(value ?? "");
}
function firstLikelyUrl(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (isLikelyUrl(value)) return value.trim();
  }
  return null;
}
function officialMcpEndpoint(input: OrbitMcpReadinessInput): string | null {
  const links = input.officialLinks ?? [];
  const candidates = links.filter((link) => normalized(link.linkType) === "mcp");
  return firstLikelyUrl(candidates.map((link) => link.url));
}
function serviceMcpEndpoint(input: OrbitMcpReadinessInput): string | null {
  const services = input.services ?? [];
  const candidates = services.filter((service) => includesMcp(service.name) || includesMcp(service.endpoint));
  return firstLikelyUrl(candidates.map((service) => service.endpoint));
}
function offerMcpEndpoint(input: OrbitMcpReadinessInput): string | null {
  const offers = (input.mcpOffers ?? []).filter((offer) => offer.isPublished !== false);
  const values: Array<string | null | undefined> = [];
  for (const offer of offers) {
    values.push(offer.linkedService?.endpoint, offer.ctaUrl);
  }
  return firstLikelyUrl(values);
}
function paidServiceMcpEndpoint(input: OrbitMcpReadinessInput): string | null {
  const services = (input.paidServices ?? []).filter((service) => service.isPublished !== false);
  const candidates = services.filter((service) => includesMcp(service.serviceType) || includesMcp(service.endpointUrl));
  return firstLikelyUrl(candidates.map((service) => service.endpointUrl));
}
function metadataClaimsMcp(input: OrbitMcpReadinessInput): boolean {
  return (input.metadata ?? []).some((item) => {
    const key = item.key ?? "";
    const value = item.value ?? "";
    return includesMcp(key) || includesMcp(value);
  });
}
function signalClaimsMcp(input: OrbitMcpReadinessInput): { ready: boolean; claimed: boolean } {
  let ready = false;
  let claimed = false;
  for (const signal of input.verificationSignals ?? []) {
    const type = normalized(signal.signalType);
    const status = normalized(signal.status);
    if (!MCP_SIGNAL_TYPES.has(type)) continue;
    if (READY_SIGNAL_STATUSES.has(status)) ready = true;
    if (CLAIMED_SIGNAL_STATUSES.has(status)) claimed = true;
  }
  return { ready, claimed };
}
function hasClearNonMcpStatement(input: OrbitMcpReadinessInput): boolean {
  const corpus = `${input.name ?? ""} ${input.description ?? ""} ${input.agentURI ?? ""}`.toLowerCase();
  return /\b(no|not|non)[-\s]?mcp\b/.test(corpus);
}
export function getOrbitMcpReadiness(input: OrbitMcpReadinessInput): OrbitMcpReadinessResult {
  const evidence: string[] = [];
  const endpoint =
    officialMcpEndpoint(input) ??
    serviceMcpEndpoint(input) ??
    offerMcpEndpoint(input) ??
    paidServiceMcpEndpoint(input);
  if (endpoint) {
    evidence.push("Confirmed MCP-like endpoint exists in services, official links, paid services, or MCP offers.");
    return { readiness: "mcp_ready", endpoint, evidence };
  }
  const signalState = signalClaimsMcp(input);
  if (signalState.ready) {
    evidence.push("MCP verification signal is present, but no endpoint URL is exposed.");
    return { readiness: "mcp_claimed", endpoint: null, evidence };
  }
  const serviceClaim = (input.services ?? []).some((service) => includesMcp(service.name));
  const offerClaim = (input.mcpOffers ?? []).some((offer) => offer.isPublished !== false);
  const protocolClaim = (input.sapProtocols ?? []).some((protocol) => includesMcp(protocol));
  const textClaim = includesMcp(input.name) || includesMcp(input.description) || metadataClaimsMcp(input);
  if (serviceClaim || offerClaim || protocolClaim || signalState.claimed || textClaim) {
    evidence.push("Agent claims MCP support, but the integration cannot confirm a usable endpoint.");
    return { readiness: "mcp_claimed", endpoint: null, evidence };
  }
  if (hasClearNonMcpStatement(input)) {
    evidence.push("Agent text explicitly indicates it is not MCP-capable.");
    return { readiness: "not_mcp", endpoint: null, evidence };
  }
  return { readiness: "mcp_unknown", endpoint: null, evidence };
}
