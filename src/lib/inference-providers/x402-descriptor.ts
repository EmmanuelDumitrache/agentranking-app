import { fetchPublicJson } from "@/lib/outbound-http";
import { sanitizeBoundedJson } from "@/lib/inference-providers/validation";
import type { X402DescriptorEndpoint, X402ServiceDescriptor } from "@/lib/inference-providers/types";
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function parseEndpoint(row: unknown): X402DescriptorEndpoint | null {
  const obj = asRecord(row);
  if (!obj) return null;
  const path = asString(obj.path);
  if (!path) return null;
  const models = Array.isArray(obj.models) ? obj.models : [];
  return {
    path,
    method: asString(obj.method) ?? "GET",
    type: asString(obj.type) ?? "unknown",
    pricingModel: asString(obj.pricing_model),
    flatFeeUsd: asNumber(obj.flat_fee_usd),
    modelCount: models.length,
  };
}
function paymentChainsFromDescriptor(raw: Record<string, unknown>): string[] {
  const chains = new Set<string>();
  const settlement = asRecord(raw.settlement);
  const settlementChain = asString(settlement?.chain);
  if (settlementChain) chains.add(settlementChain);
  const endpoints = Array.isArray(raw.endpoints) ? raw.endpoints : [];
  for (const endpoint of endpoints) {
    const ep = asRecord(endpoint);
    const accepts = Array.isArray(ep?.accepts) ? ep.accepts : [];
    for (const accept of accepts) {
      const network = asString(asRecord(accept)?.network);
      if (network) chains.add(network);
    }
  }
  return [...chains];
}
function capabilitiesFromDescriptor(raw: Record<string, unknown>): string[] {
  const caps = new Set<string>();
  const endpoints = Array.isArray(raw.endpoints) ? raw.endpoints : [];
  for (const endpoint of endpoints) {
    const ep = asRecord(endpoint);
    const type = asString(ep?.type);
    if (type) caps.add(type);
    const models = Array.isArray(ep?.models) ? ep.models : [];
    if (models.length > 0) caps.add("llm-inference");
  }
  const auth = asRecord(raw.auth);
  const current = Array.isArray(auth?.current) ? auth.current : [];
  for (const item of current) {
    const s = asString(item);
    if (s) caps.add(s);
  }
  if (raw.x402Version != null) caps.add("x402");
  return [...caps];
}
export function normalizeX402Descriptor(
  providerId: string,
  sourceUrl: string,
  raw: unknown,
  fetchedAt: Date = new Date(),
): X402ServiceDescriptor | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const endpoints = (Array.isArray(obj.endpoints) ? obj.endpoints : [])
    .slice(0, 128)
    .map(parseEndpoint)
    .filter((row): row is X402DescriptorEndpoint => row != null);
  return {
    providerId,
    fetchedAt: fetchedAt.toISOString(),
    sourceUrl,
    name: asString(obj.name) ?? providerId,
    description: asString(obj.description) ?? "",
    homepage: asString(obj.homepage),
    docs: asString(obj.docs),
    x402Version: asNumber(obj.x402Version),
    endpoints,
    capabilities: capabilitiesFromDescriptor(obj),
    paymentChains: paymentChainsFromDescriptor(obj),
    raw: sanitizeBoundedJson(obj) as Record<string, unknown>,
  };
}
export async function fetchX402Descriptor(
  providerId: string,
  descriptorUrl: string,
): Promise<X402ServiceDescriptor | null> {
  const json = await fetchPublicJson<unknown>(descriptorUrl, {
    timeoutMs: 15_000,
    maxResponseBytes: 512 * 1024,
    headers: { Accept: "application/json", "User-Agent": "AgentRanking-InferenceIndexer/2.0" },
  });
  return normalizeX402Descriptor(providerId, descriptorUrl, json);
}
