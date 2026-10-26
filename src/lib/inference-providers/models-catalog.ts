import { sanitizeBoundedJson } from "@/lib/inference-providers/validation";
import type { InferenceModelCatalog, InferenceModelCatalogEntry } from "@/lib/inference-providers/types";
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
function asBoolean(value: unknown): boolean {
  return value === true;
}
function parseModelRow(row: unknown): InferenceModelCatalogEntry | null {
  const obj = asRecord(row);
  if (!obj) return null;
  const id = asString(obj.id);
  if (!id) return null;
  return {
    id,
    provider: asString(obj.provider),
    modality: asString(obj.modality),
    tier: asString(obj.tier),
    freeEligible: asBoolean(obj.free_eligible),
    inputPerMtok: asNumber(obj.input_per_mtok),
    outputPerMtok: asNumber(obj.output_per_mtok),
    flatFeeUsd: asNumber(obj.flat_fee_usd),
  };
}
export function formatModelCatalogLabel(model: InferenceModelCatalogEntry): string {
  const inPrice = model.inputPerMtok != null ? `$${model.inputPerMtok.toFixed(3)}/M in` : null;
  const outPrice = model.outputPerMtok != null ? `$${model.outputPerMtok.toFixed(3)}/M out` : null;
  const pricing = [inPrice, outPrice].filter(Boolean).join(" · ");
  const tier = model.tier ? ` · ${model.tier}` : "";
  return pricing ? `${model.id} (${pricing})${tier}` : `${model.id}${tier}`;
}
export function normalizeModelsCatalog(
  providerId: string,
  sourceUrl: string,
  raw: unknown,
  fetchedAt: Date = new Date(),
): InferenceModelCatalog | null {
  const obj = asRecord(raw);
  const rows = Array.isArray(raw)
    ? raw
    : obj && Array.isArray(obj.data)
      ? obj.data
      : [];
  const models = rows
    .slice(0, 2_000)
    .map(parseModelRow)
    .filter((row): row is InferenceModelCatalogEntry => row != null)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (models.length === 0) return null;
  return {
    providerId,
    fetchedAt: fetchedAt.toISOString(),
    sourceUrl,
    models,
    raw: sanitizeBoundedJson(obj ?? { data: rows }) as Record<string, unknown>,
  };
}
/** Chat-capable models for playground (excludes pure embedding models). */
export function listChatModelsFromCatalog(catalog: InferenceModelCatalog): InferenceModelCatalogEntry[] {
  return catalog.models.filter((model) => {
    const id = model.id.toLowerCase();
    if (id.includes("embedding")) return false;
    if (model.modality?.toLowerCase().includes("embedding")) return false;
    return true;
  });
}
