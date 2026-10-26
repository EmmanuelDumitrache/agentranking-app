import { NextResponse } from "next/server";
import { PUBLIC_MCP_CORS_HEADERS } from "@/lib/public-mcp/cors";
import { publicMcpAdvertisedOrigin } from "@/lib/public-mcp/config";
import { publicMcpDiscoveryDocument } from "@/lib/public-mcp/protocol";
import { getPublicSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(publicMcpDiscoveryDocument(publicMcpAdvertisedOrigin(getPublicSiteUrl())), {
    headers: {
      ...PUBLIC_MCP_CORS_HEADERS,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
