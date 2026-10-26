import "server-only";

import type { McpApprovalMode, McpAuthMode, McpToolRisk } from "./types";
import { ADDITIONAL_MCP_PROVIDER_MANIFESTS } from "./provider-manifests";

export type McpProviderAdmission =
  | "REMOTE_LAUNCH"
  | "REMOTE_BETA"
  | "REMOTE_SECURITY_REVIEW"
  | "LOCAL_OR_GATEWAY_BACKLOG"
  | "WATCHLIST"
  | "REJECTED";

export type McpProviderCategory =
  | "market-data"
  | "onchain-analytics"
  | "defi-fundamentals"
  | "protocol-fundamentals"
  | "crypto-research"
  | "social-intelligence"
  | "oracle-data"
  | "wallet-portfolio"
  | "indexed-chain-data"
  | "onchain-data"
  | "data-warehouse"
  | "derivatives"
  | "security-risk"
  | "nft-marketplace"
  | "explorer"
  | "subgraph-data"
  | "rpc-infrastructure"
  | "defi-routing"
  | "trading"
  | "wallet-custody"
  | "simulation"
  | "developer-infrastructure"
  | "payments";

export type McpProviderCapabilityClass =
  | "READ_ONLY"
  | "ANALYTICS_QUERY"
  | "SIMULATION"
  | "TRANSACTION_PREP"
  | "WALLET_APPROVAL"
  | "TRADING"
  | "PAID_CALLS"
  | "ACCOUNT_ADMIN";

export type McpProviderRiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type McpProviderBillingModel =
  | "FREE"
  | "FREEMIUM"
  | "USAGE_BASED"
  | "PAID_PLAN"
  | "ENTERPRISE"
  | "PAID_CALLS"
  | "UNKNOWN";
export type McpProviderReleaseStage =
  | "GA"
  | "BETA"
  | "EARLY_ACCESS"
  | "EXPERIMENTAL"
  | "WATCHLIST";
export type McpProviderPriority = "P0" | "P1" | "P2" | "ACTION" | "WATCH";

export type McpProviderAuth =
  | Readonly<{ kind: "none"; optionalApiKeyHeader?: string }>
  | Readonly<{ kind: "bearer" }>
  | Readonly<{ kind: "api-key-header"; headerName: string; prefix?: string }>
  | Readonly<{ kind: "api-key-query"; parameterName: string }>
  | Readonly<{ kind: "api-key-tool-argument"; argumentName: string }>
  | Readonly<{
      kind: "oauth2";
      discovery: "mcp" | "fixed";
      scopes?: readonly string[];
      resource?: string;
      issuer?: string;
      tokenEndpoint?: string;
    }>
  | Readonly<{
      kind: "client-credentials";
      tokenEndpoint: string;
      issuer: string;
      scopes?: readonly string[];
    }>;

export type McpCuratedToolRule = Readonly<{
  id: string;
  namePattern: RegExp;
  risk: McpToolRisk;
  block?: boolean;
  reason: string;
}>;

export type McpProviderManifest = Readonly<{
  key: string;
  manifestVersion: number;
  displayName: string;
  publisherName: string;
  publisherDomains: readonly string[];
  summary: string;
  categories: readonly McpProviderCategory[];
  chainFamilies: readonly string[];
  capabilityClasses: readonly McpProviderCapabilityClass[];
  riskLevel: McpProviderRiskLevel;
  billingModel: McpProviderBillingModel;
  releaseStage: McpProviderReleaseStage;
  priority: McpProviderPriority;
  credentialFields: readonly Readonly<{
    key: "apiKey" | "bearerToken" | "oauth" | "clientId" | "clientSecret";
    label: string;
    secret: boolean;
    required: boolean;
    helpText?: string;
  }>[];
  toolAllowlistSupport: boolean;
  toolAllowlistParameter?: string;
  requiresUserConfirmation: boolean;
  reviewedAt: string;
  brand: Readonly<{
    mark: string;
    foreground: string;
    background: string;
    iconUrl?: string;
  }>;
  delivery: "remote" | "local" | "hybrid" | "unknown";
  admission: McpProviderAdmission;
  endpoint:
    | Readonly<{ kind: "fixed"; url: string; allowedOrigins: readonly string[] }>
    | Readonly<{ kind: "template"; template: string; allowedHostSuffixes: readonly string[] }>
    | Readonly<{ kind: "user-supplied"; allowedHostSuffixes?: readonly string[] }>;
  endpointVariants?: readonly Readonly<{
    id: string;
    label: string;
    authKinds: readonly McpProviderAuth["kind"][];
    endpoint: Readonly<{ kind: "fixed"; url: string; allowedOrigins: readonly string[] }>;
  }>[];
  transports: readonly ("streamable-http" | "legacy-sse")[];
  auth: McpProviderAuth;
  authOptions?: readonly McpProviderAuth[];
  baselineRisk: McpToolRisk;
  curatedToolRules: readonly McpCuratedToolRule[];
  defaultBindingPolicy: Readonly<{
    approvalMode: McpApprovalMode;
    maxCallsPerRun: number;
    maxParallelCalls: number;
  }>;
  evidence: readonly Readonly<{
    url: string;
    publisherControlled: boolean;
    checkedAt: string;
    supportsClaim: readonly ("publisher" | "endpoint" | "transport" | "auth" | "tools" | "chains")[];
  }>[];
  admissionReview: Readonly<{
    capabilities: string;
    dataAndCredentialHandling: string;
    rateLimitsAndCost: string;
    networkPolicy: "PINNED_HTTPS_RUNTIME_CHECKS";
    catalogPolicy: "BOUNDED_LIVE_DISCOVERY";
    failureAndRevocation: string;
  }>;
  docsUrl: string;
  termsUrl?: string;
  privacyUrl?: string;
  notes?: string;
}>;

