import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { prisma } from "@/lib/db";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { walletMatchesAgent } from "@/lib/verify-ownership";
/**
 * GET /api/verify?wallet=0x...
 * Returns all agents owned by the given wallet address.
 */
export async function GET(request: NextRequest) {
  try {
    const wallet = request.nextUrl.searchParams.get("wallet");
    if (!wallet) {
      return NextResponse.json({ error: "wallet param required" }, { status: 400 });
    }
    const [byOwner, byAgentWallet] = await Promise.all([
      prisma.agent.findMany({
        where: { owner: { equals: wallet, mode: "insensitive" } },
        include: { chain: true },
        orderBy: { score: "desc" },
        take: 251,
      }),
      prisma.agent.findMany({
        where: {
          metadata: {
            some: { key: "agentWallet", value: { equals: wallet, mode: "insensitive" } },
          },
        },
        include: { chain: true },
        orderBy: { score: "desc" },
        take: 251,
      }),
    ]);
    const seenIds = new Set(byOwner.map((a) => a.id));
    const agents = [...byOwner];
    for (const a of byAgentWallet) {
      if (!seenIds.has(a.id)) {
        seenIds.add(a.id);
        agents.push(a);
      }
    }
    agents.sort((a, b) => b.score - a.score);
    const truncated = byOwner.length > 250 || byAgentWallet.length > 250 || agents.length > 250;
    const result = agents.slice(0, 250).map((a) => ({
      id: a.id,
      agentId: a.agentId,
      chainId: a.chainId,
      name: a.name,
      image: a.image,
      score: a.score,
      activeBoosts: a.activeBoosts,
      adminPowerAdjust: a.adminPowerAdjust,
      powerScore: a.powerScore,
      isVerified: a.isVerified,
      isPremiumVerified: a.isPremiumVerified,
      slug: toAgentUrlSlug(a.name),
      profilePath: agentPublicPath(a),
      chain: {
        name: a.chain.name,
        shortName: a.chain.shortName,
        color: a.chain.color,
        icon: a.chain.icon,
      },
    }));
    return NextResponse.json({ agents: result, truncated });
  } catch (err) {
    const message = Error.isError(err) ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
/**
 * POST /api/verify
 * Body: { dbId, signature, address, message }
 * Verifies the wallet signature and marks the agent as verified.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dbId, signature, address, message } = body;
    if (!dbId || !signature || !address || !message) {
      return NextResponse.json({ error: "Missing required fields: dbId, signature, address, message" }, { status: 400 });
    }
    const agent = await prisma.agent.findUnique({
      where: { id: dbId },
      include: { metadata: true },
    });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    if (!walletMatchesAgent(address as string, agent)) {
      return NextResponse.json({ error: "Wallet does not match agent owner" }, { status: 403 });
    }
    // Validate that the message contains the correct agent identifiers
    const expectedFragment = `agent #${agent.agentId} on chain ${agent.chainId}`;
    if (!(message as string).includes(expectedFragment)) {
      return NextResponse.json({ error: "Invalid message content" }, { status: 400 });
    }
    // Verify the signature
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message: message as string,
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    // Mark as verified
    const updated = await prisma.agent.update({
      where: { id: dbId },
      data: { isVerified: true },
    });
    await invalidateAllPublicStatistics();
    return NextResponse.json({
      success: true,
      agent: {
        id: updated.id,
        agentId: updated.agentId,
        chainId: updated.chainId,
        name: updated.name,
        isVerified: updated.isVerified,
      },
    });
  } catch (err) {
    const message = Error.isError(err) ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
