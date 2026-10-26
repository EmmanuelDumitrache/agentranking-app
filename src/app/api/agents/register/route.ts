import { NextRequest, NextResponse } from "next/server";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { getChainByChainId } from "@/lib/chains";
import { AgentBlocklistError } from "@/lib/agent-blocklist";
import { upsertRegisteredAgent } from "@/lib/register-agent-in-db";
export const dynamic = "force-dynamic";
/**
 * POST /api/agents/register
 * Immediately inserts a newly registered agent into the DB so it shows up
 * without waiting for the next scheduled sync. Best-effort — the sync will
 * reconcile any mismatches.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      chainId,
      agentId,
      name,
      description,
      image,
      owner,
      services,
      txHash,
      metadata: bodyMetadata,
    } = body as {
      chainId: number;
      agentId: number;
      name: string;
      description: string;
      image?: string;
      owner: string;
      services?: Array<{ name: string; endpoint: string }>;
      txHash?: string;
      metadata?: Array<{ key: string; value: string }>;
    };
    if (!chainId || agentId == null || !name || !owner) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: chainId, agentId, name, owner" },
        { status: 400 },
      );
    }
    if (chainId === SOLANA_CHAIN_ID) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Solana registration is not supported on this EVM endpoint; use the Solana registry flow.",
        },
        { status: 400 },
      );
    }
    if (!getChainByChainId(chainId)) {
      return NextResponse.json(
        { success: false, error: `Unknown chain: ${chainId}` },
        { status: 400 },
      );
    }
    const agent = await upsertRegisteredAgent({
      chainId,
      agentId,
      name,
      description,
      image,
      owner,
      services,
      txHash,
      metadata: bodyMetadata,
    });
    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        agentId: agent.agentId,
        chainId: agent.chainId,
        name: agent.name,
      },
    });
  } catch (err) {
    console.error("Register API error:", err);
    if (err instanceof AgentBlocklistError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { success: false, error: Error.isError(err) ? err.message : "Registration failed" },
      { status: 500 },
    );
  }
}