const checkedAt = "2026-08-25";
const RFC_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const DNS_NAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const REVIEWED_API_KEY_HEADER_DENYLIST = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "origin",
  "proxy-authorization",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const REVIEWED_API_KEY_HEADER_DENIED_PREFIXES = [
  "access-control-",
  "proxy-",
  "sec-",
  "x-agentranking-",
  "x-forwarded-",
  "x-internal-",
];
const REQUIRED_LAUNCH_EVIDENCE = new Set([
  "publisher",
  "endpoint",
  "transport",
  "auth",
  "tools",
  "chains",
]);
const PLATFORM_MAX_CALLS_PER_RUN = 50;
const PLATFORM_MAX_PARALLEL_CALLS = 4;
const PROVIDER_EVIDENCE_MAX_AGE_MS = 180 * 24 * 60 * 60_000;

const PROVIDERS: readonly McpProviderManifest[] = [
  // Evidence checked 2026-08-25:
  // - endpoint/transport/auth/tools/chains: https://docs.nansen.ai/mcp/connecting
  // - terms/privacy: https://nansen.ai/legal/terms-of-services and https://nansen.ai/legal/privacy-policy
  // Reviewer conclusion: admit the publisher-hosted analytics endpoint with
  // local query/output quotas and no assumption that plan-gated data is public.
  {
    key: "nansen",
    manifestVersion: 1,
    displayName: "Nansen",
    publisherName: "Nansen",
    publisherDomains: ["nansen.ai"],
    summary: "On-chain analytics, token intelligence, and wallet research.",
    categories: ["onchain-analytics", "market-data"],
    chainFamilies: ["evm", "solana"],
    capabilityClasses: ["READ_ONLY", "ANALYTICS_QUERY"],
    riskLevel: "LOW",
    billingModel: "PAID_PLAN",
    releaseStage: "GA",
    priority: "P0",
    credentialFields: [{ key: "apiKey", label: "Nansen API key", secret: true, required: true }],
    toolAllowlistSupport: false,
    requiresUserConfirmation: false,
    reviewedAt: checkedAt,
    brand: { mark: "N", foreground: "#ffffff", background: "#6d5dfc", iconUrl: "https://nansen.ai/favicon.ico" },
    delivery: "remote",
    admission: "REMOTE_LAUNCH",
    endpoint: {
      kind: "fixed",
      url: "https://mcp.nansen.ai/ra/mcp",
      allowedOrigins: ["https://mcp.nansen.ai"],
    },
    transports: ["streamable-http"],
    auth: { kind: "api-key-header", headerName: "NANSEN-API-KEY" },
    baselineRisk: "ANALYTICS_QUERY",
    curatedToolRules: [],
    defaultBindingPolicy: {
      approvalMode: "AUTO_READ_ONLY",
      maxCallsPerRun: 12,
      maxParallelCalls: 2,
    },
    evidence: [{
      url: "https://docs.nansen.ai/mcp/connecting",
      publisherControlled: true,
      checkedAt,
      supportsClaim: ["publisher", "endpoint", "transport", "auth", "tools", "chains"],
    }],
    admissionReview: {
      capabilities: "Analytics and research queries only; no signing, custody, or broadcast capability is admitted.",
      dataAndCredentialHandling: "The API key is decrypted only for requests to the fixed Nansen origin; provider terms and privacy policy govern submitted query data.",
      rateLimitsAndCost: "Provider plan and credit limits remain authoritative; AgentRanking additionally enforces bounded calls, concurrency, time, input, and output.",
      networkPolicy: "PINNED_HTTPS_RUNTIME_CHECKS",
      catalogPolicy: "BOUNDED_LIVE_DISCOVERY",
      failureAndRevocation: "Authentication failures require key replacement; users revoke or rotate API keys with Nansen and can always delete the local encrypted credential.",
    },
    docsUrl: "https://docs.nansen.ai/mcp/connecting",
    termsUrl: "https://nansen.ai/legal/terms-of-services",
    privacyUrl: "https://nansen.ai/legal/privacy-policy",
  },
  // Evidence checked 2026-08-25:
  // - endpoint/transport/auth/scopes/token endpoint/tools/chains: https://docs.dune.com/docs/agents/mcp
  // - terms/privacy: https://dune.com/terms and https://dune.com/privacy
  // Reviewer conclusion: admit queries with bounded cost controls; locally
  // elevate create/update/delete operations over saved Dune assets.
  {
    key: "dune",
    manifestVersion: 1,
    displayName: "Dune",
    publisherName: "Dune Analytics",
    publisherDomains: ["dune.com"],
    summary: "Query blockchain datasets and manage Dune analytics assets.",
    categories: ["onchain-analytics", "developer-infrastructure"],
    chainFamilies: ["multi-chain"],
    capabilityClasses: ["READ_ONLY", "ANALYTICS_QUERY"],
    riskLevel: "MODERATE",
    billingModel: "USAGE_BASED",
    releaseStage: "GA",
    priority: "P0",
    credentialFields: [{ key: "apiKey", label: "Dune API key", secret: true, required: true }, { key: "oauth", label: "Dune OAuth", secret: true, required: false }],
    toolAllowlistSupport: false,
    requiresUserConfirmation: true,
    reviewedAt: checkedAt,
    brand: { mark: "D", foreground: "#111111", background: "#f4b860", iconUrl: "https://dune.com/favicon.ico" },
    delivery: "remote",
    admission: "REMOTE_LAUNCH",
    endpoint: {
      kind: "fixed",
      url: "https://api.dune.com/mcp/v1",
      allowedOrigins: ["https://api.dune.com"],
    },
    transports: ["streamable-http"],
    auth: { kind: "api-key-header", headerName: "x-dune-api-key" },
    authOptions: [
      { kind: "api-key-header", headerName: "x-dune-api-key" },
      {
        kind: "oauth2",
        discovery: "fixed",
        scopes: ["mcp:dune:full"],
        resource: "https://api.dune.com",
        issuer: "https://dune.com/oauth/mcp",
        tokenEndpoint: "https://dune.com/oauth/mcp/token",
      },
    ],
    baselineRisk: "ANALYTICS_QUERY",
    curatedToolRules: [
      {
        id: "dune-offchain-writes-v1",
        namePattern: /(?:create|update|delete).*(?:query|dashboard|visuali[sz]ation|materialized|folder)/i,
        risk: "WRITE_OFFCHAIN",
        reason: "Creates, modifies, or removes a Dune account resource.",
      },
    ],
    defaultBindingPolicy: {
      approvalMode: "CONFIRM_MUTATIONS",
      maxCallsPerRun: 10,
      maxParallelCalls: 1,
    },
    evidence: [{
      url: "https://docs.dune.com/docs/agents/mcp",
      publisherControlled: true,
      checkedAt,
      supportsClaim: ["publisher", "endpoint", "transport", "auth", "tools", "chains"],
    }],
    admissionReview: {
      capabilities: "Blockchain queries are admitted; create, update, and delete operations over Dune assets are locally classified as off-chain writes.",
      dataAndCredentialHandling: "API keys or OAuth tokens are decrypted only at the fixed Dune request boundary; provider terms and privacy policy govern submitted query data.",
      rateLimitsAndCost: "Dune plan, credit, and rate limits remain authoritative; AgentRanking additionally applies conservative serial execution and per-run bounds.",
      networkPolicy: "PINNED_HTTPS_RUNTIME_CHECKS",
      catalogPolicy: "BOUNDED_LIVE_DISCOVERY",
      failureAndRevocation: "OAuth tokens are refreshed under single-flight and revoked when the authorization server advertises revocation; API keys are replaced or revoked through Dune, while local deletion always removes encrypted authority.",
    },
    docsUrl: "https://docs.dune.com/docs/agents/mcp",
    termsUrl: "https://dune.com/terms",
    privacyUrl: "https://dune.com/privacy",
    notes: "API-key query parameters are intentionally unsupported; use the reviewed header or OAuth.",
  },
  // Evidence checked 2026-08-25:
  // - endpoint/transport/auth/tools/chains: https://coinmarketcap.com/api/mcp/
  // - terms/privacy: https://coinmarketcap.com/terms/ and https://coinmarketcap.com/privacy/
  // Reviewer conclusion: admit only the publisher's non-x402 market-data
  // endpoint and retain a local hard block for payment-like tools.
  {
    key: "coinmarketcap",
    manifestVersion: 1,
    displayName: "CoinMarketCap",
    publisherName: "CoinMarketCap",
    publisherDomains: ["coinmarketcap.com"],
    summary: "Read-only cryptocurrency market data and reference information.",
    categories: ["market-data"],
    chainFamilies: ["multi-chain"],
    capabilityClasses: ["READ_ONLY"],
    riskLevel: "LOW",
    billingModel: "FREEMIUM",
    releaseStage: "GA",
    priority: "P2",
    credentialFields: [{ key: "apiKey", label: "CoinMarketCap API key", secret: true, required: true }],
    toolAllowlistSupport: false,
    requiresUserConfirmation: false,
    reviewedAt: checkedAt,
    brand: { mark: "C", foreground: "#ffffff", background: "#3861fb", iconUrl: "https://coinmarketcap.com/favicon.ico" },
    delivery: "remote",
    admission: "REMOTE_LAUNCH",
    endpoint: {
      kind: "fixed",
      url: "https://mcp.coinmarketcap.com/mcp",
      allowedOrigins: ["https://mcp.coinmarketcap.com"],
    },
    transports: ["streamable-http"],
    auth: { kind: "api-key-header", headerName: "X-CMC-MCP-API-KEY" },
    baselineRisk: "READ_ONLY",
    curatedToolRules: [{
      id: "cmc-payment-block-v1",
      namePattern: /(?:x402|payment|purchase|pay)/i,
      risk: "PAYMENT",
      block: true,
      reason: "Paid/x402 MCP endpoints are outside the generic connection boundary.",
    }],
    defaultBindingPolicy: {
      approvalMode: "AUTO_READ_ONLY",
      maxCallsPerRun: 16,
      maxParallelCalls: 2,
    },
    evidence: [{
      url: "https://coinmarketcap.com/api/mcp/",
      publisherControlled: true,
      checkedAt,
      supportsClaim: ["publisher", "endpoint", "transport", "auth", "tools", "chains"],
    }],
    admissionReview: {
      capabilities: "The non-x402 market-data endpoint is admitted as read-only; payment-like or purchase tools are hard blocked.",
      dataAndCredentialHandling: "The API key is decrypted only for requests to the fixed CoinMarketCap origin; provider terms and privacy policy govern submitted request data.",
      rateLimitsAndCost: "CoinMarketCap plan, credit, and rate limits remain authoritative; AgentRanking additionally enforces bounded calls, concurrency, time, input, and output.",
      networkPolicy: "PINNED_HTTPS_RUNTIME_CHECKS",
      catalogPolicy: "BOUNDED_LIVE_DISCOVERY",
      failureAndRevocation: "Authentication failures require key replacement; users revoke or rotate API keys with CoinMarketCap and can always delete the local encrypted credential.",
    },
    docsUrl: "https://coinmarketcap.com/api/mcp/",
    termsUrl: "https://coinmarketcap.com/terms/",
    privacyUrl: "https://coinmarketcap.com/privacy/",
    notes: "Only the non-x402 read endpoint is admitted.",
  },
  // Evidence checked 2026-08-25:
  // - endpoint/transport/auth: https://docs.li.fi/mcp-server/overview
  // - tools/chains: https://docs.li.fi/mcp-server/tools
  // - terms/privacy: https://li.fi/legal/terms-and-conditions and https://li.fi/legal/privacy-policy
  // Reviewer conclusion: admit data/quotes and unsigned transaction builders;
  // signing/broadcast stays blocked and preparation enters native review.
  {
    key: "lifi",
    manifestVersion: 1,
    displayName: "LI.FI",
    publisherName: "LI.FI",
    publisherDomains: ["li.fi", "li.quest"],
    summary: "Cross-chain routes, quotes, and unsigned transaction preparation.",
    categories: ["defi-routing", "market-data"],
    chainFamilies: ["evm", "solana", "multi-chain"],
    capabilityClasses: ["READ_ONLY", "TRANSACTION_PREP"],
    riskLevel: "MODERATE",
    billingModel: "FREEMIUM",
    releaseStage: "GA",
    priority: "ACTION",
    credentialFields: [{ key: "apiKey", label: "LI.FI API key", secret: true, required: false }],
    toolAllowlistSupport: false,
    requiresUserConfirmation: true,
    reviewedAt: checkedAt,
    brand: { mark: "LI", foreground: "#ffffff", background: "#8f5bff", iconUrl: "https://li.fi/favicon.ico" },
    delivery: "remote",
    admission: "REMOTE_LAUNCH",
    endpoint: {
      kind: "fixed",
      url: "https://mcp.li.quest/mcp",
      allowedOrigins: ["https://mcp.li.quest"],
    },
    transports: ["streamable-http"],
    auth: { kind: "none", optionalApiKeyHeader: "X-LiFi-Api-Key" },
    authOptions: [
      { kind: "none", optionalApiKeyHeader: "X-LiFi-Api-Key" },
      { kind: "api-key-header", headerName: "X-LiFi-Api-Key" },
      { kind: "bearer" },
    ],
    baselineRisk: "READ_ONLY",
    curatedToolRules: [
      {
        id: "lifi-unsigned-transaction-v1",
        namePattern: /(?:transactionRequest|unsignedTransaction|calldata|build.*(?:transaction|tx)|prepare.*(?:transaction|tx))/i,
        risk: "TRANSACTION_PREPARE",
        reason: "Prepares an unsigned transaction for separate native review and signing.",
      },
      {
        id: "lifi-sign-block-v1",
        namePattern: /(?:sign|signature)/i,
        risk: "SIGN",
        block: true,
        reason: "LI.FI MCP is admitted without signing authority.",
      },
      {
        id: "lifi-broadcast-block-v1",
        namePattern: /(?:broadcast|sendRawTransaction|submitTransaction)/i,
        risk: "BROADCAST",
        block: true,
        reason: "LI.FI MCP is admitted only for data, quotes, and unsigned transaction preparation.",
      },
    ],
    defaultBindingPolicy: {
      approvalMode: "CONFIRM_MUTATIONS",
      maxCallsPerRun: 8,
      maxParallelCalls: 1,
    },
    evidence: [{
      url: "https://docs.li.fi/mcp-server/overview",
      publisherControlled: true,
      checkedAt,
      supportsClaim: ["publisher", "endpoint", "transport", "auth", "tools", "chains"],
    }, {
      url: "https://docs.li.fi/mcp-server/tools",
      publisherControlled: true,
      checkedAt,
      supportsClaim: ["tools", "chains"],
    }],
    admissionReview: {
      capabilities: "Data and quote tools plus unsigned transaction preparation are admitted; signing, submission, and broadcast are hard blocked and remain native-wallet responsibilities.",
      dataAndCredentialHandling: "Optional API credentials are decrypted only for requests to the fixed LI.FI origin; provider terms and privacy policy govern quote and route request data.",
      rateLimitsAndCost: "LI.FI provider-side rate and commercial rules remain authoritative; AgentRanking additionally applies conservative serial execution and per-run bounds.",
      networkPolicy: "PINNED_HTTPS_RUNTIME_CHECKS",
      catalogPolicy: "BOUNDED_LIVE_DISCOVERY",
      failureAndRevocation: "No remote token-revocation contract is assumed for optional API keys; users rotate provider keys and local deletion always removes encrypted authority.",
    },
    docsUrl: "https://docs.li.fi/mcp-server/overview",
    termsUrl: "https://li.fi/legal/terms-and-conditions",
    privacyUrl: "https://li.fi/legal/privacy-policy",
  },
  ...ADDITIONAL_MCP_PROVIDER_MANIFESTS,
] as const;

function assertHttpsUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${label} URL in MCP provider manifest`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${label} must be HTTPS without user information or a fragment`);
  }
  return parsed;
}

function publisherControlsHost(
  hostname: string,
  publisherDomains: readonly string[],
): boolean {
  const normalized = hostname.toLowerCase();
  return publisherDomains.some((domain) =>
    normalized === domain || normalized.endsWith(`.${domain}`));
}

function reviewedApiKeyHeaderIsUnsafe(headerName: string): boolean {
  const normalized = headerName.toLowerCase();
  return REVIEWED_API_KEY_HEADER_DENYLIST.has(normalized)
    || REVIEWED_API_KEY_HEADER_DENIED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function validateManifestAuth(auth: McpProviderAuth, label: string): void {
  if (auth.kind === "api-key-header") {
    if (
      !RFC_TOKEN.test(auth.headerName)
      || reviewedApiKeyHeaderIsUnsafe(auth.headerName)
      || (auth.prefix?.length ?? 0) > 128
      || /[\u0000-\u001f\u007f]/.test(auth.prefix ?? "")
    ) {
      throw new Error(`${label} has an invalid reviewed API-key header`);
    }
  }
  if (
    (auth.kind === "api-key-query" && !RFC_TOKEN.test(auth.parameterName))
    || (auth.kind === "api-key-tool-argument"
      && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(auth.argumentName))
  ) {
    throw new Error(`${label} has an invalid reviewed API-key placement`);
  }
  if (
    auth.kind === "none"
    && auth.optionalApiKeyHeader
    && (
      !RFC_TOKEN.test(auth.optionalApiKeyHeader)
      || reviewedApiKeyHeaderIsUnsafe(auth.optionalApiKeyHeader)
    )
  ) {
    throw new Error(`${label} has an invalid optional API-key header`);
  }
  if (auth.kind === "oauth2") {
    if (auth.issuer) assertHttpsUrl(auth.issuer, `${label} OAuth issuer`);
    if (auth.resource) assertHttpsUrl(auth.resource, `${label} OAuth resource`);
    if (auth.discovery === "fixed" && !auth.tokenEndpoint) {
      throw new Error(`${label} fixed OAuth policy requires a token endpoint`);
    }
    if (auth.tokenEndpoint) {
      const tokenEndpoint = assertHttpsUrl(auth.tokenEndpoint, `${label} OAuth token endpoint`);
      if (auth.issuer && tokenEndpoint.origin !== new URL(auth.issuer).origin) {
        throw new Error(`${label} OAuth token endpoint must remain on the reviewed issuer origin`);
      }
    }
  }
  if (auth.kind === "client-credentials") {
    assertHttpsUrl(auth.tokenEndpoint, `${label} token endpoint`);
    assertHttpsUrl(auth.issuer, `${label} client-credentials issuer`);
  }
}

export function validateMcpProviderManifest(manifest: McpProviderManifest): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(manifest.key) || manifest.key !== manifest.key.toLowerCase()) {
    throw new Error("MCP provider keys must be stable lowercase identifiers");
  }
  if (!Number.isSafeInteger(manifest.manifestVersion) || manifest.manifestVersion < 1) {
    throw new Error(`${manifest.key} has an invalid manifest version`);
  }
  if (!manifest.displayName.trim() || !manifest.publisherName.trim() || !manifest.summary.trim()) {
    throw new Error(`${manifest.key} is missing required provider metadata`);
  }
  if (
    !manifest.capabilityClasses.length
    || new Set(manifest.capabilityClasses).size !== manifest.capabilityClasses.length
    || !manifest.credentialFields.every((field) => field.label.trim())
    || new Set(manifest.credentialFields.map((field) => field.key)).size !== manifest.credentialFields.length
    || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.reviewedAt)
    || Number.isNaN(Date.parse(`${manifest.reviewedAt}T00:00:00Z`))
    || !manifest.brand.mark.trim()
    || manifest.brand.mark.length > 6
    || !/^#[0-9a-f]{6}$/i.test(manifest.brand.foreground)
    || !/^#[0-9a-f]{6}$/i.test(manifest.brand.background)
  ) {
    throw new Error(`${manifest.key} has incomplete capability, credential, review, or brand metadata`);
  }
  if (manifest.toolAllowlistSupport !== Boolean(manifest.toolAllowlistParameter)) {
    throw new Error(`${manifest.key} has an inconsistent tool allowlist declaration`);
  }
  if (manifest.toolAllowlistParameter && !RFC_TOKEN.test(manifest.toolAllowlistParameter)) {
    throw new Error(`${manifest.key} has an invalid tool allowlist parameter`);
  }
  if (manifest.brand.iconUrl) {
    const icon = assertHttpsUrl(manifest.brand.iconUrl, `${manifest.key} brand icon`);
    if (!publisherControlsHost(icon.hostname, manifest.publisherDomains)) {
      throw new Error(`${manifest.key} brand icon is not publisher-controlled`);
    }
  }
  if (
    !manifest.publisherDomains.length
    || new Set(manifest.publisherDomains).size !== manifest.publisherDomains.length
    || !manifest.publisherDomains.every((domain) =>
      domain === domain.toLowerCase()
      && DNS_NAME.test(domain)
      && !domain.includes(".."))
    || !manifest.categories.length
    || !manifest.chainFamilies.length
  ) {
    throw new Error(`${manifest.key} is missing publisher, category, or chain coverage`);
  }
  if (
    manifest.requiresUserConfirmation
    && manifest.defaultBindingPolicy.approvalMode === "AUTO_READ_ONLY"
  ) {
    throw new Error(`${manifest.key} requires confirmation but defaults to automatic execution`);
  }
  if (!manifest.transports.length || new Set(manifest.transports).size !== manifest.transports.length) {
    throw new Error(`${manifest.key} has invalid transport declarations`);
  }
  if (
    manifest.defaultBindingPolicy.maxCallsPerRun < 1
    || manifest.defaultBindingPolicy.maxCallsPerRun > PLATFORM_MAX_CALLS_PER_RUN
    || manifest.defaultBindingPolicy.maxParallelCalls < 1
    || manifest.defaultBindingPolicy.maxParallelCalls > PLATFORM_MAX_PARALLEL_CALLS
  ) {
    throw new Error(`${manifest.key} default limits exceed platform bounds`);
  }
  if (manifest.endpoint.kind === "fixed") {
    const endpoint = assertHttpsUrl(manifest.endpoint.url, `${manifest.key} endpoint`);
    if (
      endpoint.search
      || manifest.endpoint.allowedOrigins.length !== 1
      || manifest.endpoint.allowedOrigins[0] !== endpoint.origin
      || !publisherControlsHost(endpoint.hostname, manifest.publisherDomains)
    ) {
      throw new Error(`${manifest.key} fixed endpoint is not exactly origin-bound`);
    }
  } else if (manifest.endpoint.kind === "template") {
    let template: URL;
    try {
      template = assertHttpsUrl(
        manifest.endpoint.template.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, "placeholder"),
        `${manifest.key} endpoint template`,
      );
    } catch {
      throw new Error(`${manifest.key} template endpoint is not HTTPS and host-bound`);
    }
    const suffixes = manifest.endpoint.allowedHostSuffixes;
    if (
      manifest.endpoint.template.search(/[\u0080-\uffff]/) >= 0
      || template.search
      || !suffixes.length
      || new Set(suffixes).size !== suffixes.length
      || !suffixes.every((suffix) =>
        suffix === suffix.toLowerCase()
        && DNS_NAME.test(suffix)
        && !suffix.includes("..")
        && publisherControlsHost(suffix, manifest.publisherDomains))
      || !suffixes.some((suffix) =>
        template.hostname === suffix || template.hostname.endsWith(`.${suffix}`))
    ) {
      throw new Error(`${manifest.key} template endpoint is not HTTPS and host-bound`);
    }
  } else if (manifest.endpoint.allowedHostSuffixes?.some((suffix) =>
    suffix !== suffix.toLowerCase()
    || !DNS_NAME.test(suffix)
    || suffix.includes("..")
    || !publisherControlsHost(suffix, manifest.publisherDomains))) {
    throw new Error(`${manifest.key} user-supplied endpoint allowlist is not publisher-bound`);
  }
  const endpointVariantIds = new Set<string>();
  for (const variant of manifest.endpointVariants ?? []) {
    const endpoint = assertHttpsUrl(variant.endpoint.url, `${manifest.key} endpoint variant`);
    if (
      !variant.id.trim()
      || endpointVariantIds.has(variant.id)
      || !variant.label.trim()
      || !variant.authKinds.length
      || new Set(variant.authKinds).size !== variant.authKinds.length
      || endpoint.search
      || variant.endpoint.allowedOrigins.length !== 1
      || variant.endpoint.allowedOrigins[0] !== endpoint.origin
      || !publisherControlsHost(endpoint.hostname, manifest.publisherDomains)
    ) {
      throw new Error(`${manifest.key} has an invalid endpoint variant`);
    }
    endpointVariantIds.add(variant.id);
  }
  const authOptions = manifest.authOptions ?? [manifest.auth];
  if (
    !authOptions.length
    || new Set(authOptions.map((auth) => JSON.stringify(auth))).size !== authOptions.length
  ) {
    throw new Error(`${manifest.key} has no unique authentication policy`);
  }
  authOptions.forEach((auth) => validateManifestAuth(auth, manifest.key));
  if (!authOptions.some((auth) => JSON.stringify(auth) === JSON.stringify(manifest.auth))) {
    throw new Error(`${manifest.key} primary authentication policy is absent from authOptions`);
  }
  for (const variant of manifest.endpointVariants ?? []) {
    if (variant.authKinds.some((kind) => !authOptions.some((auth) => auth.kind === kind))) {
      throw new Error(`${manifest.key} endpoint variant references an unavailable auth policy`);
    }
  }
  const ruleIds = new Set<string>();
  for (const rule of manifest.curatedToolRules) {
    if (!rule.id.trim() || ruleIds.has(rule.id) || rule.namePattern.global || rule.namePattern.sticky) {
      throw new Error(`${manifest.key} has an unstable or duplicate curated tool rule`);
    }
    ruleIds.add(rule.id);
  }
  const reviewedPages: Array<readonly [string, string]> = [
    [manifest.docsUrl, "documentation"],
  ];
  if (manifest.termsUrl) reviewedPages.push([manifest.termsUrl, "terms"]);
  if (manifest.privacyUrl) reviewedPages.push([manifest.privacyUrl, "privacy policy"]);
  for (const [url, label] of reviewedPages) {
    const parsed = assertHttpsUrl(url, `${manifest.key} ${label}`);
    if (!publisherControlsHost(parsed.hostname, manifest.publisherDomains)) {
      throw new Error(`${manifest.key} ${label} is not publisher-controlled`);
    }
  }
  for (const evidence of manifest.evidence) {
    const evidenceUrl = assertHttpsUrl(evidence.url, `${manifest.key} evidence`);
    if (
      evidence.publisherControlled
      && !publisherControlsHost(evidenceUrl.hostname, manifest.publisherDomains)
    ) {
      throw new Error(`${manifest.key} marks non-publisher evidence as publisher-controlled`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.checkedAt)
      || Number.isNaN(Date.parse(`${evidence.checkedAt}T00:00:00Z`))) {
      throw new Error(`${manifest.key} has an invalid evidence review date`);
    }
  }
  if (["REMOTE_LAUNCH", "REMOTE_BETA"].includes(manifest.admission)) {
    if (manifest.delivery !== "remote" || !["fixed", "template"].includes(manifest.endpoint.kind)) {
      throw new Error(`${manifest.key} is not eligible for remote connection admission`);
    }
    const supported = new Set<string>(
      manifest.evidence
        .filter((evidence) => evidence.publisherControlled)
        .flatMap((evidence) => evidence.supportsClaim),
    );
    for (const claim of REQUIRED_LAUNCH_EVIDENCE) {
      if (!supported.has(claim)) {
        throw new Error(`${manifest.key} lacks first-party evidence for ${claim}`);
      }
    }
    const review = manifest.admissionReview;
    if (
      !review.capabilities.trim()
      || !review.dataAndCredentialHandling.trim()
      || !review.rateLimitsAndCost.trim()
      || !review.failureAndRevocation.trim()
      || review.networkPolicy !== "PINNED_HTTPS_RUNTIME_CHECKS"
      || review.catalogPolicy !== "BOUNDED_LIVE_DISCOVERY"
    ) {
      throw new Error(`${manifest.key} has an incomplete launch admission review`);
    }
  }
}

