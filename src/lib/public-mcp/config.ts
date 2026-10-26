/** Hosted public MCP connector (directory / trust tools). Not the agent-chat MCP client runtime. */
export const PUBLIC_MCP_SERVER_NAME = "agentranking";
export const PUBLIC_MCP_SERVER_VERSION = "1.2.0";
export const PUBLIC_MCP_PATH = "/api/mcp";
export const PUBLIC_MCP_PAGE_PATH = "/mcp";
export const PUBLIC_MCP_WELL_KNOWN_PATH = "/.well-known/mcp.json";
export const PUBLIC_MCP_PROTOCOL_VERSION = "2025-03-26";
export const PUBLIC_MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
] as const;
export const PUBLIC_MCP_MAX_SEARCH = 20;
export const PUBLIC_MCP_DEFAULT_SEARCH = 10;
export const PUBLIC_MCP_MAX_TRUST_WALLETS = 20;
/** Canonical public connector. Production copy/discovery never use localhost. */
export const PUBLIC_MCP_CANONICAL_ORIGIN = "https://agentranking.io";
function isLocalMcpOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  } catch {
    return true;
  }
}
/**
 * Origin shown to Claude/Cursor and in /.well-known/mcp.json.
 * `npm run dev*` may advertise localhost so the local server can be tested.
 * Production always advertises agentranking.io, even if env still has localhost.
 */
export function resolvePublicMcpAdvertisedOrigin(
  runtimeOrigin: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const trimmed = runtimeOrigin.replace(/\/$/, "").trim();
  if (nodeEnv === "development" && trimmed && isLocalMcpOrigin(trimmed)) {
    return trimmed;
  }
  return PUBLIC_MCP_CANONICAL_ORIGIN;
}
export function publicMcpAdvertisedOrigin(runtimeOrigin: string): string {
  return resolvePublicMcpAdvertisedOrigin(runtimeOrigin);
}
export function publicMcpEndpointUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}${PUBLIC_MCP_PATH}`;
}
export function publicMcpPageUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}${PUBLIC_MCP_PAGE_PATH}`;
}
export function publicMcpWellKnownUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}${PUBLIC_MCP_WELL_KNOWN_PATH}`;
}
export const PUBLIC_MCP_INSTRUCTIONS =
  "AgentRanking public registry. Search ranked on-chain agents, fetch profiles, trust scores, FairScale assessments, and public AR credentials. No API key. Tools are read-only; they do not move funds or launch tokens.";
