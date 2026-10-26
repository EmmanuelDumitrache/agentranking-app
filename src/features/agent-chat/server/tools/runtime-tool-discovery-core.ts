import type { ToolSelectionEntry } from "../orchestration/types";
import { REMOTE_SEMANTIC_MIN_SIMILARITY } from "@/features/agent-chat/server/semantic-ranking";
import type { RuntimeToolDiscoveryResult } from "./runtime-tool-discovery-contract";
export type RuntimeToolDiscoveryInput = {
  query?: string;
  offset?: number;
  limit?: number;
  includeDescriptions?: boolean;
};
export function inspectRuntimeToolCatalog(
  catalog: readonly ToolSelectionEntry[],
  input: RuntimeToolDiscoveryInput = {},
  options: {
    forceInventory?: boolean;
    includeRuntimeNames?: boolean;
    semanticScores?: ReadonlyMap<string, number>;
  } = {},
): RuntimeToolDiscoveryResult {
  const stableCatalog = [...catalog].sort(
    (left, right) =>
      left.plugin.localeCompare(right.plugin) ||
      left.name.localeCompare(right.name),
  );
  const query = options.forceInventory ? null : input.query?.trim() || null;
  const mode = query ? "search" : "inventory";
  const matches = query
    ? rankCatalogMatches(stableCatalog, query, options.semanticScores)
    : stableCatalog;
  const offset = options.forceInventory ? 0 : Math.max(0, input.offset ?? 0);
  const defaultLimit = mode === "search" ? 12 : 200;
  const requestedLimit = Math.max(
    1,
    Math.min(200, input.limit ?? defaultLimit),
  );
  const limit = options.forceInventory ? stableCatalog.length : requestedLimit;
  const includeDescriptions = options.forceInventory
    ? false
    : (input.includeDescriptions ?? mode === "search");
  const page = matches.slice(offset, offset + limit);
  return {
    kind: "runtime-tool-catalog",
    mode,
    query,
    totalToolCount: stableCatalog.length,
    matchedToolCount: matches.length,
    returnedToolCount: page.length,
    mcpServerToolCount: stableCatalog.filter((entry) => entry.source === "mcp_server").length,
    mcpRuntimeUtilityCount: stableCatalog.filter((entry) => entry.source === "mcp_runtime").length,
    offset,
    limit,
    hasMore: offset + page.length < matches.length,
    groups: mode === "inventory" ? summarizeGroups(stableCatalog) : [],
    tools: page.map((entry) => {
      const publicName = entry.source === "mcp_server" && entry.externalName
        ? entry.externalName
        : entry.name;
      return {
        name: publicName,
        ...(options.includeRuntimeNames && publicName !== entry.name
          ? { runtimeName: entry.name }
          : {}),
        plugin: entry.plugin,
        ...(entry.source ? { source: entry.source } : {}),
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
        ...(entry.serverName ? { serverName: entry.serverName } : {}),
        ...(includeDescriptions && entry.description
          ? { description: entry.description.slice(0, 600) }
          : {}),
      };
    }),
  };
}
function rankCatalogMatches(
  catalog: readonly ToolSelectionEntry[],
  query: string,
  semanticScores?: ReadonlyMap<string, number>,
): ToolSelectionEntry[] {
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = normalizedQuery
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
  return catalog
    .map((entry) => ({
      entry,
      score:
        scoreEntry(entry, normalizedQuery, tokens)
        + ((semanticScores?.get(entry.name) ?? -1) >= REMOTE_SEMANTIC_MIN_SIMILARITY
          ? Math.round(Math.max(0, semanticScores?.get(entry.name) ?? 0) * 100)
          : 0),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.name.localeCompare(right.entry.name),
    )
    .map(({ entry }) => entry);
}
function scoreEntry(
  entry: ToolSelectionEntry,
  query: string,
  tokens: readonly string[],
): number {
  const name = entry.name.toLowerCase();
  const plugin = entry.plugin.toLowerCase();
  const description = entry.description.toLowerCase();
  const similes = entry.similes.map((simile) => simile.toLowerCase());
  const fields = entry.schemaFields.map((field) => field.toLowerCase());
  const terms = new Set(entry.normalizedTerms);
  let score = 0;
  if (name === query) score += 1_000;
  else if (name.includes(query)) score += 400;
  if (similes.some((simile) => simile === query)) score += 800;
  else if (similes.some((simile) => simile.includes(query))) score += 300;
  for (const token of tokens) {
    if (name.includes(token)) score += 120;
    if (plugin.includes(token)) score += 40;
    if (fields.some((field) => field.includes(token))) score += 80;
    if (similes.some((simile) => simile.includes(token))) score += 100;
    if (description.includes(token)) score += 35;
    if (terms.has(token)) score += 25;
  }
  return score;
}
function summarizeGroups(
  catalog: readonly ToolSelectionEntry[],
): Array<{ plugin: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of catalog) {
    counts.set(entry.plugin, (counts.get(entry.plugin) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([plugin, count]) => ({ plugin, count }))
    .sort((left, right) => left.plugin.localeCompare(right.plugin));
}