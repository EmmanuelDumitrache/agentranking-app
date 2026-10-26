import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { claimPaymentTransactionInTx, verifyPayment } from "@/lib/payment-verify";
import { sanitizeForPostgres } from "@/lib/utils";
import { getChainByChainId } from "@/lib/chains";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { computeAgentScore } from "@/lib/agent-score";
import { AgentBlocklistError, loadActiveBlocklistRules } from "@/lib/agent-blocklist";
import { assertNotBlocklistedWithRules } from "@/lib/agent-blocklist-logic";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { agentPublicPath } from "@/lib/agent-public-url";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const LISTING_DAYS = 30;
const CustomListingSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional().default(""),
  image: z.string().trim().max(2_048).optional().default(""),
  website: z.string().trim().max(2_048).optional().default(""),
  chainId: z.coerce.number().int().positive(),
  paymentToken: z.enum(["ETH", "USDC", "SOL"]).default("ETH"),
  txHash: z.string().trim().min(1).max(200),
  wallet: z.string().trim().min(1).max(100),
  services: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    endpoint: z.string().trim().max(2_048),
  })).max(20).optional().default([]),
});
/** Creates a custom-listed agent after finalized on-chain payment verification. */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      if (typeof record.paymentToken === "string") {
        record.paymentToken = record.paymentToken.trim().toUpperCase();
      }
    }
    const parsed = CustomListingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 422 });
    }
    const { name, description, image, website, chainId, paymentToken, txHash, wallet, services } = parsed.data;
    if (chainId === SOLANA_CHAIN_ID) {
      return NextResponse.json(
        { error: "Custom listing on the synthetic Solana chain id is not supported." },
        { status: 400 },
      );
    }
    const chainConfig = getChainByChainId(chainId);
    if (!chainConfig) {
      return NextResponse.json({ error: `Unknown chain: ${chainId}` }, { status: 400 });
    }
    const result = await verifyPayment(paymentToken, txHash, "custom_listing", wallet);
    const serviceData = services.map((service) => ({
      name: sanitizeForPostgres(service.name.toUpperCase().slice(0, 20)),
      endpoint: sanitizeForPostgres(service.endpoint),
      version: "1.0",
    }));
    const metadataForScore: Array<{ key: string; value: string }> = [
      { key: "agentWallet", value: sanitizeForPostgres(result.payerWallet) },
      ...(website ? [{ key: "website", value: sanitizeForPostgres(website) }] : []),
    ];
    const now = new Date();
    const cleanName = sanitizeForPostgres(name);
    const cleanDescription = sanitizeForPostgres(description);
    const cleanImage = sanitizeForPostgres(image);
    const cleanWebsite = sanitizeForPostgres(website);
    const cleanOwner = sanitizeForPostgres(result.payerWallet);
    const scores = computeAgentScore({
      name: cleanName,
      description: cleanDescription,
      image: cleanImage,
      metadata: metadataForScore,
      services: serviceData.map((service) => ({ name: service.name, endpoint: service.endpoint })),
      scoreWallet: 100,
      x402Support: false,
      binanceCompatible: false,
      totalFeedback: 0,
      scoreQuality: 0,
      lastActiveAt: now,
    });
    const activeBlocklistRules = await loadActiveBlocklistRules();
    const expiresAt = new Date(now.getTime() + LISTING_DAYS * 24 * 60 * 60 * 1_000);
    const agent = await prisma.$transaction(async (tx) => {
      await claimPaymentTransactionInTx(tx, result.transactionId, result.paymentToken);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('custom-listing-agent-id', 0))`;
      const lastCustom = await tx.agent.findFirst({
        where: { isCustomListed: true },
        orderBy: { agentId: "asc" },
        select: { agentId: true },
      });
      const nextAgentId = lastCustom ? lastCustom.agentId - 1 : -1;
      if (nextAgentId < -2_147_483_648) throw new Error("Custom listing identifier range exhausted");
      assertNotBlocklistedWithRules(activeBlocklistRules, {
        name: cleanName,
        agentURI: cleanWebsite,
        owner: cleanOwner,
        chainId,
        agentId: nextAgentId,
      });
      await tx.chain.upsert({
        where: { chainId },
        create: {
          chainId,
          name: chainConfig.name,
          shortName: chainConfig.shortName,
          icon: chainConfig.icon,
          color: chainConfig.color,
          identityRegistry: chainConfig.identityRegistry,
          reputationRegistry: chainConfig.reputationRegistry,
          agentCount: 0,
          feedbackCount: 0,
          isActive: chainConfig.isActive,
        },
        update: {},
      });
      const created = await tx.agent.create({
        data: {
          agentId: nextAgentId,
          chainId,
          name: cleanName,
          description: cleanDescription,
          image: cleanImage,
          agentURI: cleanWebsite,
          owner: cleanOwner,
          isActive: true,
          isVerified: false,
          isCustomListed: true,
          score: scores.score,
          hotScore: scores.hotScore,
          rank: 0,
          x402Support: false,
          stars: 0,
          totalFeedback: 0,
          scoreMetadata: scores.scoreMetadata,
          scoreServices: scores.scoreEndpoints,
          scoreWallet: 100,
          scoreFreshness: scores.scoreFreshness,
          scorePopularity: scores.scorePopularity,
          lastActiveAt: now,
          supportedTrust: "custom",
          services: { create: serviceData },
          metadata: { create: metadataForScore },
        },
      });
      await tx.promotion.create({
        data: {
          agentId: created.id,
          slotType: "custom_listing",
          txHash: result.transactionId,
          paidAmount: result.paidAmount,
          currency: result.currency,
          paymentToken: result.paymentToken,
          wallet: result.payerWallet,
          expiresAt,
        },
      });
      const agentCount = await tx.agent.count({ where: { chainId } });
      await tx.chain.update({ where: { chainId }, data: { agentCount } });
      return created;
    }, { timeout: 15_000 });
    await invalidateAllPublicStatistics();
    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        agentId: agent.agentId,
        chainId: agent.chainId,
        name: agent.name,
        profilePath: agentPublicPath(agent),
        isCustomListed: true,
      },
    });
  } catch (error) {
    if (error instanceof AgentBlocklistError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("POST /api/custom-listing error:", error);
    return NextResponse.json(
      { error: Error.isError(error) ? error.message : "Failed to create custom listing" },
      { status: 500 },
    );
  }
}
