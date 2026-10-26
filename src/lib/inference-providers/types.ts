export const INFERENCE_PROVIDER_TYPES = [
  "inference-gateway",
  "hosted-mcp",
  "model-host",
] as const;

export type InferenceProviderType = (typeof INFERENCE_PROVIDER_TYPES)[number];

export type InferenceProviderCapability =
  | "llm-inference"
  | "embeddings"
  | "mcp-tools"
  | "agent-services"
  | "openai-compatible";

export type InferenceProviderDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: InferenceProviderType;
  readonly capabilities: readonly InferenceProviderCapability[];
  readonly endpoint: string;
  readonly x402DescriptorUrl: string;
  /** Live model catalog with per-token pricing (e.g. OpenVecta /models). */
  readonly modelsCatalogUrl: string | null;
  readonly x402Compatible: boolean;
  readonly mcpCompatible: boolean;
  readonly metadata: Readonly<Record<string, string>>;
  /** Hostnames used to infer agent ↔ provider bindings from service URLs. */
  readonly matchHosts: readonly string[];
};

export type X402DescriptorEndpoint = {
  path: string;
  method: string;
  type: string;
  pricingModel: string | null;
  flatFeeUsd: number | null;
  modelCount: number;
};

export type InferenceModelCatalogEntry = {
  id: string;
  provider: string | null;
  modality: string | null;
  tier: string | null;
  freeEligible: boolean;
  inputPerMtok: number | null;
  outputPerMtok: number | null;
  flatFeeUsd: number | null;
};

export type InferenceModelCatalog = {
  providerId: string;
  fetchedAt: string;
  sourceUrl: string;
  models: InferenceModelCatalogEntry[];
  raw: Record<string, unknown>;
};

export type X402ServiceDescriptor = {
  providerId: string;
  fetchedAt: string;
  sourceUrl: string;
  name: string;
  description: string;
  homepage: string | null;
  docs: string | null;
  x402Version: number | null;
  endpoints: X402DescriptorEndpoint[];
  capabilities: string[];
  paymentChains: string[];
  raw: Record<string, unknown>;
};

export type AgentCapabilitiesPayload = {
  inferenceProviders: string[];
  protocols: string[];
};

export type AgentCapabilitiesInput = {
  metadata?: Array<{ key: string; value: string }>;
  services?: Array<{ name: string; endpoint: string }>;
  x402Support?: boolean;
  sapX402Endpoint?: string | null;
  sapProtocols?: string[] | null;
  publicTrustFlags?: {
    x402Detected?: boolean;
    x402Payable?: boolean;
  } | null;
  identity?: {
    summary?: { mcpEnabled?: boolean };
  } | null;
};
