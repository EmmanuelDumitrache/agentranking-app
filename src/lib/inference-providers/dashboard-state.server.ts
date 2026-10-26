import "server-only";
import {
  loadAgentInferenceProviderIds,
} from "@/lib/inference-providers/agent-bindings.server";
import {
  loadModelsCatalogState,
  loadX402DescriptorState,
} from "@/lib/inference-providers/descriptor-store";
import { enqueueInferenceProviderRefresh } from "@/lib/inference-providers/jobs";
import { listChatModelsFromCatalog } from "@/lib/inference-providers/models-catalog";
import {
  getInferenceProviderById,
  listInferenceProviders,
} from "@/lib/inference-providers/registry";

const MAX_DASHBOARD_MODELS = 250;

export type DashboardInferenceState = {
  providerIds: string[];
  providers: Array<{
    id: string;
    name: string;
    description: string;
    endpoint: string;
    x402DescriptorUrl: string;
    mcpPackage: string | null;
    docsUrl: string | null;
  }>;
  catalog: Array<{
    id: string;
    name: string;
    description: string;
    x402Compatible: boolean;
    mcpCompatible: boolean;
  }>;
  x402Descriptor: {
    fetchedAt: string;
    endpointCount: number;
    capabilities: string[];
  } | null;
  modelsCatalog: {
    fetchedAt: string;
    sourceUrl: string;
    modelCount: number;
    models: Array<{
      id: string;
      tier: string | null;
      inputPerMtok: number | null;
      outputPerMtok: number | null;
      freeEligible: boolean;
    }>;
  } | null;
};

export async function loadDashboardInferenceState(
  agentDbId: number,
): Promise<DashboardInferenceState> {
  const providerIds = await loadAgentInferenceProviderIds(agentDbId);
  const providers = providerIds
    .map((id) => getInferenceProviderById(id))
    .filter((row): row is NonNullable<typeof row> => row != null)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      endpoint: provider.endpoint,
      x402DescriptorUrl: provider.x402DescriptorUrl,
      mcpPackage: provider.metadata.mcpPackage ?? null,
      docsUrl: provider.metadata.docs ?? null,
    }));
  const payload: DashboardInferenceState = {
    providerIds,
    providers,
    catalog: listInferenceProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      x402Compatible: provider.x402Compatible,
      mcpCompatible: provider.mcpCompatible,
    })),
    x402Descriptor: null,
    modelsCatalog: null,
  };
  const primaryId = providerIds[0] ?? null;
  if (!primaryId) return payload;

  const [descriptorState, catalogState] = await Promise.all([
    loadX402DescriptorState(primaryId),
    loadModelsCatalogState(primaryId),
  ]);
  if (descriptorState) {
    payload.x402Descriptor = {
      fetchedAt: descriptorState.value.fetchedAt,
      endpointCount: descriptorState.value.endpoints.length,
      capabilities: descriptorState.value.capabilities,
    };
  }
  if (catalogState) {
    const chatModels = listChatModelsFromCatalog(catalogState.value);
    payload.modelsCatalog = {
      fetchedAt: catalogState.value.fetchedAt,
      sourceUrl: catalogState.value.sourceUrl,
      modelCount: chatModels.length,
      models: chatModels.slice(0, MAX_DASHBOARD_MODELS).map((model) => ({
        id: model.id,
        tier: model.tier,
        inputPerMtok: model.inputPerMtok,
        outputPerMtok: model.outputPerMtok,
        freeEligible: model.freeEligible,
      })),
    };
  }

  const provider = getInferenceProviderById(primaryId);
  const catalogNeedsRefresh = Boolean(provider?.modelsCatalogUrl)
    && (!catalogState || catalogState.status === "stale");
  if (!descriptorState || descriptorState.status === "stale" || catalogNeedsRefresh) {
    void enqueueInferenceProviderRefresh(primaryId).catch((error: unknown) => {
      console.warn("[dashboard/inference-providers] enqueue failed", error);
    });
  }
  return payload;
}
