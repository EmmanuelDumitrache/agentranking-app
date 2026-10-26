import { getInferenceProviderById } from "@/lib/inference-providers/registry";
import type { InferenceProviderDefinition } from "@/lib/inference-providers/types";

export type AgentPassportInference = {
  providerId: string | null;
  providerName: string | null;
  endpoint: string | null;
  x402DescriptorUrl: string | null;
  mcpPackage: string | null;
  mcpCompatible: boolean;
  x402Compatible: boolean;
};

export function emptyPassportInference(): AgentPassportInference {
  return {
    providerId: null,
    providerName: null,
    endpoint: null,
    x402DescriptorUrl: null,
    mcpPackage: null,
    mcpCompatible: false,
    x402Compatible: false,
  };
}

export function passportInferenceFromProvider(
  provider: InferenceProviderDefinition,
): AgentPassportInference {
  return {
    providerId: provider.id,
    providerName: provider.name,
    endpoint: provider.endpoint,
    x402DescriptorUrl: provider.x402DescriptorUrl,
    mcpPackage: provider.metadata.mcpPackage ?? null,
    mcpCompatible: provider.mcpCompatible,
    x402Compatible: provider.x402Compatible,
  };
}

export function parsePassportInferenceOverride(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const providerId = (raw as { providerId?: unknown }).providerId;
  return typeof providerId === "string" && providerId.trim() ? providerId.trim().toLowerCase() : null;
}

export function resolvePassportInference(
  override: unknown,
): AgentPassportInference {
  const providerId = parsePassportInferenceOverride(override);
  if (!providerId) return emptyPassportInference();
  const provider = getInferenceProviderById(providerId);
  if (!provider) return emptyPassportInference();
  return passportInferenceFromProvider(provider);
}

export function readInferenceProviderIdsFromPassport(passport: unknown): string[] {
  if (!passport || typeof passport !== "object") return [];
  const inference = (passport as { inference?: unknown }).inference;
  const providerId = parsePassportInferenceOverride(inference);
  return providerId ? [providerId] : [];
}
