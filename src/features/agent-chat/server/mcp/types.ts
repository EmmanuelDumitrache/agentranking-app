export type McpAuthMode =
  | "NONE"
  | "BEARER_TOKEN"
  | "API_KEY_HEADER"
  | "API_KEY_QUERY"
  | "API_KEY_TOOL_ARGUMENT"
  | "OAUTH2_AUTHORIZATION_CODE"
  | "OAUTH2_CLIENT_CREDENTIALS";
export type McpTransportMode = "STREAMABLE_HTTP" | "LEGACY_SSE";
export type McpResolvedTransport = McpTransportMode;
export type McpApprovalMode =
  | "AUTO_READ_ONLY"
  | "CONFIRM_MUTATIONS"
  | "CONFIRM_EVERY_CALL"
  | "BLOCK_ALL";
export type McpConnectionStatus =
  | "DRAFT"
  | "AUTH_PENDING"
  | "VERIFYING"
  | "READY"
  | "DEGRADED"
  | "REAUTH_REQUIRED"
  | "INVALID"
  | "BLOCKED"
  | "DISABLED"
  | "DELETED";
export type McpToolRisk =
  | "READ_ONLY"
  | "ANALYTICS_QUERY"
  | "TRANSACTION_PREPARE"
  | "WRITE_OFFCHAIN"
  | "TRADE"
  | "SIGN"
  | "BROADCAST"
  | "PAYMENT"
  | "CUSTODY"
  | "INFRA_ADMIN"
  | "UNKNOWN";

export type McpJsonSchema = Record<string, unknown>;

export type McpCredentialRecord = {
  id: string;
  connectionId: string;
  appAccountId: string;
  encryptedSecret: string;
  encryptionKeyId: string;
  encryptionVersion: number;
  fingerprint: string;
};

export type McpToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: McpJsonSchema;
  outputSchema?: McpJsonSchema;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    [key: string]: unknown;
  };
  execution?: Record<string, unknown>;
  icons?: unknown;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

export type McpCatalogRecord = {
  connectionId: string;
  protocolEra: string | null;
  protocolVersion: string | null;
  serverInfoJson: unknown;
  capabilitiesJson: unknown;
  discoverJson: unknown;
  instructions: string | null;
  toolsJson: unknown;
  resourcesJson: unknown;
  resourceTemplatesJson: unknown;
  promptsJson: unknown;
  toolsDigest: string;
  endpointSnapshot: string;
  principalDigest: string | null;
  fetchedAt: Date;
  validUntil: Date | null;
};

export type McpToolDescriptorRecord = {
  id: string;
  connectionId: string;
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: unknown;
  outputSchema: unknown;
  schemaHash: string;
  previousSchemaHash: string | null;
  annotationsSnapshot: unknown;
  providerRisk: McpToolRisk | null;
  inferredRisk: McpToolRisk;
  effectiveRisk: McpToolRisk;
  riskReason: string | null;
  active: boolean;
  quarantined: boolean;
  quarantineReason: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  removedAt: Date | null;
  revision: number;
};

export type McpToolPolicyRecord = {
  id: string;
  bindingId: string;
  connectionId: string;
  toolId: string;
  enabled: boolean;
  approvalMode: McpApprovalMode | null;
  maxCallsPerRun: number | null;
  inputConstraint: unknown;
  acknowledgedSchemaHash: string | null;
};

export type McpBindingRecord = {
  id: string;
  appAccountId: string;
  agentDbId: number;
  connectionId: string;
  enabled: boolean;
  approvalMode: McpApprovalMode;
  maxCallsPerRun: number;
  maxParallelCalls: number;
  callTimeoutMs: number;
  outputByteLimit: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  toolPolicies?: McpToolPolicyRecord[];
};

export type McpAuditRecord = {
  id: string;
  action: string;
  status: string;
  reasonCode: string | null;
  metadataJson: unknown;
  createdAt: Date;
};

