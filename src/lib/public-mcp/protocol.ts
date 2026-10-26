import {
  PUBLIC_MCP_INSTRUCTIONS,
  PUBLIC_MCP_PROTOCOL_VERSION,
  PUBLIC_MCP_SERVER_NAME,
  PUBLIC_MCP_SERVER_VERSION,
  PUBLIC_MCP_SUPPORTED_PROTOCOL_VERSIONS,
} from "@/lib/public-mcp/config";
import { isPublicMcpToolName, publicMcpToolsListPayload } from "@/lib/public-mcp/catalog";

export type JsonRpcId = string | number | null;
export type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};
export type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
};
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;
export type PublicMcpCallTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asId(value: unknown): JsonRpcId {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}
function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}
function failure(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcFailure {
  return data === undefined
    ? { jsonrpc: "2.0", id, error: { code, message } }
    : { jsonrpc: "2.0", id, error: { code, message, data } };
}
function isNotification(message: JsonRpcRequest): boolean {
  return !("id" in message) || message.id === undefined;
}
function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested !== "string") return PUBLIC_MCP_PROTOCOL_VERSION;
  const supported = PUBLIC_MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[];
  return supported.includes(requested) ? requested : PUBLIC_MCP_PROTOCOL_VERSION;
}
function toolTextResult(payload: unknown, isError = false) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: typeof payload === "string" ? { text: payload } : payload,
    isError,
  };
}
function handleCatalogMethod(method: string, id: JsonRpcId): JsonRpcResponse | null {
  switch (method) {
    case "ping":
      return success(id, {});
    case "tools/list":
      return success(id, { tools: publicMcpToolsListPayload() });
    case "resources/list":
      return success(id, { resources: [] });
    case "resources/templates/list":
      return success(id, { resourceTemplates: [] });
    case "prompts/list":
      return success(id, { prompts: [] });
    default:
      return null;
  }
}
async function handleRequest(
  message: JsonRpcRequest,
  callTool: PublicMcpCallTool,
): Promise<JsonRpcResponse> {
  const id = asId(message.id);
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return failure(id, -32600, "Invalid Request");
  }
  const method = message.method;
  const params = isRecord(message.params) ? message.params : {};
  if (method === "initialize") {
    return success(id, {
      protocolVersion: negotiateProtocolVersion(params.protocolVersion),
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: {
        name: PUBLIC_MCP_SERVER_NAME,
        version: PUBLIC_MCP_SERVER_VERSION,
      },
      instructions: PUBLIC_MCP_INSTRUCTIONS,
    });
  }
  const catalog = handleCatalogMethod(method, id);
  if (catalog) return catalog;
  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    if (!name) return failure(id, -32602, "Missing tool name");
    if (!isPublicMcpToolName(name)) {
      return success(id, toolTextResult({ error: `Unknown tool: ${name}` }, true));
    }
    const args = isRecord(params.arguments) ? params.arguments : {};
    try {
      const payload = await callTool(name, args);
      return success(id, toolTextResult(payload, false));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Tool failed";
      return success(id, toolTextResult({ error: messageText }, true));
    }
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return success(id, {});
  }
  return failure(id, -32601, `Method not found: ${method}`);
}
/**
 * Handle one JSON-RPC message or a batch. Notifications return null (HTTP 202).
 */
export async function handlePublicMcpBody(
  body: unknown,
  callTool: PublicMcpCallTool,
): Promise<{ kind: "empty" } | { kind: "response"; payload: JsonRpcResponse | JsonRpcResponse[] }> {
  if (body === undefined || body === null) {
    return { kind: "response", payload: failure(null, -32700, "Parse error") };
  }
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return { kind: "response", payload: failure(null, -32600, "Invalid Request") };
    }
    const replies: JsonRpcResponse[] = [];
    for (const item of body) {
      if (!isRecord(item)) {
        replies.push(failure(null, -32600, "Invalid Request"));
        continue;
      }
      if (isNotification(item)) continue;
      replies.push(await handleRequest(item, callTool));
    }
    if (replies.length === 0) return { kind: "empty" };
    return { kind: "response", payload: replies };
  }
  if (!isRecord(body)) {
    return { kind: "response", payload: failure(null, -32600, "Invalid Request") };
  }
  if (isNotification(body)) {
    if (typeof body.method === "string" && body.method.startsWith("notifications/")) {
      return { kind: "empty" };
    }
    await handleRequest(body, callTool);
    return { kind: "empty" };
  }
  return { kind: "response", payload: await handleRequest(body, callTool) };
}
export function encodeMcpSseMessage(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}
export function prefersMcpSse(acceptHeader: string | null): boolean {
  const accept = (acceptHeader ?? "").toLowerCase();
  const wantsSse = accept.includes("text/event-stream");
  const wantsJson = accept.includes("application/json");
  return wantsSse && !wantsJson;
}
export function publicMcpDiscoveryDocument(origin: string) {
  return {
    name: PUBLIC_MCP_SERVER_NAME,
    version: PUBLIC_MCP_SERVER_VERSION,
    protocolVersion: PUBLIC_MCP_PROTOCOL_VERSION,
    transport: "streamable-http",
    url: `${origin.replace(/\/$/, "")}/api/mcp`,
    documentation: `${origin.replace(/\/$/, "")}/mcp`,
    wellKnown: `${origin.replace(/\/$/, "")}/.well-known/mcp.json`,
    tools: publicMcpToolsListPayload().map((tool) => tool.name),
    resources: [] as const,
    prompts: [] as const,
    auth: "none",
  };
}
