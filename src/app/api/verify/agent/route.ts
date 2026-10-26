import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
import { walletMatchesAgent } from "@/lib/verify-ownership";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Numeric machine identity only. Human name lookup belongs to candidate search. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const chainId = parsePublicChainId(searchParams.get("chainId")?.trim() ?? "");
  const agentId = parsePublicAgentId(searchParams.get("id")?.trim() ?? "");
  const wallet = searchParams.get("wallet")?.trim().toLowerCase();
  if (chainId == null || agentId == null) {
    return NextResponse.json(
      { error: "chainId and numeric id are required" },
      { status: 400 },
    );
  }

  const agent = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      image: true,
      owner: true,
      isVerified: true,
      isPremiumVerified: true,
      chain: true,
      metadata: { select: { key: true, value: true } },
    },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agentWallet = agent.metadata.find((m) => m.key === "agentWallet")?.value ?? null;
  const canClaim = wallet ? walletMatchesAgent(wallet, agent) : null;
  return NextResponse.json({
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    image: agent.image,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    owner: agent.owner,
    agentWallet,
    slug: toAgentUrlSlug(agent.name),
    profilePath: agentPublicPath(agent),
    chain: agent.chain,
    ...(canClaim !== null && { canClaim }),
  });
}
