import { INFERENCE_PROVIDER_IDS_METADATA_KEY } from "@/lib/inference-providers/constants";
import {
  getInferenceProviderById,
  INFERENCE_PROVIDER_REGISTRY,
  isKnownInferenceProviderId,
} from "@/lib/inference-providers/registry";
import type { AgentCapabilitiesInput, AgentCapabilitiesPayload } from "@/lib/inference-providers/types";

function parseMetadataJsonArray(metadata: AgentCapabilitiesInput["metadata"], key: string): string[] {
  const row = metadata?.find((m) => m.key === key);
  if (!row?.value?.trim()) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function metadataJsonArray(metadata: AgentCapabilitiesInput["metadata"], key: string): string[] {
  const row = metadata?.find((m) => m.key === key);
  if (!row?.value?.trim()) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return row.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

function collectEndpointUrls(agent: AgentCapabilitiesInput): string[] {
  const urls: string[] = [];
  for (const service of agent.services ?? []) {
    const endpoint = service.endpoint?.trim();
    if (endpoint) urls.push(endpoint);
  }
  const sapX402 = agent.sapX402Endpoint?.trim();
  if (sapX402) urls.push(sapX402);
  return urls;
}

function hostMatchesProvider(url: string, hosts: readonly string[]): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return hosts.some((host) => url.toLowerCase().includes(host));
  }
}

function inferInferenceProviders(agent: AgentCapabilitiesInput): string[] {
  const ids = new Set<string>();

  for (const id of parseMetadataJsonArray(agent.metadata, INFERENCE_PROVIDER_IDS_METADATA_KEY)) {
    if (isKnownInferenceProviderId(id)) ids.add(id.trim().toLowerCase());
  }

  const endpoints = collectEndpointUrls(agent);
  for (const provider of INFERENCE_PROVIDER_REGISTRY) {
    if (endpoints.some((url) => hostMatchesProvider(url, provider.matchHosts))) {
      ids.add(provider.id);
    }
  }

  return [...ids].sort();
}

function deriveProtocols(agent: AgentCapabilitiesInput): string[] {
  const protocols = new Set<string>();

  const hasMcp =
    agent.identity?.summary?.mcpEnabled === true ||
    metadataJsonArray(agent.metadata, "mcpTools").length > 0 ||
    (agent.services ?? []).some((s) => s.name.trim().toUpperCase() === "MCP" && s.endpoint.trim());

  if (hasMcp) protocols.add("mcp");

  const hasX402 =
    agent.x402Support === true ||
    agent.publicTrustFlags?.x402Detected === true ||
    agent.publicTrustFlags?.x402Payable === true ||
    Boolean(agent.sapX402Endpoint?.trim()) ||
    (agent.services ?? []).some((s) => {
      const name = s.name.trim().toUpperCase();
      return (name === "X402" || name.startsWith("X402-")) && s.endpoint.trim();
    });

  if (hasX402) protocols.add("x402");

  if (metadataJsonArray(agent.metadata, "a2aSkills").length > 0) protocols.add("a2a");
  if ((agent.sapProtocols ?? []).some((p) => p.toLowerCase().includes("mcp"))) protocols.add("mcp");
  if ((agent.sapProtocols ?? []).some((p) => p.toLowerCase() === "x402")) protocols.add("x402");

  return [...protocols].sort();
}

export function deriveAgentCapabilities(agent: AgentCapabilitiesInput): AgentCapabilitiesPayload {
  return {
    inferenceProviders: inferInferenceProviders(agent),
    protocols: deriveProtocols(agent),
  };
}

export function enrichCapabilitiesWithProviderNames(
  payload: AgentCapabilitiesPayload,
): Array<{ id: string; name: string }> {
  return payload.inferenceProviders
    .map((id) => {
      const provider = getInferenceProviderById(id);
      return provider ? { id: provider.id, name: provider.name } : null;
    })
    .filter((row): row is { id: string; name: string } => row != null);
}