const providerKeys = new Set<string>();
for (const provider of PROVIDERS) {
  validateMcpProviderManifest(provider);
  if (providerKeys.has(provider.key)) throw new Error(`Duplicate MCP provider key: ${provider.key}`);
  providerKeys.add(provider.key);
}

const BY_KEY = new Map(PROVIDERS.map((provider) => [provider.key, provider]));

export function listMcpProviderManifests(): readonly McpProviderManifest[] {
  return PROVIDERS;
}

export function listConnectableMcpProviderManifests(): readonly McpProviderManifest[] {
  return PROVIDERS.filter(providerAllowsNewConnection);
}

export function getMcpProviderManifest(key: string | null | undefined): McpProviderManifest | null {
  return key ? BY_KEY.get(key.trim().toLowerCase()) ?? null : null;
}

export function providerAllowsExistingConnection(
  manifest: McpProviderManifest | null,
  providerKey?: string | null,
): boolean {
  // A null provider key is the explicit custom-server identity. A non-null key
  // whose manifest disappeared must fail closed instead of silently acquiring
  // the custom-server policy posture.
  if (providerKey) {
    return Boolean(
      manifest
      && manifest.delivery === "remote"
      && ["REMOTE_LAUNCH", "REMOTE_BETA", "REMOTE_SECURITY_REVIEW"].includes(
        manifest.admission,
      )
      && ["fixed", "template"].includes(manifest.endpoint.kind),
    );
  }
  return manifest === null;
}

