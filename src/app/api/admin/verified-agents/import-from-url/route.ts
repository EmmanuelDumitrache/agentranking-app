import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { getSession } from "@/lib/admin-auth";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { parseAgentFromUrl } from "@/lib/agent-url-parse";
import { resolveOnChainIdsFromProfileUrl } from "@/lib/resolve-agent-from-link-url";
import { upsertAgentFromRegistry } from "@/lib/erc8004-sync";
import { adminUpsertSapAgentFromOobeByDirectoryAgentId } from "../../../../../../services/sap-indexer";
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
/**
 * POST /api/admin/verified-agents/import-from-url
 * Body: { url: string, isVerified?: boolean, isPremiumVerified?: boolean }
 * URL: …/agents/{chainId}/{agentId}/{current-name-slug}.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      url?: string;
      isVerified?: boolean;
      isPremiumVerified?: boolean;
    };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    const parsed = parseAgentFromUrl(url);
    if (!parsed) {
      return NextResponse.json(
        {
          error:
            "Could not parse agent URL. Use the complete current profile URL: …/agents/{chainId}/{agentId}/{current-name-slug}.",
        },
        { status: 400 }
      );
    }
    const resolved = await resolveOnChainIdsFromProfileUrl(url);
    if (!resolved) {
      return NextResponse.json(
        { error: "That profile URL is missing, obsolete, or does not match the Agent's current name." },
        { status: 400 },
      );
    }
    const { chainId, agentId } = resolved;
    const upsert =
      chainId === SOLANA_CHAIN_ID
        ? await adminUpsertSapAgentFromOobeByDirectoryAgentId(agentId)
        : await upsertAgentFromRegistry(chainId, agentId);
    if (!upsert.ok) {
      const msg = upsert.error || "Could not read this agent from the chain or registration JSON.";
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    const flagPatch: { isVerified?: boolean; isPremiumVerified?: boolean } = {};
    if (typeof body.isVerified === "boolean") {
      flagPatch.isVerified = body.isVerified;
    }
    if (typeof body.isPremiumVerified === "boolean") {
      flagPatch.isPremiumVerified = body.isPremiumVerified;
    }
    if (Object.keys(flagPatch).length > 0) {
      await prisma.agent.update({
        where: { id: upsert.internalId },
        data: flagPatch,
      });
    }
    const agent = await prisma.agent.findUnique({
      where: { id: upsert.internalId },
      select: agentSelect,
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent missing after import" }, { status: 500 });
    }
    await invalidateAllPublicStatistics();
    return NextResponse.json({
      ok: true,
      created: upsert.created,
      agent,
    });
  } catch (err) {
    console.error("POST /api/admin/verified-agents/import-from-url error:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
