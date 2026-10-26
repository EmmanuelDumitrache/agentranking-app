import {
  readExternalProviderCache,
  writeExternalProviderCache,
  type ExternalProviderCacheRead,
} from "@/lib/external-provider-cache";
import { modelsCatalogCacheKey, x402DescriptorCacheKey } from "@/lib/inference-providers/constants";
import { listInferenceProviders } from "@/lib/inference-providers/registry";
import type { InferenceModelCatalog, X402ServiceDescriptor } from "@/lib/inference-providers/types";
import {
  isInferenceModelCatalog,
  isX402ServiceDescriptor,
} from "@/lib/inference-providers/validation";
const FRESH_SECONDS = 6 * 60 * 60;
const STALE_SECONDS = 7 * 24 * 60 * 60;
const MAX_DESCRIPTOR_BYTES = 512 * 1024;
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
export type IndexedValue<T> = ExternalProviderCacheRead<T>;
export function loadX402DescriptorState(providerId: string): Promise<IndexedValue<X402ServiceDescriptor> | null> {
  return readExternalProviderCache({
    key: x402DescriptorCacheKey(providerId),
    validate: isX402ServiceDescriptor,
    freshTtlSeconds: FRESH_SECONDS,
    staleTtlSeconds: STALE_SECONDS,
    maxPayloadBytes: MAX_DESCRIPTOR_BYTES,
  });
}
export async function loadX402Descriptor(providerId: string): Promise<X402ServiceDescriptor | null> {
  return (await loadX402DescriptorState(providerId))?.value ?? null;
}
export async function saveX402Descriptor(descriptor: X402ServiceDescriptor): Promise<void> {
  await writeExternalProviderCache({
    key: x402DescriptorCacheKey(descriptor.providerId),
    value: descriptor,
    validate: isX402ServiceDescriptor,
    freshTtlSeconds: FRESH_SECONDS,
    staleTtlSeconds: STALE_SECONDS,
    maxPayloadBytes: MAX_DESCRIPTOR_BYTES,
  });
}
export async function loadAllIndexedX402Descriptors(): Promise<X402ServiceDescriptor[]> {
  const rows = await Promise.all(listInferenceProviders().map((provider) => loadX402Descriptor(provider.id)));
  return rows.filter((row): row is X402ServiceDescriptor => row !== null);
}
export function loadModelsCatalogState(providerId: string): Promise<IndexedValue<InferenceModelCatalog> | null> {
  return readExternalProviderCache({
    key: modelsCatalogCacheKey(providerId),
    validate: isInferenceModelCatalog,
    freshTtlSeconds: FRESH_SECONDS,
    staleTtlSeconds: STALE_SECONDS,
    maxPayloadBytes: MAX_CATALOG_BYTES,
  });
}
export async function loadModelsCatalog(providerId: string): Promise<InferenceModelCatalog | null> {
  return (await loadModelsCatalogState(providerId))?.value ?? null;
}
export async function saveModelsCatalog(catalog: InferenceModelCatalog): Promise<void> {
  await writeExternalProviderCache({
    key: modelsCatalogCacheKey(catalog.providerId),
    value: catalog,
    validate: isInferenceModelCatalog,
    freshTtlSeconds: FRESH_SECONDS,
    staleTtlSeconds: STALE_SECONDS,
    maxPayloadBytes: MAX_CATALOG_BYTES,
  });
}
export async function loadAllIndexedModelsCatalogs(): Promise<InferenceModelCatalog[]> {
  const rows = await Promise.all(listInferenceProviders().map((provider) => loadModelsCatalog(provider.id)));
  return rows.filter((row): row is InferenceModelCatalog => row !== null);
}