export function providerHasFreshLaunchEvidence(
  manifest: McpProviderManifest,
  now = new Date(),
): boolean {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;
  return [...REQUIRED_LAUNCH_EVIDENCE].every((claim) => manifest.evidence.some((evidence) => {
    if (!evidence.publisherControlled || !evidence.supportsClaim.some((candidate) => candidate === claim)) {
      return false;
    }
    const checkedMs = Date.parse(`${evidence.checkedAt}T00:00:00Z`);
    const ageMs = nowMs - checkedMs;
    return Number.isFinite(checkedMs) && ageMs >= 0 && ageMs <= PROVIDER_EVIDENCE_MAX_AGE_MS;
  }));
}

export function providerAllowsNewConnection(manifest: McpProviderManifest): boolean {
  return manifest.delivery === "remote"
    && ["REMOTE_LAUNCH", "REMOTE_BETA"].includes(manifest.admission)
    && ["fixed", "template"].includes(manifest.endpoint.kind)
    && providerHasFreshLaunchEvidence(manifest);
}

export function mcpProviderAuthMode(auth: McpProviderAuth): McpAuthMode {
  if (auth.kind === "none") return "NONE";
  if (auth.kind === "bearer") return "BEARER_TOKEN";
  if (auth.kind === "api-key-header") return "API_KEY_HEADER";
  if (auth.kind === "api-key-query") return "API_KEY_QUERY";
  if (auth.kind === "api-key-tool-argument") return "API_KEY_TOOL_ARGUMENT";
  if (auth.kind === "oauth2") return "OAUTH2_AUTHORIZATION_CODE";
  return "OAUTH2_CLIENT_CREDENTIALS";
}

