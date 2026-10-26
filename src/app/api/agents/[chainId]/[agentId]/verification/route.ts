import { NextRequest, NextResponse } from "next/server";
import { prismaApiErrorLogFields, prismaApiRouteErrorResponse } from "@/lib/api-prisma-route-error";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
import { getAgentVerificationPayload } from "@/lib/agent-verification-payload";
export const maxDuration = 30;
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const { chainId, agentId: rawAgentId } = await params;
  const chainIdNum = parsePublicChainId(chainId);
  const agentIdNum = parsePublicAgentId(rawAgentId);
  if (chainIdNum == null) {
    return NextResponse.json({ error: "Invalid chainId" }, { status: 400 });
  }
  if (agentIdNum == null) {
    return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
  }
  try {
    const payload = await getAgentVerificationPayload(chainIdNum, agentIdNum);
    if (!payload) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("GET /api/agents/[chainId]/[agentId]/verification error:", {
      error: msg,
      stack: Error.isError(err) ? err.stack : undefined,
      ...prismaApiErrorLogFields(msg),
    });
    const { body, status, headers } = prismaApiRouteErrorResponse(msg);
    return NextResponse.json(body, { status, headers });
  }
}
