import "server-only";

import { extractTextContent } from "../shared/ui-message";
import { searchableContextJson } from "./context-search-text";

/**
 * Bounded semantic projection of a persisted UI-message `parts` document plus
 * native attachment flags. Persisted alongside canonical `parts` so lexical
 * history search indexes a bounded text column instead of the whole JSON.
 */
const MAX_MESSAGE_SEARCH_CHARS = 24_000;

export type MessageSearchProjection = {
  searchText: string;
  hasFile: boolean;
  hasImageFile: boolean;
  fileCount: number;
};

export function projectMessageSearchFields(parts: unknown): MessageSearchProjection {
  const partList = Array.isArray(parts) ? parts : [];
  const fileParts = partList.filter(
    (part): part is Record<string, unknown> =>
      part != null &&
      typeof part === "object" &&
      !Array.isArray(part) &&
      (part as { type?: unknown }).type === "file",
  );
  let naturalText = "";
  try {
    naturalText = extractTextContent({
      parts: partList as never,
    }).trim();
  } catch {
    // Structural projection below still makes tool/file evidence searchable.
  }
  const structuralParts = partList.filter((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return true;
    return (part as { type?: unknown }).type !== "text";
  });
  const structuralText =
    structuralParts.length > 0
      ? searchableContextJson(structuralParts, MAX_MESSAGE_SEARCH_CHARS)
      : "";
  const searchText = [naturalText, structuralText]
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, MAX_MESSAGE_SEARCH_CHARS);
  return {
    searchText,
    hasFile: fileParts.length > 0,
    hasImageFile: fileParts.some((part) => {
      const mediaType = part.mediaType;
      return typeof mediaType === "string" && mediaType.startsWith("image/");
    }),
    fileCount: fileParts.length,
  };
}