export function resolveMcpProviderEndpoint(
  manifest: McpProviderManifest,
  authMode: McpAuthMode,
): McpProviderManifest["endpoint"] {
  const variant = manifest.endpointVariants?.find((candidate) =>
    candidate.authKinds.some((kind) =>
      (manifest.authOptions ?? [manifest.auth])
        .some((auth) => auth.kind === kind && mcpProviderAuthMode(auth) === authMode)));
  return variant?.endpoint ?? manifest.endpoint;
}

export function mcpProviderUnavailableReason(manifest: McpProviderManifest): string | null {
  if (providerAllowsNewConnection(manifest)) return null;
  if (manifest.releaseStage === "EARLY_ACCESS") return "Early access — awaiting a stable reviewed endpoint";
  if (manifest.releaseStage === "WATCHLIST") return "Watchlist — not yet admitted for connections";
  if (manifest.admission === "REMOTE_SECURITY_REVIEW") return "Security review in progress";
  if (manifest.endpoint.kind === "user-supplied") return "No stable operator-hosted endpoint is available";
  if (!providerHasFreshLaunchEvidence(manifest)) return "Provider review evidence requires renewal";
  return "Provider is not currently admitted for new connections";
}

function publicAuth(auth: McpProviderAuth) {
  if (auth.kind === "api-key-header") {
    return { kind: auth.kind, headerName: auth.headerName, prefix: auth.prefix };
  }
  if (auth.kind === "oauth2") {
    return { kind: auth.kind, scopes: auth.scopes ?? [] };
  }
  if (auth.kind === "client-credentials") {
    return { kind: auth.kind, scopes: auth.scopes ?? [] };
  }
  if (auth.kind === "api-key-query") {
    return { kind: auth.kind, parameterName: auth.parameterName };
  }
  if (auth.kind === "api-key-tool-argument") {
    return { kind: auth.kind, argumentName: auth.argumentName };
  }
  return { kind: auth.kind };
}

