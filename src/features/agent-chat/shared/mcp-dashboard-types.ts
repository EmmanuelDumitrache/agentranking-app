export type DashboardMcpRisk =
  | "READ_ONLY"
  | "ANALYTICS_QUERY"
  | "TRANSACTION_PREPARE"
  | "WRITE_OFFCHAIN"
  | "INFRA_ADMIN"
  | "TRADE"
  | "SIGN"
  | "BROADCAST"
  | "PAYMENT"
  | "CUSTODY"
  | "UNKNOWN";

export type DashboardMcpApprovalMode =
  | "AUTO_READ_ONLY"
  | "CONFIRM_MUTATIONS"
  | "CONFIRM_EVERY_CALL"
  | "BLOCK_ALL";

export type DashboardMcpProviderAuth = {
  kind:
    | "none"
    | "bearer"
    | "api-key-header"
    | "api-key-query"
    | "api-key-tool-argument"
    | "oauth2"
    | "client-credentials";
  headerName?: string;
  parameterName?: string;
  argumentName?: string;
  prefix?: string;
  scopes?: readonly string[];
};

export type DashboardMcpProvider = {
  key: string;
  manifestVersion: number;
  displayName: string;
  publisherName: string;
  summary: string;
  categories: readonly string[];
  chainFamilies: readonly string[];
  chains: readonly string[];
  capabilityClasses: readonly (
    | "READ_ONLY"
    | "ANALYTICS_QUERY"
    | "SIMULATION"
    | "TRANSACTION_PREP"
    | "WALLET_APPROVAL"
    | "TRADING"
    | "PAID_CALLS"
    | "ACCOUNT_ADMIN"
  )[];
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  billingModel: "FREE" | "FREEMIUM" | "USAGE_BASED" | "PAID_PLAN" | "ENTERPRISE" | "PAID_CALLS" | "UNKNOWN";
  releaseStage: "GA" | "BETA" | "EARLY_ACCESS" | "EXPERIMENTAL" | "WATCHLIST";
  priority: "P0" | "P1" | "P2" | "ACTION" | "WATCH";
  credentialFields: readonly {
    key: "apiKey" | "bearerToken" | "oauth" | "clientId" | "clientSecret";
    label: string;
    secret: boolean;
    required: boolean;
    helpText?: string;
  }[];
  toolAllowlistSupport: boolean;
  requiresUserConfirmation: boolean;
  reviewedAt: string;
  brand: {
    mark: string;
    foreground: string;
    background: string;
    iconUrl?: string;
  };
  delivery: string;
  admission: string;
  endpointOrigin: string | null;
  endpointOrigins: readonly string[];
  transports: readonly string[];
  auth: DashboardMcpProviderAuth;
  authOptions: readonly DashboardMcpProviderAuth[];
  baselineRisk: DashboardMcpRisk;
  defaultBindingPolicy: {
    approvalMode: DashboardMcpApprovalMode;
    maxCallsPerRun: number;
    maxParallelCalls: number;
  };
  docsUrl: string;
  termsUrl?: string;
  privacyUrl?: string;
  notes?: string;
  connectable: boolean;
  unavailableReason: string | null;
};

export type DashboardMcpBinding = {
  id: string;
  enabled: boolean;
  approvalMode: DashboardMcpApprovalMode;
  maxCallsPerRun: number;
  maxParallelCalls: number;
  callTimeoutMs: number;
  outputByteLimit: number;
  version: number;
  overriddenToolCount: number;
};

export type DashboardMcpConnection = {
  id: string;
  runtimeKey: string;
  displayName: string;
  providerKey: string | null;
  provider: DashboardMcpProvider | null;
  unreviewed: boolean;
  providerManifestMissing: boolean;
  endpointOrigin: string;
  endpointHost: string;
  transport: "STREAMABLE_HTTP" | "LEGACY_SSE";
  status: string;
  statusReasonCode: string | null;
  statusMessage: string | null;
  credential: {
    configured: boolean;
    kind: string;
    authMode: string;
    label: string;
    fingerprintSuffix?: string | null;
    maskedIdentifier?: string;
    reauthRequired?: boolean;
    expiresAt?: Date | string | null;
  };
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  catalogRevision: number;
  catalogHash: string | null;
  catalogFetchedAt: Date | string | null;
  catalogValidUntil: Date | string | null;
  toolSummary: {
    counts: Record<DashboardMcpRisk, number>;
    highestRisk: DashboardMcpRisk | null;
    active: number;
    quarantined: number;
    removed: number;
  };
  attachedAgents: Array<{
    id: number;
    name: string;
    image: string;
    bindingId: string;
    enabled: boolean;
  }>;
  attachedAgentCount?: number;
  lastVerifiedAt: Date | string | null;
  lastDiscoveredAt: Date | string | null;
  lastHealthyAt: Date | string | null;
  consecutiveFailures: number;
  disabledAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  version: number;
  recentEvents: Array<{
    id: string;
    action: string;
    status: string;
    reasonCode: string | null;
    metadata: Record<string, string | number | boolean> | null;
    createdAt: Date | string;
  }>;
};

export type DashboardAgentMcpItem = {
  connection: DashboardMcpConnection;
  binding: DashboardMcpBinding | null;
  canEnable: boolean;
  enableBlockedReason?: string;
  enableBlockedCode?: string;
  enabledToolCount: number;
  highestEnabledRisk: DashboardMcpRisk | null;
};

export type DashboardMcpTool = {
  id: string;
  name: string;
  title: string | null;
  description: string | null;
  effectiveRisk: DashboardMcpRisk;
  inferredRisk: DashboardMcpRisk;
  providerRisk: DashboardMcpRisk | null;
  riskReason: string | null;
  active: boolean;
  quarantined: boolean;
  quarantineAcknowledged: boolean;
  quarantineReason: string | null;
  platformBlocked: boolean;
  schemaHash: string;
  previousSchemaHash: string | null;
  revision: number;
  schemaChanged: boolean;
  enabled: boolean;
  approvalMode: DashboardMcpApprovalMode;
  inheritedApproval: boolean;
  maxCallsPerRun: number;
  acknowledgedSchemaHash: string | null;
  inputSummary: { type: string; required: string[]; fields: string[] };
  outputSummary: { type: string; fields: string[] } | null;
  lastDiscoveredAt: Date | string;
};
