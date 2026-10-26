export const EDITABLE_SERVICE_METADATA_KEYS = ["mcpTools", "a2aSkills", "oasfSkills"] as const;
export type EditableServiceMetadataKey = (typeof EDITABLE_SERVICE_METADATA_KEYS)[number];
export const MAX_SERVICE_METADATA_ITEMS = 50;
export const MAX_SERVICE_METADATA_ITEM_LENGTH = 200;
const EDITABLE_KEY_SET = new Set<string>(EDITABLE_SERVICE_METADATA_KEYS);
export function isEditableServiceMetadataKey(key: string): key is EditableServiceMetadataKey {
  return EDITABLE_KEY_SET.has(key);
}
export function parseMetadataStringArray(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
export function serializeMetadataStringArray(items: string[]): string {
  const normalized = items
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_SERVICE_METADATA_ITEMS)
    .map((item) => item.slice(0, MAX_SERVICE_METADATA_ITEM_LENGTH));
  return JSON.stringify(normalized);
}
export function normalizeMetadataItemsInput(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim().slice(0, MAX_SERVICE_METADATA_ITEM_LENGTH);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_SERVICE_METADATA_ITEMS) break;
  }
  return out;
}
export function metadataItemsFromTextarea(text: string): string[] {
  return normalizeMetadataItemsInput(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}
export function metadataItemsToTextarea(items: string[]): string {
  return items.join("\n");
}
export function metadataKeyForServiceTab(
  tab: "mcp" | "a2a" | "oasf",
): EditableServiceMetadataKey {
  switch (tab) {
    case "mcp":
      return "mcpTools";
    case "a2a":
      return "a2aSkills";
    case "oasf":
      return "oasfSkills";
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}
export type ServiceMetadataSnapshot = Record<EditableServiceMetadataKey, string[]>;
export function buildServiceMetadataSnapshot(
  metadata: ReadonlyArray<{ key: string; value: string }>,
): ServiceMetadataSnapshot {
  const snapshot: ServiceMetadataSnapshot = {
    mcpTools: [],
    a2aSkills: [],
    oasfSkills: [],
  };
  for (const row of metadata) {
    if (!isEditableServiceMetadataKey(row.key)) continue;
    snapshot[row.key] = parseMetadataStringArray(row.value);
  }
  return snapshot;
}
