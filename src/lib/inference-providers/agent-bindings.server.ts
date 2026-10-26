import "server-only";
import type { AgentLaunch } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { resolveLaunchAgentDbId } from "@/lib/agent-launch/linked-agent";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import {
  INFERENCE_PROVIDER_IDS_METADATA_KEY,
} from "@/lib/inference-providers/constants";
import {
  getInferenceProviderById,
  isKnownInferenceProviderId,
  listInferenceProviders,
} from "@/lib/inference-providers/registry";
import { readInferenceProviderIdsFromPassport } from "@/lib/inference-providers/passport";
const INFERENCE_MCP_PACKAGES_METADATA_KEY = "inference_mcp_packages";
function normalizeProviderIds(ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const trimmed = id.trim().toLowerCase();
    if (isKnownInferenceProviderId(trimmed)) out.add(trimmed);
  }
  return [...out].sort();
}
async function upsertAgentMetadata(agentDbId: number, key: string, value: string): Promise<void> {
  const existing = await prisma.agentMetadata.findFirst({
    where: { agentId: agentDbId, key },
    select: { id: true },
  });
  if (existing) {
    await prisma.agentMetadata.update({ where: { id: existing.id }, data: { value } });
    return;
  }
  await prisma.agentMetadata.create({ data: { agentId: agentDbId, key, value } });
}
type ProviderServiceEndpoint = {
  name: string;
  endpoint: string;
};
function providerServiceEndpoints(providerId: string): ProviderServiceEndpoint[] {
  const provider = getInferenceProviderById(providerId);
  if (!provider) return [];
  const endpoints: ProviderServiceEndpoint[] = [];
  if (provider.x402Compatible && provider.x402DescriptorUrl) {
    endpoints.push({ name: "X402-DISCOVERY", endpoint: provider.x402DescriptorUrl });
  }
  if (provider.mcpCompatible && provider.endpoint) {
    endpoints.push({
      name: "MCP",
      endpoint: `${provider.endpoint.replace(/\/$/, "")}/mcp`,
    });
  }
  return endpoints;
}
function serviceEndpointKey(row: ProviderServiceEndpoint): string {
  return `${row.name.trim().toUpperCase()}\0${row.endpoint.trim().toLowerCase()}`;
}
async function syncProviderServiceEndpoints(
  agentDbId: number,
  previousProviderIds: readonly string[],
  providerIds: readonly string[],
): Promise<void> {
  const existing = await prisma.agentService.findMany({
    where: { agentId: agentDbId },
    select: { id: true, name: true, endpoint: true },
  });
  const selectedEndpoints = providerIds.flatMap(providerServiceEndpoints);
  const selectedKeys = new Set(selectedEndpoints.map(serviceEndpointKey));
  const removedKeys = new Set(
    previousProviderIds
      .filter((providerId) => !providerIds.includes(providerId))
      .flatMap(providerServiceEndpoints)
      .map(serviceEndpointKey),
  );
  const staleIds = existing
    .filter((row) => {
      const key = serviceEndpointKey(row);
      return removedKeys.has(key) && !selectedKeys.has(key);
    })
    .map((row) => row.id);
  if (staleIds.length > 0) {
    await prisma.agentService.deleteMany({ where: { id: { in: staleIds } } });
  }
  const retainedKeys = new Set(
    existing
      .filter((row) => !staleIds.includes(row.id))
      .map(serviceEndpointKey),
  );
  for (const endpoint of selectedEndpoints) {
    const key = serviceEndpointKey(endpoint);
    if (retainedKeys.has(key)) continue;
    await prisma.agentService.create({
      data: {
        agentId: agentDbId,
        name: endpoint.name,
        endpoint: endpoint.endpoint,
        version: "1.0",
      },
    });
    retainedKeys.add(key);
  }
}
async function loadMetadataStringArray(agentDbId: number, key: string): Promise<string[]> {
  const row = await prisma.agentMetadata.findFirst({
    where: { agentId: agentDbId, key },
    select: { value: true },
  });
  if (!row?.value?.trim()) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
export async function loadAgentInferenceProviderIds(agentDbId: number): Promise<string[]> {
  return normalizeProviderIds(
    await loadMetadataStringArray(agentDbId, INFERENCE_PROVIDER_IDS_METADATA_KEY),
  );
}
async function loadPreviouslyAppliedProviderIds(agentDbId: number): Promise<string[]> {
  const [selectedIds, stalePackages] = await Promise.all([
    loadAgentInferenceProviderIds(agentDbId),
    loadMetadataStringArray(agentDbId, INFERENCE_MCP_PACKAGES_METADATA_KEY),
  ]);
  const stalePackageSet = new Set(stalePackages.map((pkg) => pkg.trim()).filter(Boolean));
  return normalizeProviderIds([
    ...selectedIds,
    ...listInferenceProviders()
      .filter((provider) => {
        const mcpPackage = provider.metadata.mcpPackage?.trim();
        return Boolean(mcpPackage && stalePackageSet.has(mcpPackage));
      })
      .map((provider) => provider.id),
  ]);
}
export async function applyInferenceProvidersToAgent(
  agentDbId: number,
  providerIds: readonly string[],
): Promise<{ providerIds: string[] }> {
  const normalized = normalizeProviderIds(providerIds);
  const previousProviderIds = await loadPreviouslyAppliedProviderIds(agentDbId);
  const mcpPackages = normalized
    .map((id) => getInferenceProviderById(id)?.metadata.mcpPackage)
    .filter((pkg): pkg is string => Boolean(pkg?.trim()));
  await syncProviderServiceEndpoints(agentDbId, previousProviderIds, normalized);
  await upsertAgentMetadata(
    agentDbId,
    INFERENCE_PROVIDER_IDS_METADATA_KEY,
    JSON.stringify(normalized),
  );
  await upsertAgentMetadata(
    agentDbId,
    INFERENCE_MCP_PACKAGES_METADATA_KEY,
    JSON.stringify([...new Set(mcpPackages)]),
  );
  await revalidateAgentByDbId(agentDbId);
  return { providerIds: normalized };
}
export async function syncInferenceProvidersFromLaunch(
  launch: Pick<AgentLaunch, "passportJson" | "agentDbId" | "agentId">,
): Promise<void> {
  const agentDbId = resolveLaunchAgentDbId(launch);
  if (!agentDbId) return;
  const providerIds = readInferenceProviderIdsFromPassport(launch.passportJson);
  await applyInferenceProvidersToAgent(agentDbId, providerIds);
}