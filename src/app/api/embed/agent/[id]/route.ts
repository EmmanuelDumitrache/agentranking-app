import { NextRequest, NextResponse } from "next/server";
import { buildEmbedAgentHtmlDocument, loadAgentForEmbed } from "@/lib/embed-agent-widget";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const agentId = Number.parseInt(id, 10);
  if (!Number.isFinite(agentId)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const agent = await loadAgentForEmbed(agentId);
  if (!agent) {
    return new NextResponse("Not found", { status: 404 });
  }
  const html = buildEmbedAgentHtmlDocument(agent, request.nextUrl.searchParams);
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}