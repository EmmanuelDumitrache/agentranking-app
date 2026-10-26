import type { InferenceProviderDefinition } from "@/lib/inference-providers/types";

const OPENVECTA: InferenceProviderDefinition = {
  id: "openvecta",
  name: "OpenVecta",
  description: "x402 compatible inference layer for autonomous agents",
  type: "inference-gateway",
  capabilities: ["llm-inference", "embeddings", "mcp-tools", "agent-services", "openai-compatible"],
  endpoint: "https://api.openvecta.com",
  x402DescriptorUrl: "https://api.openvecta.com/.well-known/x402",
  modelsCatalogUrl: "https://api.openvecta.com/models",
  x402Compatible: true,
  mcpCompatible: true,
  metadata: {
    homepage: "https://openvecta.com",
    docs: "https://docs.openvecta.com",
    x402Docs: "https://docs.openvecta.com/docs/x402",
    modelsCatalog: "https://api.openvecta.com/models",
    mcpPackage: "@openvecta/mcp",
  },
  matchHosts: ["openvecta.com", "api.openvecta.com"],
};

/** Static catalog — extend with Together, Groq, OpenAI, Anthropic, etc. */
export const INFERENCE_PROVIDER_REGISTRY: readonly InferenceProviderDefinition[] = [OPENVECTA];

const BY_ID = new Map(INFERENCE_PROVIDER_REGISTRY.map((p) => [p.id, p]));

export function getInferenceProviderById(id: string): InferenceProviderDefinition | undefined {
  return BY_ID.get(id.trim().toLowerCase());
}

export function listInferenceProviders(): readonly InferenceProviderDefinition[] {
  return INFERENCE_PROVIDER_REGISTRY;
}

export function isKnownInferenceProviderId(id: string): boolean {
  return BY_ID.has(id.trim().toLowerCase());
}
