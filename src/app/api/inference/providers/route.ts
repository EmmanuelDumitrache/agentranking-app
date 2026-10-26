import { NextRequest, NextResponse } from "next/server";
import {
  loadModelsCatalogState,
  loadX402DescriptorState,
} from "@/lib/inference-providers/descriptor-store";
import { enqueueInferenceProviderScan } from "@/lib/inference-providers/jobs";
import {
  getInferenceProviderById,
  listInferenceProviders,
} from "@/lib/inference-providers/registry";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
export const dynamic = "force-dynamic";
const MAX_PUBLIC_MODELS = 250;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
};
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
export async function GET(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  const requestedProviderId = request.nextUrl.searchParams.get("provider")?.trim().toLowerCase() ?? "";
  const includeModels = request.nextUrl.searchParams.get("includeModels") === "1";
  if (requestedProviderId && !/^[a-z0-9_-]{1,80}$/.test(requestedProviderId)) {
    return NextResponse.json({ error: "Invalid provider id" }, { status: 400, headers: CORS_HEADERS });
  }
  if (requestedProviderId && !getInferenceProviderById(requestedProviderId)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404, headers: CORS_HEADERS });
  }
  if (includeModels && !requestedProviderId) {
    return NextResponse.json(
      { error: "provider is required when includeModels=1" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const providers = listInferenceProviders().filter(
    (provider) => !requestedProviderId || provider.id === requestedProviderId,
  );
  const states = await Promise.all(providers.map(async (provider) => ({
    provider,
    descriptor: await loadX402DescriptorState(provider.id),
    catalog: await loadModelsCatalogState(provider.id),
  })));
  if (states.some((state) => !state.descriptor || state.descriptor.status === "stale"
      || (state.provider.modelsCatalogUrl && (!state.catalog || state.catalog.status === "stale")))) {
    try {
      await enqueueInferenceProviderScan();
    } catch (error) {
      console.warn("[inference/providers] enqueue failed", error);
    }
  }
  return NextResponse.json({
    data: {
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        description: provider.description,
        type: provider.type,
        capabilities: provider.capabilities,
        endpoint: provider.endpoint,
        x402Compatible: provider.x402Compatible,
        mcpCompatible: provider.mcpCompatible,
        x402DescriptorUrl: provider.x402DescriptorUrl,
        modelsCatalogUrl: provider.modelsCatalogUrl,
        metadata: provider.metadata,
      })),
      x402Descriptors: states.flatMap(({ descriptor }) => descriptor ? [{
        providerId: descriptor.value.providerId,
        fetchedAt: descriptor.value.fetchedAt,
        sourceUrl: descriptor.value.sourceUrl,
        name: descriptor.value.name,
        description: descriptor.value.description,
        homepage: descriptor.value.homepage,
        docs: descriptor.value.docs,
        x402Version: descriptor.value.x402Version,
        endpoints: descriptor.value.endpoints,
        capabilities: descriptor.value.capabilities,
        paymentChains: descriptor.value.paymentChains,
        cacheStatus: descriptor.status,
      }] : []),
      modelCatalogs: states.flatMap(({ catalog }) => catalog ? [{
        providerId: catalog.value.providerId,
        fetchedAt: catalog.value.fetchedAt,
        sourceUrl: catalog.value.sourceUrl,
        modelCount: catalog.value.models.length,
        models: includeModels ? catalog.value.models.slice(0, MAX_PUBLIC_MODELS) : undefined,
        truncated: includeModels && catalog.value.models.length > MAX_PUBLIC_MODELS,
        cacheStatus: catalog.status,
      }] : []),
    },
  }, { headers: CORS_HEADERS });
}
