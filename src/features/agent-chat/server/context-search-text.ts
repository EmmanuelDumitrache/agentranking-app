import "server-only";

import { boundedJsonPreview } from "@/lib/bounded-json-preview";
import { redactSensitiveData } from "@/lib/security/sensitive-data-redaction";

const MAX_SEARCH_DEPTH = 12;
const MAX_SEARCH_ARRAY_ITEMS = 128;
const MAX_SEARCH_OBJECT_ENTRIES = 256;
const MAX_SEARCH_STRING_CHARS = 24_000;
const OPAQUE_ENCODED_STRING_MIN_CHARS = 2_048;

function opaqueEncodedPayloadKind(value: string): "base64" | "hex" | null {
  if (value.length < OPAQUE_ENCODED_STRING_MIN_CHARS) return null;
  if (/^(?:0x)?[0-9a-f]+$/i.test(value)) return "hex";
  // Long unbroken base64/base64url transports have essentially no lexical or
  // semantic retrieval value. Keep exact bytes only in the canonical source.
  if (/^[A-Za-z0-9+/_=-]+$/.test(value)) return "base64";
  return null;
}

function stratifiedIndexes(length: number, maximum: number): number[] {
  if (length <= 0 || maximum <= 0) return [];
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  if (maximum === 1) return [0];
  const indexes = new Set<number>();
  for (let slot = 0; slot < maximum; slot += 1) {
    indexes.add(Math.round((slot * (length - 1)) / (maximum - 1)));
  }
  return [...indexes].sort((left, right) => left - right);
}

function boundSearchString(
  value: string,
  maxChars = MAX_SEARCH_STRING_CHARS,
): string {
  if (/^data:[^;,]+(?:;[^,]*)?,/i.test(value)) {
    const comma = value.indexOf(",");
    return comma > 0
      ? `${value.slice(0, comma + 1)}[binary payload omitted]`
      : "[data payload omitted]";
  }
  const opaqueKind = opaqueEncodedPayloadKind(value);
  if (opaqueKind) {
    return `[opaque ${opaqueKind} payload omitted; chars=${value.length}]`;
  }
  const safeMaxChars = Math.max(256, Math.min(MAX_SEARCH_STRING_CHARS, maxChars));
  if (value.length <= safeMaxChars) return value;

  // Preserve evidence across the complete string instead of spending the
  // entire retrieval/embedding budget on the beginning and end. Exact content
  // remains canonical; this is only the semantic/index projection.
  const windowCount = Math.max(
    2,
    Math.min(6, Math.floor(safeMaxChars / 768)),
  );
  const marker = "\n...[long searchable text gap]...\n";
  const markerChars = marker.length * (windowCount - 1);
  const availableChars = safeMaxChars - markerChars;
  if (availableChars < windowCount * 64) {
    const half = Math.max(1, Math.floor((safeMaxChars - marker.length) / 2));
    return `${value.slice(0, half)}${marker}${value.slice(-half)}`;
  }
  const windowChars = Math.max(64, Math.floor(availableChars / windowCount));
  const maxStart = Math.max(0, value.length - windowChars);
  const windows: string[] = [];
  for (let slot = 0; slot < windowCount; slot += 1) {
    const start = windowCount === 1
      ? 0
      : Math.round((slot * maxStart) / (windowCount - 1));
    windows.push(value.slice(start, start + windowChars));
  }
  return windows.join(marker).slice(0, safeMaxChars);
}

function projectSearchableValue(
  value: unknown,
  depth: number,
  maxStringChars: number,
): unknown {
  if (depth >= MAX_SEARCH_DEPTH) return "[nested data omitted]";
  if (typeof value === "string") return boundSearchString(value, maxStringChars);
  if (value == null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    const indexes = stratifiedIndexes(value.length, MAX_SEARCH_ARRAY_ITEMS);
    if (indexes.length === value.length) {
      return indexes.map((index) =>
        projectSearchableValue(value[index], depth + 1, maxStringChars),
      );
    }
    return indexes.map((index) => ({
      index,
      value: projectSearchableValue(value[index], depth + 1, maxStringChars),
    }));
  }

  const object = value as Record<string, unknown>;
  if (
    object.type === "file"
    && typeof object.mediaType === "string"
  ) {
    // Search/ranking only needs attachment semantics and metadata. Omit both
    // data URLs and signed HTTPS transports for every file type; otherwise a
    // PDF or other encoded document can dominate an embedding/search index in
    // exactly the same way as an image.
    const semanticKind = object.mediaType.startsWith("image/")
      ? "image attachment photo picture screenshot"
      : object.mediaType === "application/pdf"
        ? "file attachment document pdf uploaded document"
        : "file attachment uploaded document";
    return {
      type: "file",
      mediaType: object.mediaType,
      ...(typeof object.filename === "string"
        ? { filename: boundSearchString(object.filename, maxStringChars) }
        : {}),
      semanticKind,
    };
  }

  const entries = Object.entries(object);
  const indexes = stratifiedIndexes(entries.length, MAX_SEARCH_OBJECT_ENTRIES);
  const projected: Record<string, unknown> = {};
  for (const index of indexes) {
    const entry = entries[index];
    if (!entry) continue;
    const [key, item] = entry;
    if (
      (key === "data" || key === "image" || key === "url")
      && typeof item === "string"
      && /^data:/i.test(item)
    ) {
      projected[key] = "[inline binary payload omitted]";
      continue;
    }
    projected[key] = projectSearchableValue(item, depth + 1, maxStringChars);
  }
  return projected;
}

/**
 * Build bounded retrieval/ranking text from untrusted conversation/tool data.
 * Opaque binary transports are removed and very large containers are sampled
 * across their complete extent, so embedding/lexical budgets are spent on
 * identifiers and semantic evidence rather than base64 or only the first rows.
 */
export function searchableContextJson(
  value: unknown,
  maxChars: number,
): string {
  const safeMaxChars = Math.max(256, Math.trunc(maxChars));
  // Project first so opaque binary/file transports and unsampled container
  // regions never reach the redactor. Redaction is still applied to every
  // model/search-visible byte of the bounded projection.
  const projected = projectSearchableValue(
    value,
    0,
    Math.min(MAX_SEARCH_STRING_CHARS, safeMaxChars),
  );
  return boundedJsonPreview(
    redactSensitiveData(projected),
    {
      maxChars: safeMaxChars,
      maxDepth: MAX_SEARCH_DEPTH,
      maxEntriesPerContainer: MAX_SEARCH_OBJECT_ENTRIES,
      maxNodes: 12_000,
      maxStringChars: Math.min(MAX_SEARCH_STRING_CHARS, safeMaxChars),
      indent: 0,
    },
  ).text;
}
