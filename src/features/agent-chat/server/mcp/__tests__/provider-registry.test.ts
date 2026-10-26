import assert from "node:assert/strict";
import test from "node:test";
import {
  getMcpProviderManifest,
  listConnectableMcpProviderManifests,
  listMcpProviderManifests,
  mcpProviderAuthMode,
  providerAllowsExistingConnection,
  providerAllowsNewConnection,
  providerHasFreshLaunchEvidence,
  resolveMcpProviderEndpoint,
  toPublicMcpProvider,
  validateMcpProviderManifest,
  type McpProviderManifest,
} from "../provider-registry";

const REQUIRED_CLAIMS = ["publisher", "endpoint", "transport", "auth", "tools", "chains"];

test("reviewed registry contains the complete first-party Web3 catalog", () => {
  const providers = listMcpProviderManifests();
  assert.deepEqual(providers.map((provider) => provider.key), [
    "nansen",
    "dune",
    "coinmarketcap",
    "lifi",
    "defillama",
    "bitquery",
    "token-terminal",
    "messari",
    "lunarcrush",
    "pyth",
    "zerion",
    "ankr-agent-rpc",
    "sqd-portal",
    "chainbase",
    "allium-agenthub",
    "cryptoquant",
    "tenderly",
    "santiment",
    "glassnode",
    "coingecko",
    "quicknode",
    "alchemy",
    "fireblocks-ai-link",
    "thirdweb",
    "jupiter",
    "okx-onchain-os",
    "1inch",
    "base",
    "morpho",
    "yield-xyz",
    "opensea",
    "binance-agent-os",
  ]);
  for (const provider of providers) {
    assert.doesNotThrow(() => validateMcpProviderManifest(provider));
    assert.equal(provider.delivery, "remote");
    assert.ok(provider.capabilityClasses.length > 0);
    assert.match(provider.brand.background, /^#[0-9a-f]{6}$/i);
    assert.match(provider.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
    if (!providerAllowsNewConnection(provider)) continue;
    assert.ok(["fixed", "template"].includes(provider.endpoint.kind));
    const claims = new Set(provider.evidence
      .filter((evidence) => evidence.publisherControlled)
      .flatMap((evidence) => evidence.supportsClaim));
    for (const claim of REQUIRED_CLAIMS) assert.equal(claims.has(claim), true, `${provider.key}:${claim}`);
    assert.ok(provider.admissionReview.capabilities);
    assert.ok(provider.admissionReview.dataAndCredentialHandling);
    assert.ok(provider.admissionReview.rateLimitsAndCost);
    assert.equal(provider.admissionReview.networkPolicy, "PINNED_HTTPS_RUNTIME_CHECKS");
    assert.equal(provider.admissionReview.catalogPolicy, "BOUNDED_LIVE_DISCOVERY");
    assert.ok(provider.admissionReview.failureAndRevocation);
  }
  assert.equal(providers.length, 32);
  assert.equal(listConnectableMcpProviderManifests().length, 30);
  assert.deepEqual(
    providers.filter((provider) => !providerAllowsNewConnection(provider)).map((provider) => provider.key),
    ["fireblocks-ai-link", "binance-agent-os"],
  );
});

test("manifest validation fails closed for unstable identity, missing evidence, and foreign endpoints", () => {
  const nansen = getMcpProviderManifest("nansen");
  assert.ok(nansen);
  assert.throws(() => validateMcpProviderManifest({ ...nansen, key: "Nansen" }));
  assert.throws(() => validateMcpProviderManifest({ ...nansen, manifestVersion: 0 }));
  assert.throws(() => validateMcpProviderManifest({ ...nansen, evidence: [] }));
  assert.throws(() => validateMcpProviderManifest({ ...nansen, capabilityClasses: [] }));
  assert.throws(() => validateMcpProviderManifest({ ...nansen, reviewedAt: "not-a-date" }));
  assert.throws(() => validateMcpProviderManifest({
    ...nansen,
    toolAllowlistSupport: true,
    toolAllowlistParameter: undefined,
  }));
  assert.throws(() => validateMcpProviderManifest({
    ...nansen,
    admissionReview: { ...nansen.admissionReview, failureAndRevocation: "" },
  }));
  assert.throws(() => validateMcpProviderManifest({
    ...nansen,
    endpoint: {
      kind: "fixed",
      url: "https://attacker.example/mcp",
      allowedOrigins: ["https://attacker.example"],
    },
  } as McpProviderManifest));
  assert.throws(() => validateMcpProviderManifest({
    ...nansen,
    endpoint: {
      ...nansen.endpoint,
      allowedOrigins: ["https://mcp.nansen.ai", "https://attacker.example"],
    },
  } as McpProviderManifest));
  assert.throws(() => validateMcpProviderManifest({
    ...nansen,
    auth: { kind: "api-key-header", headerName: "Host" },
    authOptions: undefined,
  }));
  assert.throws(() => validateMcpProviderManifest({
    ...nansen,
    docsUrl: "https://attacker.example/mcp",
  }));
});

test("public provider DTO exposes form metadata but not trust-policy internals", () => {
  const nansen = getMcpProviderManifest("nansen");
  assert.ok(nansen);
  const value = toPublicMcpProvider(nansen) as Record<string, unknown>;
  const serialized = JSON.stringify(value);
  assert.equal(value.endpointOrigin, "https://mcp.nansen.ai");
  assert.equal(value.connectable, true);
  assert.deepEqual(value.capabilityClasses, ["READ_ONLY", "ANALYTICS_QUERY"]);
  for (const privateField of [
    "evidence",
    "publisherDomains",
    "curatedToolRules",
    "allowedOrigins",
    "admissionReview",
    "tokenEndpoint",
    "issuer",
  ]) {
    assert.equal(privateField in value, false, privateField);
    assert.doesNotMatch(serialized, new RegExp(`\\"${privateField}\\"`));
  }
  assert.doesNotMatch(serialized, /\/ra\/mcp/);
});

test("auth-selected endpoint variants and reviewed secret placements are exact", () => {
  const coingecko = getMcpProviderManifest("coingecko");
  const thirdweb = getMcpProviderManifest("thirdweb");
  const pyth = getMcpProviderManifest("pyth");
  const zerion = getMcpProviderManifest("zerion");
  assert.ok(coingecko && thirdweb && pyth && zerion);
  assert.equal(resolveMcpProviderEndpoint(coingecko, "NONE").kind, "fixed");
  const pro = resolveMcpProviderEndpoint(coingecko, "API_KEY_HEADER");
  assert.equal(pro.kind, "fixed");
  if (pro.kind === "fixed") assert.equal(pro.url, "https://mcp.pro-api.coingecko.com/mcp");
  assert.equal(mcpProviderAuthMode(thirdweb.auth), "API_KEY_QUERY");
  assert.equal(thirdweb.auth.kind === "api-key-query" && thirdweb.auth.parameterName, "secretKey");
  assert.equal(thirdweb.toolAllowlistSupport, true);
  assert.equal(thirdweb.toolAllowlistParameter, "tools");
  assert.equal(mcpProviderAuthMode(pyth.auth), "NONE");
  assert.equal(
    pyth.authOptions?.some((auth) =>
      auth.kind === "api-key-tool-argument" && auth.argumentName === "access_token"),
    true,
  );
  assert.equal(mcpProviderAuthMode(zerion.auth), "API_KEY_TOOL_ARGUMENT");
});

test("execution providers ship with confirmation and tool-level hard-stop rules", () => {
  const actionProviders = listMcpProviderManifests().filter((provider) => provider.priority === "ACTION");
  assert.deepEqual(actionProviders.map((provider) => provider.key), [
    "lifi",
    "thirdweb",
    "jupiter",
    "okx-onchain-os",
    "1inch",
    "base",
    "yield-xyz",
    "opensea",
  ]);
  for (const provider of actionProviders) {
    assert.equal(providerAllowsNewConnection(provider), true, provider.key);
    assert.equal(provider.requiresUserConfirmation, true, provider.key);
    assert.notEqual(provider.defaultBindingPolicy.approvalMode, "AUTO_READ_ONLY", provider.key);
    assert.ok(provider.capabilityClasses.some((capability) =>
      ["TRANSACTION_PREP", "WALLET_APPROVAL", "TRADING"].includes(capability)), provider.key);
    assert.ok(provider.curatedToolRules.some((rule) => rule.block), provider.key);
  }
  const morpho = getMcpProviderManifest("morpho");
  assert.ok(morpho);
  assert.equal(morpho.releaseStage, "EXPERIMENTAL");
  assert.equal(providerAllowsNewConnection(morpho), true);
});

test("Dune OAuth policy is exact and remains server-only", () => {
  const dune = getMcpProviderManifest("dune");
  assert.ok(dune);
  const oauth = dune.authOptions?.find((auth) => auth.kind === "oauth2");
  assert.ok(oauth?.kind === "oauth2");
  assert.equal(oauth.issuer, "https://dune.com/oauth/mcp");
  assert.equal(oauth.tokenEndpoint, "https://dune.com/oauth/mcp/token");
  assert.equal(oauth.resource, "https://api.dune.com");
  assert.deepEqual(oauth.scopes, ["mcp:dune:full"]);
  const serialized = JSON.stringify(toPublicMcpProvider(dune));
  assert.doesNotMatch(serialized, /oauth\/mcp\/token|https:\/\/dune\.com\/oauth\/mcp/);
});

test("stale evidence automatically removes a provider from new one-click admission", () => {
  const nansen = getMcpProviderManifest("nansen");
  assert.ok(nansen);
  assert.equal(providerHasFreshLaunchEvidence(nansen, new Date("2026-08-25T12:00:00Z")), true);
  assert.equal(providerHasFreshLaunchEvidence(nansen, new Date("2027-03-01T00:00:00Z")), false);
});

test("missing curated manifests fail closed without blocking explicit custom connections", () => {
  assert.equal(providerAllowsExistingConnection(null, "removed-provider"), false);
  assert.equal(providerAllowsExistingConnection(null, null), true);
  const nansen = getMcpProviderManifest("nansen");
  assert.ok(nansen);
  assert.equal(providerAllowsExistingConnection(nansen, nansen.key), true);
  assert.equal(providerAllowsExistingConnection({
    ...nansen,
    delivery: "local",
    admission: "LOCAL_OR_GATEWAY_BACKLOG",
  }, nansen.key), false);
  assert.equal(providerAllowsExistingConnection({
    ...nansen,
    admission: "WATCHLIST",
  }, nansen.key), false);
});

test("runtime policy and transport both enforce existing provider identity", async () => {
  const policy = await import("node:fs/promises").then(({ readFile }) =>
    readFile("src/features/agent-chat/server/mcp/platform-policy.ts", "utf8"));
  const clientFactory = await import("node:fs/promises").then(({ readFile }) =>
    readFile("src/features/agent-chat/server/mcp/client-factory.ts", "utf8"));
  const configuration = await import("node:fs/promises").then(({ readFile }) =>
    readFile("src/features/agent-chat/server/mcp/configuration.ts", "utf8"));
  assert.match(policy, /providerAllowsExistingConnection\([\s\S]*?connection\.providerKey/);
  assert.match(clientFactory, /providerAllowsExistingConnection\(manifest, params\.connection\.providerKey\)/);
  assert.match(configuration, /params\.connection\.providerKey[\s\S]*?!manifest[\s\S]*?no longer has an executable platform manifest/);
});
