import assert from "node:assert/strict";
import test from "node:test";
import {
  isDeniedCustomMcpHeaderName,
  normalizeMcpEndpoint,
  validateCustomMcpHeaderName,
  validateMcpCredentialText,
} from "../endpoint-policy";
import { getMcpProviderManifest } from "../provider-registry";

test("custom credential headers reject authority, forwarding, cookie, and platform namespaces", () => {
  for (const name of [
    "Authorization",
    "Host",
    "Cookie",
    "Proxy-Authorization",
    "X-Forwarded-For",
    "Sec-Fetch-Site",
    "X-AgentRanking-Account",
    "X-Internal-Auth",
  ]) {
    assert.equal(isDeniedCustomMcpHeaderName(name), true, name);
    assert.throws(() => validateCustomMcpHeaderName(name));
  }
  assert.equal(validateCustomMcpHeaderName("X-Partner-Api-Key"), "X-Partner-Api-Key");
});

test("credential values reject line breaks and control characters", () => {
  assert.throws(() => validateMcpCredentialText("secret\r\nX-Evil: yes", "API key"));
  assert.throws(() => validateMcpCredentialText("secret\u0000", "API key"));
  assert.equal(validateMcpCredentialText("  safe-secret  ", "API key"), "safe-secret");
});

test("remote endpoints are HTTPS, public, fragment-free, and pinned for reviewed providers", () => {
  assert.throws(() => normalizeMcpEndpoint({ endpoint: "http://example.com/mcp" }));
  assert.throws(() => normalizeMcpEndpoint({ endpoint: "https://127.0.0.1/mcp" }));
  assert.throws(() => normalizeMcpEndpoint({ endpoint: "https://user:pass@example.com/mcp" }));
  assert.throws(() => normalizeMcpEndpoint({ endpoint: "https://example.com/mcp#secret" }));

  const nansen = getMcpProviderManifest("nansen");
  assert.ok(nansen);
  assert.equal(
    normalizeMcpEndpoint({ endpoint: "https://mcp.nansen.ai/ra/mcp", manifest: nansen }).host,
    "mcp.nansen.ai",
  );
  assert.throws(() => normalizeMcpEndpoint({
    endpoint: "https://mcp.nansen.ai/other",
    manifest: nansen,
  }));
});