export function toPublicMcpProvider(manifest: McpProviderManifest) {
  const endpoint = manifest.endpoint.kind === "fixed"
    ? new URL(manifest.endpoint.url).origin
    : null;
  return {
    key: manifest.key,
    manifestVersion: manifest.manifestVersion,
    displayName: manifest.displayName,
    publisherName: manifest.publisherName,
    summary: manifest.summary,
    categories: manifest.categories,
    chainFamilies: manifest.chainFamilies,
    chains: manifest.chainFamilies,
    capabilityClasses: manifest.capabilityClasses,
    riskLevel: manifest.riskLevel,
    billingModel: manifest.billingModel,
    releaseStage: manifest.releaseStage,
    priority: manifest.priority,
    credentialFields: manifest.credentialFields,
    toolAllowlistSupport: manifest.toolAllowlistSupport,
    requiresUserConfirmation: manifest.requiresUserConfirmation,
    reviewedAt: manifest.reviewedAt,
    brand: manifest.brand,
    delivery: manifest.delivery,
    admission: manifest.admission,
    endpointOrigin: endpoint,
    endpointOrigins: [
      ...(endpoint ? [endpoint] : []),
      ...(manifest.endpointVariants ?? []).map((variant) => new URL(variant.endpoint.url).origin),
    ],
    transports: manifest.transports,
    auth: publicAuth(manifest.auth),
    authOptions: (manifest.authOptions ?? [manifest.auth]).map(publicAuth),
    baselineRisk: manifest.baselineRisk,
    defaultBindingPolicy: manifest.defaultBindingPolicy,
    docsUrl: manifest.docsUrl,
    termsUrl: manifest.termsUrl,
    privacyUrl: manifest.privacyUrl,
    notes: manifest.notes,
    connectable: providerAllowsNewConnection(manifest),
    unavailableReason: mcpProviderUnavailableReason(manifest),
  };
}
