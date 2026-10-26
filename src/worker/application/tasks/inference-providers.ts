import { saveModelsCatalog, saveX402Descriptor } from "@/lib/inference-providers/descriptor-store";
import { enqueueInferenceProviderRefreshBatch } from "@/lib/inference-providers/jobs";
import { fetchModelsCatalog } from "@/lib/inference-providers/models-catalog-fetch.server";
import { getInferenceProviderById, listInferenceProviders } from "@/lib/inference-providers/registry";
import { fetchX402Descriptor } from "@/lib/inference-providers/x402-descriptor";

export async function inferenceProviderScanJob(): Promise<{ enqueued: number }> {
  const providers = listInferenceProviders().filter((provider) => provider.x402Compatible);
  const ids = await enqueueInferenceProviderRefreshBatch(
    providers.map((provider) => provider.id),
  );
  return { enqueued: ids.filter(Boolean).length };
}

export async function inferenceProviderRefreshJob(providerId: string): Promise<{
  providerId: string;
  descriptor: boolean;
  catalog: boolean;
}> {
  const provider = getInferenceProviderById(providerId);
  if (!provider || !provider.x402Compatible) {
    throw new Error(`Unknown inference provider: ${providerId}`);
  }

  const descriptorResult = await Promise.allSettled([
    fetchX402Descriptor(provider.id, provider.x402DescriptorUrl),
    provider.modelsCatalogUrl
      ? fetchModelsCatalog(provider.id, provider.modelsCatalogUrl)
      : Promise.resolve(null),
  ]);
  const [descriptorSettled, catalogSettled] = descriptorResult;
  const failures: string[] = [];
  let descriptorSaved = false;
  let catalogSaved = provider.modelsCatalogUrl === null;

  if (descriptorSettled.status === "fulfilled" && descriptorSettled.value) {
    await saveX402Descriptor(descriptorSettled.value);
    descriptorSaved = true;
  } else {
    failures.push(
      descriptorSettled.status === "rejected"
        ? `descriptor: ${descriptorSettled.reason instanceof Error ? descriptorSettled.reason.message : String(descriptorSettled.reason)}`
        : "descriptor: invalid payload",
    );
  }

  if (provider.modelsCatalogUrl) {
    if (catalogSettled.status === "fulfilled" && catalogSettled.value) {
      await saveModelsCatalog(catalogSettled.value);
      catalogSaved = true;
    } else {
      failures.push(
        catalogSettled.status === "rejected"
          ? `catalog: ${catalogSettled.reason instanceof Error ? catalogSettled.reason.message : String(catalogSettled.reason)}`
          : "catalog: invalid payload",
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Inference provider ${provider.id} refresh incomplete: ${failures.join("; ")}`);
  }
  return { providerId: provider.id, descriptor: descriptorSaved, catalog: catalogSaved };
}
