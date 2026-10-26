/**
 * Builds the ERC-8004 registration JSON and encodes it as a data URI.
 * The contract stores this as the tokenURI via `register(string agentURI)`.
 */
export interface AgentServiceRegistration {
  name: string;
  endpoint: string;
  version?: string;
  mcpTools?: string[];
  mcpPrompts?: string[];
  mcpResources?: string[];
  a2aSkills?: string[];
  skills?: string[];
  domains?: string[];
}
export interface AgentRegistrationParams {
  name: string;
  description: string;
  image?: string;
  services: AgentServiceRegistration[];
  /** Optional NFT-style discovery URL (ignored when unset). */
  external_url?: string;
  active?: boolean;
  x402Support?: boolean;
  supportedTrust?: string[];
}
function parseCommaList(value: string | undefined): string[] | undefined {
  const items = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}
export function buildRegistrationJson(params: AgentRegistrationParams) {
  const supportedTrust =
    params.supportedTrust && params.supportedTrust.length > 0
      ? params.supportedTrust
      : ["reputation"];
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: params.name,
    description: params.description,
    image: params.image || "",
    active: params.active ?? true,
    x402Support: params.x402Support ?? false,
    supportedTrust,
    services: params.services.map((service) => {
      const entry: Record<string, unknown> = {
        name: service.name.toLowerCase(),
        endpoint: service.endpoint,
        version: service.version ?? "1.0",
      };
      if (service.mcpTools?.length) entry.mcpTools = service.mcpTools;
      if (service.mcpPrompts?.length) entry.mcpPrompts = service.mcpPrompts;
      if (service.mcpResources?.length) entry.mcpResources = service.mcpResources;
      if (service.a2aSkills?.length) entry.a2aSkills = service.a2aSkills;
      if (service.skills?.length) entry.skills = service.skills;
      if (service.domains?.length) entry.domains = service.domains;
      return entry;
    }),
    registrations: [],
    updatedAt: Math.floor(Date.now() / 1000),
    ...(params.external_url ? { external_url: params.external_url } : {}),
  };
}
/**
 * Builds a `data:application/json;base64,...` URI from registration params.
 * This is stored on-chain as the agentURI / tokenURI.
 */
export function buildAgentDataUri(params: AgentRegistrationParams): string {
  const json = buildRegistrationJson(params);
  const jsonStr = JSON.stringify(json);
  const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
  return `data:application/json;base64,${base64}`;
}
/** Comma-separated input → trimmed string array (launch wizard helpers). */
export { parseCommaList };