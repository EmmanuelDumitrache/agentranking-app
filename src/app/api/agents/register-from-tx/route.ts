import { NextRequest, NextResponse } from "next/server";
import { isAddress, type Hash } from "viem";
import { parseRegisteredAgentFromLogs } from "@/lib/parse-registered-agent-id";
import { fetchEvmTransactionReceipt } from "@/lib/evm-transaction-receipt";
import { getChainByChainId } from "@/lib/chains";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { AgentBlocklistError } from "@/lib/agent-blocklist";
import { upsertRegisteredAgent } from "@/lib/register-agent-in-db";
import { parseAgentListingFromAgentUri } from "@/lib/parse-agent-uri-listing";
import { agentPublicPath } from "@/lib/agent-public-url";
export const dynamic = "force-dynamic";
type RegisterFromTxBody = {
  chainId: number;
  txHash: string;
  name?: string;
  description?: string;
  image?: string;
  owner?: string;
  services?: Array<{ name: string; endpoint: string }>;
  metadata?: Array<{ key: string; value: string }>;
};
/**
 * POST /api/agents/register-from-tx
 * Fetches an on-chain registration receipt, parses agentId, and upserts into the DB.
 * Used when client-side receipt polling or log parsing fails (common on Sepolia).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegisterFromTxBody;
    const { chainId, txHash, name, description, image, owner, services, metadata } = body;
    if (!chainId || !txHash?.trim()) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: chainId, txHash" },
        { status: 400 },
      );
    }
    const normalizedTxHash = txHash.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedTxHash)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid transaction hash — paste the full hash from your block explorer (66 characters including 0x).",
        },
        { status: 400 },
      );
    }
    if (chainId === SOLANA_CHAIN_ID) {
      return NextResponse.json(
        { success: false, error: "Solana registration is not supported on this endpoint." },
        { status: 400 },
      );
    }
    if (!getChainByChainId(chainId)) {
      return NextResponse.json({ success: false, error: `Unknown chain: ${chainId}` }, { status: 400 });
    }
    const receipt = await fetchEvmTransactionReceipt(chainId, normalizedTxHash as Hash);
    if (!receipt) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Could not fetch transaction receipt from Sepolia RPC. Check the chain and full tx hash, then try again.",
        },
        { status: 502 },
      );
    }
    if (receipt.status !== "success") {
      return NextResponse.json(
        { success: false, error: "Transaction reverted on-chain." },
        { status: 400 },
      );
    }
    const parsed = parseRegisteredAgentFromLogs(receipt.logs, chainId);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: "No Registered event found in transaction logs." },
        { status: 422 },
      );
    }
    const resolvedOwner = (owner?.trim() || parsed.owner || "").toLowerCase();
    if (!resolvedOwner || !isAddress(resolvedOwner)) {
      return NextResponse.json(
        { success: false, error: "Connect the wallet that launched this agent." },
        { status: 400 },
      );
    }
    if (
      owner?.trim() &&
      parsed.owner &&
      parsed.owner.toLowerCase() !== owner.trim().toLowerCase()
    ) {
      return NextResponse.json(
        { success: false, error: "Transaction owner does not match connected wallet." },
        { status: 403 },
      );
    }
    const fromUri = await parseAgentListingFromAgentUri(parsed.agentURI);
    const resolvedName = name?.trim() || fromUri?.name || `Agent #${parsed.agentId}`;
    const agent = await upsertRegisteredAgent({
      chainId,
      agentId: parsed.agentId,
      name: resolvedName,
      description: description ?? fromUri?.description ?? "",
      image: image ?? fromUri?.image,
      owner: resolvedOwner,
      services: services?.length ? services : fromUri?.services,
      txHash: normalizedTxHash,
      metadata,
    });
    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        agentId: agent.agentId,
        chainId: agent.chainId,
        name: agent.name,
        profilePath: agentPublicPath(agent),
      },
    });
  } catch (err) {
    console.error("Register-from-tx API error:", err);
    if (err instanceof AgentBlocklistError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { success: false, error: Error.isError(err) ? err.message : "Registration failed" },
      { status: 500 },
    );
  }
}
