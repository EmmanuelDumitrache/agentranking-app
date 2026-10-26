import { NextRequest, NextResponse } from "next/server";
import { getAgentDetailPayload } from "@/lib/agent-detail-server";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "X-API-Version": "1",
};
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
/**
 * GET /api/v1/agents/:chainId/:agentId
 *
 * Returns full agent detail including services, metadata, capabilities, and on-chain enrichment.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> }
) {
  const { chainId: chainIdStr, agentId: agentIdStr } = await params;
  const chainId = parsePublicChainId(chainIdStr);
  const agentId = parsePublicAgentId(agentIdStr);
  if (chainId == null || agentId == null) {
    return NextResponse.json(
      { error: "Invalid chainId or agentId" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  try {
    const agent = await getAgentDetailPayload(chainId, agentId);
    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found" },
        { status: 404, headers: CORS_HEADERS }
      );
    }
    return NextResponse.json({ data: agent }, { headers: CORS_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", message: Error.isError(err) ? err.message : String(err) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
