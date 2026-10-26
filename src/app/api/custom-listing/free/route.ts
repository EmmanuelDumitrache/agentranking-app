import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sanitizeForPostgres } from "@/lib/utils";
import { getChainByChainId } from "@/lib/chains";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { hash } from "node:crypto";
import { computeAgentScore } from "@/lib/agent-score";
import { AgentBlocklistError, loadActiveBlocklistRules } from "@/lib/agent-blocklist";
import { assertNotBlocklistedWithRules } from "@/lib/agent-blocklist-logic";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { agentPublicPath } from "@/lib/agent-public-url";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
function getIpHashes(request: NextRequest): { current: string; recent: string[] } {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const current = hash("sha256", `free-listing:${ip}`, "hex");
  return {
    current,
    recent: [
      current,
      hash("sha256", `free-listing:${ip}:${now.toISOString().slice(0, 10)}`, "hex"),
      hash("sha256", `free-listing:${ip}:${yesterday.toISOString().slice(0, 10)}`, "hex"),
    ],
  };
}
/**
 * POST /api/custom-listing/free
 * Free listing — no payment required. Rate limited to 1 per IP per 24h.
 * Body: { name, description?, website?, chainId, tokenAddress?, services? }
 */
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = ((body.description as string) || "").trim();
    const website = ((body.website as string) || "").trim();
    const chainId = Number(body.chainId);
    const tokenAddress = ((body.tokenAddress as string) || "").trim();
    const image = ((body.image as string) || "").trim();
    const services = (body.services as Array<{ name: string; endpoint: string }>) || [];
    const archetype = ((body.archetype as string) || "").trim().toLowerCase();
    // Telegram-specific metadata fields
    const telegramBotUsername = ((body.telegramBotUsername as string) || "").trim().replace(/^@/, "");
    const telegramManagerBotUsername = ((body.telegramManagerBotUsername as string) || "").trim().replace(/^@/, "");
    const telegramSpawnUrl = ((body.telegramSpawnUrl as string) || "").trim();
    const telegramBotType = ((body.telegramBotType as string) || "").trim();
    if (!name || !Number.isInteger(chainId)) {
      return NextResponse.json({ error: "Missing required fields: name, chainId" }, { status: 400 });
    }
    if (chainId === SOLANA_CHAIN_ID) {
      return NextResponse.json(
        { error: "Free listing on the synthetic Solana chain id is not supported." },
        { status: 400 }
      );
    }
    if (name.length > 80) {
      return NextResponse.json({ error: "Name must be 80 characters or less" }, { status: 400 });
    }
    const chainConfig = getChainByChainId(chainId);
    if (!chainConfig) {
      return NextResponse.json({ error: `Unknown chain: ${chainId}` }, { status: 400 });
    }
    const ipHashes = getIpHashes(request);
    const ipHash = ipHashes.current;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const serviceData = services
      .filter((s) => s.name?.trim())
      .map((s) => ({
        name: sanitizeForPostgres(s.name.toUpperCase().slice(0, 20)),
        endpoint: sanitizeForPostgres(s.endpoint || ""),
        version: "1.0",
      }));
    const metadataEntries: Array<{ key: string; value: string }> = [];
    if (website) metadataEntries.push({ key: "website", value: sanitizeForPostgres(website) });
    if (tokenAddress) metadataEntries.push({ key: "tokenAddress", value: sanitizeForPostgres(tokenAddress) });
    if (telegramBotUsername) metadataEntries.push({ key: "telegramBotUsername", value: sanitizeForPostgres(telegramBotUsername) });
    if (telegramManagerBotUsername) metadataEntries.push({ key: "telegramManagerBotUsername", value: sanitizeForPostgres(telegramManagerBotUsername) });
    if (telegramSpawnUrl) metadataEntries.push({ key: "telegramSpawnUrl", value: sanitizeForPostgres(telegramSpawnUrl) });
    if (telegramBotType) metadataEntries.push({ key: "telegramBotType", value: sanitizeForPostgres(telegramBotType) });
    const now = new Date();
    const scores = computeAgentScore({
      name: sanitizeForPostgres(name),
      description: sanitizeForPostgres(description),
      image: image || "",
      metadata: metadataEntries,
      services: serviceData.map((s) => ({ name: s.name, endpoint: s.endpoint })),
      scoreWallet: 0,
      x402Support: false,
      binanceCompatible: false,
      totalFeedback: 0,
      scoreQuality: 0,
      lastActiveAt: now,
    });
    const ALLOWED_LISTING_ARCHETYPES = [
      "trading", "arbitrage", "sniper", "yield", "builder",
      "analytics", "bridge", "copy_trader", "social", "mev", "telegram",
    ];
    const resolvedArchetype = ALLOWED_LISTING_ARCHETYPES.includes(archetype) ? archetype : "";
    const activeBlocklistRules = await loadActiveBlocklistRules();
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`free-listing-rate:${ipHash}`}, 0))`;
      const recentCount = await tx.agent.count({
        where: {
          isCustomListed: true,
          supportedTrust: "free",
          owner: { in: ipHashes.recent },
          createdAt: { gt: cutoff },
        },
      });
      if (recentCount >= 1) return { rateLimited: true as const };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('custom-listing-agent-id', 0))`;
      const lastCustom = await tx.agent.findFirst({
        where: { isCustomListed: true },
        orderBy: { agentId: "asc" },
        select: { agentId: true },
      });
      const nextAgentId = lastCustom ? lastCustom.agentId - 1 : -1;
      assertNotBlocklistedWithRules(activeBlocklistRules, {
        name: sanitizeForPostgres(name),
        agentURI: website ? sanitizeForPostgres(website) : "",
        owner: ipHash,
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
      const agent = await tx.agent.create({
        data: {
          agentId: nextAgentId,
          chainId,
          name: sanitizeForPostgres(name),
          description: sanitizeForPostgres(description),
          image: image || "",
          agentURI: website ? sanitizeForPostgres(website) : "",
          owner: ipHash, // store IP hash for rate limiting
          isActive: true,
          isVerified: false,
          isCustomListed: true,
          tokenAddress: tokenAddress ? sanitizeForPostgres(tokenAddress) : "",
          archetype: resolvedArchetype,
          archetypeAuto: false,
          score: scores.score,
          hotScore: scores.hotScore,
          powerScore: 0,
          rank: 0,
          x402Support: false,
          stars: 0,
          totalFeedback: 0,
          scoreMetadata: scores.scoreMetadata,
          scoreServices: scores.scoreEndpoints,
          scoreWallet: 0,
          scoreFreshness: scores.scoreFreshness,
          scorePopularity: scores.scorePopularity,
          lastActiveAt: now,
          supportedTrust: "free",
          services: { create: serviceData },
          metadata: { create: metadataEntries },
        },
        select: { id: true, agentId: true, chainId: true, name: true },
      });
      const agentCount = await tx.agent.count({ where: { chainId } });
      await tx.chain.update({ where: { chainId }, data: { agentCount } });
      return { rateLimited: false as const, agent };
    });
    if (result.rateLimited) {
      return NextResponse.json(
        { error: "Rate limit: 1 free listing per IP per 24 hours. Try again tomorrow." },
        { status: 429 }
      );
    }
    await invalidateAllPublicStatistics();
    return NextResponse.json({
      ok: true,
      agentId: result.agent.agentId,
      chainId: result.agent.chainId,
      profilePath: agentPublicPath(result.agent),
    });
  } catch (err) {
    if (err instanceof AgentBlocklistError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("POST /api/custom-listing/free error:", err);
    return NextResponse.json({ error: Error.isError(err) ? err.message : "Failed to submit" }, { status: 500 });
  }
}
