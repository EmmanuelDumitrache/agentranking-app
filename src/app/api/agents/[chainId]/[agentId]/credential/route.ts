import { NextRequest, NextResponse } from "next/server";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
import {
  loadAgentPublicCredential,
  publicAgentCredentialResponse,
} from "@/lib/verification/public-agent-credential.server";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const { chainId, agentId: rawAgentId } = await params;
  const chainIdNum = parsePublicChainId(chainId);
  const agentIdNum = parsePublicAgentId(rawAgentId);
  if (chainIdNum == null || agentIdNum == null) {
    return NextResponse.json(
      { error: "Invalid agent identity" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const credential = await loadAgentPublicCredential(chainIdNum, agentIdNum);
  if (!credential) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(publicAgentCredentialResponse(credential, request.nextUrl.origin), {
    headers: CORS_HEADERS,
  });
}
