import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  hasAmbiguousIdnLabel,
  isPublicIpAddress,
  OutboundTargetRejectedError,
  stripCrossOriginSensitiveHeaders,
  validatePublicHttpUrl,
} from "@/lib/outbound-http";
import {
  mcpConnectionStatusForError,
  mcpErrorCode,
  safeMcpErrorDetails,
} from "../errors";
import {
  validateMcpOAuthAuthorizationUrl,
  validatePublicMcpOAuthUrl,
} from "../endpoint-policy";
import { getMcpProviderManifest } from "../provider-registry";

async function source(relative: string): Promise<string> {
  return await readFile(path.join(process.cwd(), relative), "utf8");
}

test("IPv4 and IPv6 local, private, metadata, documentation, and reserved ranges fail closed", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "4000::1",
  ]) assert.equal(isPublicIpAddress(address), false, address);
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("URL validation rejects unsafe authority and schemes and normalizes IDNs", () => {
  for (const url of [
    "http://example.com/mcp",
    "https://localhost/mcp",
    "https://metadata.google.internal/computeMetadata/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/mcp",
    "https://user:password@example.com/mcp",
    "file:///etc/passwd",
  ]) assert.equal(validatePublicHttpUrl(url).ok, false, url);
  const idn = validatePublicHttpUrl("https://bücher.example/mcp#discarded");
  assert.equal(idn.ok, true);
  if (idn.ok) {
    assert.equal(idn.url.hostname, "xn--bcher-kva.example");
    assert.equal(idn.url.hash, "");
  }
  assert.equal(hasAmbiguousIdnLabel("bücher.example"), false);
  assert.equal(hasAmbiguousIdnLabel("pаypal.example"), true);
  assert.equal(validatePublicHttpUrl("https://pаypal.example/mcp").ok, false);
});

test("OAuth URLs permit protocol query parameters but reject fragments, private hosts, and issuer changes", () => {
  assert.equal(validatePublicMcpOAuthUrl({
    url: "https://example.com/oauth/token?audience=https%3A%2F%2Fapi.example.com",
    label: "OAuth token endpoint",
  }).origin, "https://example.com");
  assert.throws(() => validatePublicMcpOAuthUrl({
    url: "https://127.0.0.1/token",
    label: "OAuth token endpoint",
  }));
  assert.throws(() => validatePublicMcpOAuthUrl({
    url: "https://example.com/token#secret",
    label: "OAuth token endpoint",
  }));
  const dune = getMcpProviderManifest("dune");
  assert.ok(dune);
  assert.equal(validateMcpOAuthAuthorizationUrl({
    authorizationUrl: "https://dune.com/oauth/authorize?response_type=code&state=opaque",
    manifest: dune,
  }).origin, "https://dune.com");
  assert.throws(() => validateMcpOAuthAuthorizationUrl({
    authorizationUrl: "https://auth.attacker.example/authorize?state=opaque",
    manifest: dune,
  }));
});

test("cross-origin redirect filtering preserves only explicitly safe headers", () => {
  const filtered = stripCrossOriginSensitiveHeaders({
    Accept: "application/json",
    Authorization: "Bearer secret",
    Cookie: "session=secret",
    "X-Api-Key": "secret",
    "X-Request-Id": "request-1",
  });
  assert.deepEqual(filtered, {
    Accept: "application/json",
    "X-Request-Id": "request-1",
  });
});

test("outbound policy rejection enters the stable blocked lifecycle without exposing its target", () => {
  const error = new OutboundTargetRejectedError(
    "Outbound host resolved to a non-public address: 169.254.169.254",
  );
  assert.equal(mcpErrorCode(error), "MCP_ENDPOINT_BLOCKED");
  assert.equal(mcpErrorCode(new Error("SDK request failed", { cause: error })), "MCP_ENDPOINT_BLOCKED");
  assert.equal(mcpConnectionStatusForError(error), "BLOCKED");
  const safe = safeMcpErrorDetails(error);
  assert.equal(safe.message, "The MCP endpoint was blocked by outbound network policy");
  assert.doesNotMatch(JSON.stringify(safe), /169\.254\.169\.254/);
});

test("MCP transport pins validated DNS and manually validates every redirect", async () => {
  const outbound = await source("src/lib/outbound-http.ts");
  const network = await source("src/features/agent-chat/server/mcp/network.ts");
  const oauthStart = await source("src/app/api/dashboard/mcp/connections/[connectionId]/oauth/start/route.ts");
  assert.match(outbound, /lookup\(host, \{ all: true, verbatim: true \}\)/);
  assert.match(outbound, /addresses\.find\(\(row\) => !isPublicIpAddress\(row\.address\)\)/);
  assert.match(network, /connect: \{ lookup: pinnedLookup \}/);
  assert.match(network, /redirect: "manual"/);
  assert.match(network, /!canReplayRedirect\(request\.method\.toUpperCase\(\)\)/);
  assert.match(network, /Authenticated MCP requests cannot redirect to another origin/);
  assert.match(network, /stripCrossOriginSensitiveHeaders/);
  assert.match(network, /if \(!location\)[\s\S]*?boundedResponse/);
  assert.match(network, /export async function assertMcpPublicUrlResolves/);
  assert.match(network, /allowHttp: false/);
  assert.match(network, /allowLocalhost: false/);
  assert.doesNotMatch(network, /ALLOW_INSECURE_PRIVATE_NETWORK/);
  assert.match(oauthStart, /await assertMcpPublicUrlResolves\(authorization\.url, signal\)/);
});
