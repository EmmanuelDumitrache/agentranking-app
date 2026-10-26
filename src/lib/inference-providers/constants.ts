/** Explicit agent ↔ inference provider bindings (JSON string[] in AgentMetadata). */
export const INFERENCE_PROVIDER_IDS_METADATA_KEY = "inference_provider_ids";

export function x402DescriptorCacheKey(providerId: string): string {
  return `inference:x402_descriptor:${providerId}`;
}

export function modelsCatalogCacheKey(providerId: string): string {
  return `inference:models_catalog:${providerId}`;
}
