import "server-only";
import type { ToolSet } from "ai";
import { loadAllPlugins } from "./catalog";
import type { Action } from "solana-agent-kit";
import type { ToolSelectionEntry } from "../orchestration/types";
import { getOrInsertComputed } from "@/lib/map-upsert";
import { getMcpToolMetadata } from "../mcp/tool-metadata";
import { getAgentRuntimeToolMetadata } from "./provider-tools";

const RUNTIME_TOOL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  get_wallet_status: ["wallet status", "check wallet", "get wallet"],
  list_recent_transfers: ["recent transfers", "list transfers", "transfer history"],
  send_sol: ["send sol", "transfer sol"],
  agentcard_status: ["agentcard status", "card status"],
  agentcard_request_card: ["request card", "issue card", "request virtual card", "request single use card"],
  agentcard_get_request: ["card request status", "get card request"],
  agentcard_cancel_request: ["cancel card request", "cancel agentcard request"],
  agentcard_wallet_balance: ["agentcard balance", "card wallet balance"],
  runtime_tool_search: ["find tools", "search tools", "capability search", "tool discovery"],
  read_tool_result: ["read tool result", "artifact result", "full tool output"],
  search_tool_results: ["search tool results", "search artifacts", "find tool output"],
  read_conversation_history: ["older history", "read previous messages", "compacted history"],
  read_conversation_attachment: ["read attachment", "view old image", "previous image", "conversation screenshot", "read old file", "previous document", "rehydrate file"],
  search_previous_threads: ["previous threads", "old conversations", "search chats"],
  delegate_context_analysis: ["delegate analysis", "isolated analysis", "summarize evidence", "analyze artifacts"],
};

/**
 * Build runtime catalog metadata from the ACTUAL installed SAK v2 action catalog.
 * Do NOT manually recreate action names — the catalog is authoritative.
 *
 * For EACH action, derive:
 * - name, plugin, description, similes
 * - top-level input schema property names
 * - normalized searchable terms (lowercased, concatenated)
 *
 */
export async function buildSelectionMetadata(): Promise<
  readonly ToolSelectionEntry[]
> {
  const plugins = await loadAllPlugins();
  const entries: ToolSelectionEntry[] = [];
  for (const plugin of plugins) {
    for (const action of plugin.actions) {
      entries.push(toSelectionEntry(action, plugin.name));
    }
  }
  return entries;
}
/**
 * Build catalog metadata for the tools that actually exist in the runtime
 * ToolSet and synthesize metadata for provider-defined tools that are not part
 * of the installed Solana Agent Kit action catalog.
 */
export function buildRuntimeSelectionMetadata(
  tools: ToolSet,
  installedCatalog: readonly ToolSelectionEntry[],
): readonly ToolSelectionEntry[] {
  const installedByName = new Map(
    installedCatalog.map((entry) => [entry.name, entry] as const),
  );
  return Object.entries(tools)
    .map(([name, tool]) => {
      const installed = installedByName.get(name);
      if (installed) {
        return installed;
      }
      const description =
        typeof tool === "object" &&
        tool !== null &&
        "description" in tool &&
        typeof tool.description === "string"
          ? tool.description.slice(0, 1024)
          : "";
      const mcp = getMcpToolMetadata(tool);
      const runtime = getAgentRuntimeToolMetadata(tool);
      const contextUtility = [
        "runtime_tool_search",
        "read_tool_result",
        "search_tool_results",
        "read_conversation_history",
        "read_conversation_attachment",
        "search_previous_threads",
        "delegate_context_analysis",
      ].includes(name);
      const plugin = mcp
        ? mcp.kind === "runtime_utility"
          ? "mcp-runtime"
          : `mcp:${mcp.serverName}`
        : contextUtility
          ? "runtime-context"
          : runtime?.source === "provider"
            ? `provider:${runtime.providerId ?? "runtime"}`
            : "runtime-local";
      const similes = mcp
        ? [mcp.externalToolName, mcp.title].filter((value, index, values) => value && values.indexOf(value) === index)
        : RUNTIME_TOOL_ALIASES[name] ?? [];
      return {
        name,
        plugin,
        description,
        similes,
        schemaFields: [],
        source: mcp
          ? mcp.kind === "runtime_utility" ? "mcp_runtime" : "mcp_server"
          : runtime?.source === "provider" ? "provider" : "local",
        ...(mcp ? {
          displayName: mcp.title,
          externalName: mcp.externalToolName,
          serverName: mcp.serverName,
        } : {}),
        normalizedTerms: buildNormalizedTermsFromParts([
          name,
          plugin,
          description,
          ...(mcp ? [mcp.externalToolName, mcp.title, mcp.serverName] : RUNTIME_TOOL_ALIASES[name] ?? []),
        ]),
      } satisfies ToolSelectionEntry;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
/**
 * Build a lookup map keyed by tool name for O(1) access.
 */
export async function buildSelectionMap(): Promise<
  ReadonlyMap<string, ToolSelectionEntry>
> {
  const entries = await buildSelectionMetadata();
  return new Map(entries.map((e) => [e.name, e]));
}
function toSelectionEntry(
  action: Action,
  pluginName: string,
): ToolSelectionEntry {
  const schemaFields = extractSchemaFields(action);
  const normalizedTerms = buildNormalizedTerms(
    action,
    pluginName,
    schemaFields,
  );
  return {
    name: action.name,
    plugin: pluginName,
    description: (action.description ?? "").slice(0, 1024),
    similes: action.similes ?? [],
    schemaFields,
    normalizedTerms,
    source: "local",
  };
}
function extractSchemaFields(action: Action): readonly string[] {
  // Action.schema is z.ZodType<any> — access runtime shape via indexing
  const schema = action.schema as unknown as
    Record<string, unknown> | undefined;
  if (!schema) return [];
  // Try JSON Schema `properties` first (raw objects)
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (properties) return Object.keys(properties).sort();
  // Try Zod-internal `shape` (ZodObject)
  const shape = schema.shape as Record<string, unknown> | undefined;
  if (shape) return Object.keys(shape).sort();
  return [];
}
function buildNormalizedTerms(
  action: Action,
  pluginName: string,
  schemaFields: readonly string[],
): readonly string[] {
  return buildNormalizedTermsFromParts([
    action.name,
    pluginName,
    action.description ?? "",
    ...(action.similes ?? []),
    ...schemaFields,
  ]);
}
function buildNormalizedTermsFromParts(
  parts: readonly string[],
): readonly string[] {
  const raw = parts.join(" ").toLowerCase();
  const terms = new Set(
    raw
      .split(/[\s,._\-:;()[\]{}]+/)
      .filter((term) => term.length >= 2)
      .map((term) => term.trim()),
  );
  return Array.from(terms).sort();
}
/**
 * Build a searchable index from runtime catalog metadata.
 */
export function buildSearchIndex(
  metadata: readonly ToolSelectionEntry[],
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const entry of metadata) {
    for (const term of entry.normalizedTerms) {
      const existing = getOrInsertComputed(index, term, () => []);
      if (!existing.includes(entry.name)) {
        existing.push(entry.name);
      }
    }
  }
  return index;
}
