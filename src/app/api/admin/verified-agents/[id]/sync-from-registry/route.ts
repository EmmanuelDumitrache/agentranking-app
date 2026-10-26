import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { upsertAgentFromRegistry } from "@/lib/erc8004-sync";
import { adminUpsertSapAgentFromOobeByDirectoryAgentId } from "../../../../../../../services/sap-indexer";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const agentSelect = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  description: true,
  image: true,
  owner: true,
  tokenAddress: true,
  isVerified: true,
  isPremiumVerified: true,
  isActive: true,
  isCustomListed: true,
  createdAt: true,
  chain: { select: { shortName: true, name: true } },
} as const;
function parseInternalId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
/**
 * POST /api/admin/verified-agents/[id]/sync-from-registry
 * EVM: ERC-8004 registration from chain. Solana SAP (900001): OOBE Explorer + SAP RPC (same as indexer reconcile).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = parseInternalId((await params).id);
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const row = await prisma.agent.findUnique({
      where: { id },
      select: { agentId: true, chainId: true },
    });
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (row.agentId < 0) {
      return NextResponse.json(
        {
          error: "Sync from chain only applies to on-chain token ids (not custom / negative-id listings).",
        },
        { status: 400 }
      );
    }
    const upsert =
      row.chainId === SOLANA_CHAIN_ID
        ? await adminUpsertSapAgentFromOobeByDirectoryAgentId(row.agentId)
        : await upsertAgentFromRegistry(row.chainId, row.agentId);
    if (!upsert.ok) {
      const msg = upsert.error || "Could not read this agent from the chain or registration JSON.";
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    const agent = await prisma.agent.findUnique({
      where: { id: upsert.internalId },
      select: agentSelect,
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent missing after sync" }, { status: 500 });
    }
    await invalidateAllPublicStatistics();
    return NextResponse.json({ ok: true, agent });
  } catch (err) {
    console.error("POST /api/admin/verified-agents/[id]/sync-from-registry error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
