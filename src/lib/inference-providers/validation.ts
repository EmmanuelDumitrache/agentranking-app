import type {
  InferenceModelCatalog,
  InferenceModelCatalogEntry,
  X402DescriptorEndpoint,
  X402ServiceDescriptor,
} from "@/lib/inference-providers/types";

const MAX_PROVIDER_ID = 80;
const MAX_URL = 2_048;
const MAX_TEXT = 8_192;
const MAX_SHORT_TEXT = 512;
const MAX_ENDPOINTS = 128;
const MAX_MODELS = 2_000;
const MAX_CAPABILITIES = 128;
const MAX_RAW_KEYS = 256;
const MAX_RAW_DEPTH = 6;
const MAX_RAW_ARRAY = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedString(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
}
function nullableFiniteNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}
function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function validUrl(value: unknown, nullable = false): boolean {
  if (nullable && value === null) return true;
  if (!boundedString(value, MAX_URL)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
  } catch {
    return false;
  }
}
export function sanitizeBoundedJson(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > MAX_RAW_DEPTH) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, MAX_TEXT);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_RAW_ARRAY).map((item) => sanitizeBoundedJson(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_RAW_KEYS)
        .map(([key, item]) => [key.slice(0, MAX_SHORT_TEXT), sanitizeBoundedJson(item, depth + 1)]),
    );
  }
  return null;
}
function isEndpoint(value: unknown): value is X402DescriptorEndpoint {
  if (!isRecord(value)) return false;
  return boundedString(value.path, MAX_URL)
    && boundedString(value.method, 16)
    && boundedString(value.type, MAX_SHORT_TEXT)
    && (value.pricingModel === null || boundedString(value.pricingModel, MAX_SHORT_TEXT))
    && nullableFiniteNumber(value.flatFeeUsd)
    && Number.isSafeInteger(value.modelCount)
    && Number(value.modelCount) >= 0
    && Number(value.modelCount) <= MAX_MODELS;
}
function isModel(value: unknown): value is InferenceModelCatalogEntry {
  if (!isRecord(value)) return false;
  return boundedString(value.id, MAX_SHORT_TEXT)
    && (value.provider === null || boundedString(value.provider, MAX_SHORT_TEXT))
    && (value.modality === null || boundedString(value.modality, MAX_SHORT_TEXT))
    && (value.tier === null || boundedString(value.tier, MAX_SHORT_TEXT))
    && typeof value.freeEligible === "boolean"
    && nullableFiniteNumber(value.inputPerMtok)
    && nullableFiniteNumber(value.outputPerMtok)
    && nullableFiniteNumber(value.flatFeeUsd);
}
export function isX402ServiceDescriptor(value: unknown): value is X402ServiceDescriptor {
  if (!isRecord(value)) return false;
  return boundedString(value.providerId, MAX_PROVIDER_ID)
    && validIsoDate(value.fetchedAt)
    && validUrl(value.sourceUrl)
    && boundedString(value.name, MAX_SHORT_TEXT)
    && boundedString(value.description, MAX_TEXT, true)
    && validUrl(value.homepage, true)
    && validUrl(value.docs, true)
    && nullableFiniteNumber(value.x402Version)
    && Array.isArray(value.endpoints) && value.endpoints.length <= MAX_ENDPOINTS && value.endpoints.every(isEndpoint)
    && Array.isArray(value.capabilities) && value.capabilities.length <= MAX_CAPABILITIES
    && value.capabilities.every((item) => boundedString(item, MAX_SHORT_TEXT))
    && Array.isArray(value.paymentChains) && value.paymentChains.length <= MAX_CAPABILITIES
    && value.paymentChains.every((item) => boundedString(item, MAX_SHORT_TEXT))
    && isRecord(value.raw);
}
export function isInferenceModelCatalog(value: unknown): value is InferenceModelCatalog {
  if (!isRecord(value)) return false;
  return boundedString(value.providerId, MAX_PROVIDER_ID)
    && validIsoDate(value.fetchedAt)
    && validUrl(value.sourceUrl)
    && Array.isArray(value.models) && value.models.length > 0 && value.models.length <= MAX_MODELS
    && value.models.every(isModel)
    && isRecord(value.raw);
}