export type McpConnectionRecord = {
  id: string;
  appAccountId: string;
  providerKey: string | null;
  runtimeKey: string;
  displayName: string;
  endpointUrl: string;
  endpointOrigin: string;
  endpointHost: string;
  endpointFingerprint: string;
  authMode: McpAuthMode;
  transportMode: McpTransportMode;
  lastSuccessfulTransport: McpResolvedTransport | null;
  status: McpConnectionStatus;
  statusReasonCode: string | null;
  statusMessage: string | null;
  serverName: string | null;
  serverVersion: string | null;
  serverIdentityHash: string | null;
  protocolVersion: string | null;
  catalogRevision: number;
  catalogHash: string | null;
  manifestVersion: number | null;
  version: number;
  lastVerifiedAt: Date | null;
  lastDiscoveredAt: Date | null;
  lastHealthyAt: Date | null;
  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  lastErrorText: string | null;
  consecutiveFailures: number;
  circuitOpenedAt: Date | null;
  circuitOpenUntil: Date | null;
  disabledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  credential: McpCredentialRecord | null;
  catalog: McpCatalogRecord | null;
  tools?: McpToolDescriptorRecord[];
  bindings?: McpBindingRecord[];
  auditLogs?: McpAuditRecord[];
};

export type McpCatalogSnapshot = {
  protocolEra: string | null;
  protocolVersion: string | null;
  serverInfo: unknown;
  capabilities: unknown;
  discover: unknown;
  instructions: string | null;
  tools: McpToolDefinition[];
  resources: unknown[] | null;
  resourceTemplates: unknown[] | null;
  prompts: unknown[] | null;
  toolsDigest: string;
  endpointSnapshot: string;
  principalDigest: string | null;
  fetchedAt: Date;
  validUntil: Date | null;
};

export type RuntimeMcpToolMetadata = {
  source: "mcp";
  kind: "server_tool" | "runtime_utility";
  connectionId: string;
  providerKey?: string | null;
  bindingId?: string;
  descriptorId?: string;
  catalogRevision?: number;
  schemaHash?: string;
  effectiveRisk?: McpToolRisk;
  serverName: string;
  externalToolName: string;
  title: string;
  description: string;
  approvalMode: McpApprovalMode;
  stateChanging: boolean;
  resolveExecutionSource?: (input: unknown) => {
    connectionId: string;
    providerKey?: string | null;
    bindingId?: string;
    descriptorId?: string;
    catalogRevision?: number;
    schemaHash?: string;
    effectiveRisk?: McpToolRisk;
    approvalMode?: McpApprovalMode;
    serverName: string;
    externalToolName: string;
  } | null;
};

export type McpInputRequiredToolResult = {
  ok: false;
  status: "input_required";
  continuationId: string;
  source: {
    kind: "mcp";
    connectionId: string;
    bindingId?: string;
    serverName: string;
    operation: "tools/call" | "resources/read" | "prompts/get";
  };
  requests: Array<
    | {
        requestKey: string;
        type: "elicitation";
        mode: "form";
        message: string;
        requestedSchema: McpJsonSchema;
      }
    | {
        requestKey: string;
        type: "elicitation";
        mode: "url";
        message: string;
        url: string;
      }
  >;
};

export type McpBearerSecret = { kind: "bearer"; token: string };
export type McpApiKeyHeaderSecret = {
  kind: "api-key-header";
  headerName: string;
  value: string;
  prefix?: string;
};
export type McpApiKeyPlacementSecret = {
  kind: "api-key-query" | "api-key-tool-argument";
  name: string;
  value: string;
};
export type McpClientCredentialsSecret = {
  kind: "client_credentials";
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  scope?: string;
  expectedIssuer: string;
};
export type McpOAuthSecret = {
  kind: "oauth";
  authorizationContextId?: string;
  clientInformation?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  tokensSavedAt?: string;
  codeVerifier?: string;
  discoveryState?: Record<string, unknown>;
  resourceUrl?: string;
};
export type McpStoredSecret =
  | McpBearerSecret
  | McpApiKeyHeaderSecret
  | McpApiKeyPlacementSecret
  | McpClientCredentialsSecret
  | McpOAuthSecret;
