import "server-only";

import { createHash } from "node:crypto";
import { validatePublicHttpUrl } from "@/lib/outbound-http";
import { McpConfigurationError, McpRuntimeError } from "./errors";
import type { McpProviderManifest } from "./provider-registry";

const RFC_TOKEN = /^[!#$%&'*+-.^_`|~0-9A-Za-z]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const DENIED_EXACT_HEADERS = new Set([
  "authorization",
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "proxy-authenticate",
  "forwarded",
  "x-real-ip",
  "origin",
  "referer",
  "traceparent",
  "tracestate",
  "baggage",
  "via",
  "cf-connecting-ip",
  "x-vercel-id",
  "x-vercel-proxied-for",
  "x-internal-auth",
  "x-agent-account-id",
  "x-agent-id",
]);
const DENIED_HEADER_PREFIXES = [
  "x-forwarded-",
  "proxy-",
  "sec-",
  "access-control-",
  "x-amz-",
  "x-goog-",
  "x-internal-",
  "x-agentranking-",
];

export type NormalizedMcpEndpoint = {
  url: string;
  origin: string;
  host: string;
  fingerprint: string;
};

export type ValidatedMcpOAuthAuthorizationUrl = {
  url: string;
  origin: string;
};

export function validatePublicMcpOAuthUrl(params: {
  url: string | URL;
  label: string;
}): ValidatedMcpOAuthAuthorizationUrl {
  let parsed: URL;
  try {
    parsed = new URL(params.url);
  } catch {
    throw new McpRuntimeError("MCP_ENDPOINT_BLOCKED", `${params.label} URL is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new McpRuntimeError(
      "MCP_ENDPOINT_BLOCKED",
      `${params.label} URL must be public HTTPS without user information or a fragment`,
    );
  }
  const checked = validatePublicHttpUrl(parsed.toString(), {
    allowHttp: false,
    allowLocalhost: false,
  });
  if (!checked.ok) {
    throw new McpRuntimeError(
      "MCP_ENDPOINT_BLOCKED",
      `${params.label} URL is not a permitted public target`,
    );
  }
  return { url: checked.url.toString(), origin: checked.url.origin };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isDeniedCustomMcpHeaderName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return DENIED_EXACT_HEADERS.has(normalized)
    || DENIED_HEADER_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function validateCustomMcpHeaderName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 128 || !RFC_TOKEN.test(normalized) || CONTROL.test(normalized)) {
    throw new McpConfigurationError("Custom API-key header name is invalid");
  }
  if (isDeniedCustomMcpHeaderName(normalized)) {
    throw new McpConfigurationError("Custom API-key header is not permitted");
  }
  return normalized;
}

export function validateMcpCredentialText(value: string, label: string, maxLength = 32_768): string {
  const normalized = value.trim();
  if (!normalized) throw new McpConfigurationError(`${label} is required`);
  if (normalized.length > maxLength || CONTROL.test(normalized)) {
    throw new McpConfigurationError(`${label} contains invalid characters or is too long`);
  }
  return normalized;
}

export function validateMcpCredentialPrefix(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (value.length > 128 || CONTROL.test(value)) {
    throw new McpConfigurationError("API-key prefix contains invalid characters or is too long");
  }
  return value;
}

function hostMatchesSuffix(host: string, suffix: string): boolean {
  const normalized = suffix.trim().toLowerCase().replace(/^\.+/, "");
  return Boolean(normalized) && (host === normalized || host.endsWith(`.${normalized}`));
}

export function normalizeMcpEndpoint(params: {
  endpoint: string;
  manifest?: McpProviderManifest | null;
}): NormalizedMcpEndpoint {
  const raw = params.endpoint.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new McpRuntimeError("MCP_ENDPOINT_BLOCKED", "MCP endpoint is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new McpRuntimeError("MCP_ENDPOINT_BLOCKED", "MCP endpoints must use HTTPS");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new McpRuntimeError(
      "MCP_ENDPOINT_BLOCKED",
      "MCP endpoints cannot contain user information or fragments",
    );
  }
  if (parsed.search) {
    throw new McpRuntimeError(
      "MCP_ENDPOINT_BLOCKED",
      "MCP endpoints cannot contain query parameters; configure authentication separately",
    );
  }
  const checked = validatePublicHttpUrl(parsed.toString(), {
    allowHttp: false,
    allowLocalhost: false,
  });
  if (!checked.ok) {
    throw new McpRuntimeError("MCP_ENDPOINT_BLOCKED", "MCP endpoint is not a permitted public target");
  }
  parsed = checked.url;
  const manifest = params.manifest;
  if (manifest?.endpoint.kind === "fixed") {
    const reviewedEndpoints = [
      manifest.endpoint,
      ...(manifest.endpointVariants ?? []).map((variant) => variant.endpoint),
    ];
    const matchesReviewedEndpoint = reviewedEndpoints.some((candidate) => {
      const fixed = new URL(candidate.url);
      return parsed.toString() === fixed.toString()
        && candidate.allowedOrigins.includes(parsed.origin);
    });
    if (!matchesReviewedEndpoint) {
      throw new McpRuntimeError("MCP_ENDPOINT_BLOCKED", "MCP endpoint does not match the reviewed provider endpoint");
    }
  } else if (manifest?.endpoint.kind === "template") {
    if (!manifest.endpoint.allowedHostSuffixes.some((suffix) => hostMatchesSuffix(parsed.hostname, suffix))) {
      throw new McpRuntimeError("MCP_ENDPOINT_BLOCKED", "MCP endpoint host is outside the provider allowlist");
    }
  } else if (
    manifest?.endpoint.kind === "user-supplied"
    && manifest.endpoint.allowedHostSuffixes?.length
    && !manifest.endpoint.allowedHostSuffixes.some((suffix) => hostMatchesSuffix(parsed.hostname, suffix))
  ) {
    throw new McpRuntimeError("MCP_ENDPOINT_BLOCKED", "MCP endpoint host is outside the provider allowlist");
  }
  return {
    url: parsed.toString(),
    origin: parsed.origin,
    host: parsed.hostname.toLowerCase(),
    fingerprint: sha256(parsed.toString()),
  };
}

/**
 * Authorization endpoints are not MCP resource endpoints: OAuth necessarily
 * carries query parameters. Keep the SSRF protections, but allow the query and
 * bind curated providers to the origin of their reviewed authorization issuer.
 */
export function validateMcpOAuthAuthorizationUrl(params: {
  authorizationUrl: string | URL;
  manifest?: McpProviderManifest | null;
}): ValidatedMcpOAuthAuthorizationUrl {
  const validated = validatePublicMcpOAuthUrl({
    url: params.authorizationUrl,
    label: "OAuth authorization",
  });
  const parsed = new URL(validated.url);
  const oauth = (params.manifest?.authOptions
    ?? (params.manifest ? [params.manifest.auth] : []))
    .find((auth) => auth.kind === "oauth2");
  if (oauth?.kind === "oauth2" && oauth.issuer) {
    const issuer = new URL(oauth.issuer);
    if (parsed.origin !== issuer.origin) {
      throw new McpRuntimeError(
        "MCP_ENDPOINT_BLOCKED",
        "OAuth authorization URL is outside the reviewed provider issuer",
      );
    }
  }
  return validated;
}
