import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PUBLIC_MCP_CORS_HEADERS } from "@/lib/public-mcp/cors";
import { PUBLIC_MCP_PROTOCOL_VERSION, publicMcpAdvertisedOrigin } from "@/lib/public-mcp/config";
import { executePublicMcpTool } from "@/lib/public-mcp/handlers";
import { isPublicMcpToolName } from "@/lib/public-mcp/catalog";
import {
  encodeMcpSseMessage,
  handlePublicMcpBody,
  prefersMcpSse,
  publicMcpDiscoveryDocument,
} from "@/lib/public-mcp/protocol";
import { getPublicSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function corsHeaders(): Record<string, string> {
  return {
    ...PUBLIC_MCP_CORS_HEADERS,
    "MCP-Protocol-Version": PUBLIC_MCP_PROTOCOL_VERSION,
  };
}
function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}
async function callTool(name: string, args: Record<string, unknown>) {
  if (!isPublicMcpToolName(name)) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return executePublicMcpTool(name, args);
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
export async function GET() {
  return jsonResponse(publicMcpDiscoveryDocument(publicMcpAdvertisedOrigin(getPublicSiteUrl())));
}
export async function DELETE() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    const text = await request.text();
    body = text.trim() ? JSON.parse(text) : null;
  } catch {
    return jsonResponse(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }
  const handled = await handlePublicMcpBody(body, callTool);
  if (handled.kind === "empty") {
    return new NextResponse(null, { status: 202, headers: corsHeaders() });
  }
  if (prefersMcpSse(request.headers.get("accept"))) {
    return new NextResponse(encodeMcpSseMessage(handled.payload), {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }
  return jsonResponse(handled.payload);
}
