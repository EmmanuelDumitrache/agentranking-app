import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import { OutboundTargetRejectedError } from "@/lib/outbound-http";
import type { McpConnectionStatus } from "./types";

export const MCP_DOMAIN_ERROR_CODES = [
  "MCP_CONNECTION_NOT_FOUND",
  "MCP_CONNECTION_OWNERSHIP_MISMATCH",
  "MCP_CONNECTION_NOT_READY",
  "MCP_CONNECTION_REAUTH_REQUIRED",
  "MCP_CONNECTION_IN_USE",
  "MCP_ENDPOINT_BLOCKED",
  "MCP_AUTH_FAILED",
  "MCP_AUTH_REQUIRED",
  "MCP_PROTOCOL_UNSUPPORTED",
  "MCP_DISCOVERY_LIMIT_EXCEEDED",
  "MCP_CATALOG_CHANGED",
  "MCP_CATALOG_STALE",
  "MCP_TOOL_QUARANTINED",
  "MCP_POLICY_BLOCKED",
  "MCP_APPROVAL_REQUIRED",
  "MCP_RATE_LIMITED",
  "MCP_PROVIDER_UNAVAILABLE",
  "MCP_STALE_VERSION",
  "MCP_CONFIGURATION_INVALID",
  "MCP_CONTINUATION_CONTEXT_MISSING",
  "MCP_RUNTIME_META_UNAVAILABLE",
] as const;

export type McpDomainErrorCode = typeof MCP_DOMAIN_ERROR_CODES[number];
const MCP_DOMAIN_ERROR_CODE_SET = new Set<string>(MCP_DOMAIN_ERROR_CODES);

export class McpRuntimeError extends Error {
  constructor(
    readonly code: McpDomainErrorCode | string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "McpRuntimeError";
  }
}

export class McpConfigurationError extends McpRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super("MCP_CONFIGURATION_INVALID", message, options);
    this.name = "McpConfigurationError";
  }
}

export class McpAuthenticationRequiredError extends McpRuntimeError {
  constructor(message = "The MCP server requires authentication", options?: ErrorOptions) {
    super("MCP_AUTH_REQUIRED", message, options);
    this.name = "McpAuthenticationRequiredError";
  }
}

export class McpOAuthAuthorizationRequiredError extends McpAuthenticationRequiredError {
  constructor(
    readonly authorizationUrl: URL,
    readonly transportKind: "STREAMABLE_HTTP" | "LEGACY_SSE",
    options?: ErrorOptions,
  ) {
    super("MCP OAuth authorization is required", options);
    this.name = "McpOAuthAuthorizationRequiredError";
  }
}

export class McpUnavailableError extends McpRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super("MCP_PROVIDER_UNAVAILABLE", message, options);
    this.name = "McpUnavailableError";
  }
}

export class McpPolicyError extends McpRuntimeError {
  constructor(code: "MCP_POLICY_BLOCKED" | "MCP_TOOL_QUARANTINED" | "MCP_APPROVAL_REQUIRED", message: string) {
    super(code, message);
    this.name = "McpPolicyError";
  }
}

function hasOutboundTargetRejection(error: unknown, depth = 0): boolean {
  if (error instanceof OutboundTargetRejectedError) return true;
  if (depth >= 4 || !Error.isError(error)) return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause !== undefined
    && cause !== error
    && hasOutboundTargetRejection(cause, depth + 1);
}

export function mcpErrorCode(error: unknown): string {
  if (error instanceof McpRuntimeError && MCP_DOMAIN_ERROR_CODE_SET.has(error.code)) {
    return error.code;
  }
  if (hasOutboundTargetRejection(error)) return "MCP_ENDPOINT_BLOCKED";
  return "MCP_PROVIDER_UNAVAILABLE";
}

export function safeMcpErrorDetails(error: unknown): {
  name: string;
  message: string;
  code: string;
} {
  const code = mcpErrorCode(error);
  if (code === "MCP_ENDPOINT_BLOCKED" && hasOutboundTargetRejection(error)) {
    return {
      name: "McpEndpointPolicyError",
      message: "The MCP endpoint was blocked by outbound network policy",
      code,
    };
  }
  if (error instanceof McpRuntimeError && MCP_DOMAIN_ERROR_CODE_SET.has(error.code)) {
    const safe = safeErrorDetails(error);
    return {
      name: safe.name.slice(0, 80),
      message: safe.message.slice(0, 500),
      code,
    };
  }
  return {
    name: "McpProviderError",
    message: "The remote MCP provider request failed",
    code,
  };
}

export function looksLikeAuthenticationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(401|403|unauthori[sz]ed|authentication required|invalid[_ -]?(?:token|grant)|access token)\b/i.test(message);
}

export function isTerminalMcpAuthenticationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(invalid[_ -]?(?:grant|token)|expired[_ -]?token|revoked|reauth)\b/i.test(message);
}

export function isMcpCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause && cause !== error && isMcpCancellation(cause)) return true;
  }
  return false;
}

export function mcpConnectionStatusForError(error: unknown): McpConnectionStatus {
  const code = mcpErrorCode(error);
  if (["MCP_ENDPOINT_BLOCKED", "MCP_POLICY_BLOCKED"].includes(code)) return "BLOCKED";
  if (
    ["MCP_AUTH_FAILED", "MCP_AUTH_REQUIRED", "MCP_CONNECTION_REAUTH_REQUIRED"].includes(code)
    || error instanceof McpAuthenticationRequiredError
    || looksLikeAuthenticationFailure(error)
  ) {
    return "REAUTH_REQUIRED";
  }
  if (
    error instanceof McpConfigurationError
    || (error instanceof McpRuntimeError
      && ["MCP_PROTOCOL_UNSUPPORTED", "MCP_DISCOVERY_LIMIT_EXCEEDED"].includes(error.code))
  ) return "INVALID";
  return "DEGRADED";
}

export function mcpErrorHttpStatus(error: unknown): number {
  const code = mcpErrorCode(error);
  if (code === "MCP_CONNECTION_NOT_FOUND") return 404;
  if (code === "MCP_CONNECTION_OWNERSHIP_MISMATCH") return 403;
  if (code === "MCP_CONNECTION_IN_USE" || code === "MCP_STALE_VERSION" || code === "MCP_CATALOG_CHANGED") return 409;
  if (code === "MCP_CONTINUATION_CONTEXT_MISSING") return 409;
  if (code === "MCP_RATE_LIMITED") return 429;
  if (code === "MCP_AUTH_FAILED" || code === "MCP_AUTH_REQUIRED" || code === "MCP_CONNECTION_REAUTH_REQUIRED") return 401;
  if (code === "MCP_PROVIDER_UNAVAILABLE") return 502;
  return 400;
}
