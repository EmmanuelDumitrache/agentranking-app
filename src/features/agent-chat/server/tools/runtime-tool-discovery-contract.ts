export type RuntimeToolDiscoveryResult = {
  kind: "runtime-tool-catalog";
  mode: "inventory" | "search";
  query: string | null;
  totalToolCount: number;
  matchedToolCount: number;
  returnedToolCount: number;
  mcpServerToolCount: number;
  mcpRuntimeUtilityCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  groups: Array<{ plugin: string; count: number }>;
  tools: Array<{
    /** Human-facing/external name. */
    name: string;
    /** Internal runtime identifier, included only when explicitly requested. */
    runtimeName?: string;
    plugin: string;
    source?: "local" | "provider" | "mcp_server" | "mcp_runtime";
    displayName?: string;
    serverName?: string;
    description?: string;
  }>;
};
export function isRuntimeToolDiscoveryResult(
  value: unknown,
): value is RuntimeToolDiscoveryResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === "runtime-tool-catalog" &&
    (record.mode === "inventory" || record.mode === "search") &&
    typeof record.totalToolCount === "number" &&
    typeof record.returnedToolCount === "number" &&
    Array.isArray(record.tools)
  );
}
