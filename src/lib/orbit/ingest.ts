import { agentPublicPath, agentPublicUrl, toAgentUrlSlug } from "@/lib/agent-public-url";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { computeAgentScore } from "@/lib/agent-score";
import { assertNotBlocklisted, AgentBlocklistError } from "@/lib/agent-blocklist";
import { getChainByChainId } from "@/lib/chains";
import { upsertAgentSignals } from "@/lib/signals/store";
import {
  ORBIT_LAUNCH_BADGE_LABEL,
  ORBIT_LAUNCH_ID_METADATA_KEY,
  ORBIT_LISTING_REGISTRY_SOURCE,
  ORBIT_SIGNAL_TYPE,
} from "@/lib/orbit/config";
import type { NormalizedOrbitIngestPayload, OrbitIngestResult } from "@/lib/orbit/types";
import { metadataEntriesFromPayload } from "@/lib/orbit/ingest-payload";
import { getPublicSiteUrl } from "@/lib/site-url";
import { sanitizeForPostgres } from "@/lib/utils";
const ORBIT_INGEST_ADVISORY_LOCK = 1902543783;
type MetadataEntry = { key: string; value: string };
async function replaceOrbitMetadata(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  entries: MetadataEntry[],
): Promise<void> {
  const keys = entries.map((entry) => entry.key);
  await tx.agentMetadata.deleteMany({
    where: { agentId: agentDbId, key: { in: keys } },
  });
  if (entries.length === 0) return;
  await tx.agentMetadata.createMany({
    data: entries.map((entry) => ({ agentId: agentDbId, key: entry.key, value: entry.value })),
    skipDuplicates: true,
  });
}
async function lookupAgentDbIdByOrbitLaunchId(
  orbitLaunchId: string,
  tx?: Prisma.TransactionClient,
): Promise<number | null> {
  const client = tx ?? prisma;
  const row = await client.agentMetadata.findFirst({
    where: { key: ORBIT_LAUNCH_ID_METADATA_KEY, value: orbitLaunchId },
    select: { agentId: true },
  });
  return row?.agentId ?? null;
}
async function lookupAgentDbIdByTokenMint(
  tokenMint: string,
  tx?: Prisma.TransactionClient,
): Promise<number | null> {
  if (!tokenMint) return null;
  const client = tx ?? prisma;
  const row = await client.agent.findFirst({
    where: {
      OR: [{ tokenAddress: tokenMint }, { metaplexAgentTokenMint: tokenMint }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return row?.id ?? null;
}
async function ensureChainRow(tx: Prisma.TransactionClient, chainId: number): Promise<void> {
  const chainConfig = getChainByChainId(chainId);
  if (!chainConfig) throw new Error(`Unknown chainId: ${chainId}`);
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
    update: { isActive: chainConfig.isActive },
  });
}
async function nextOrbitCustomAgentId(tx: Prisma.TransactionClient, chainId: number): Promise<number> {
  const lastCustom = await tx.agent.findFirst({
    where: { chainId, isCustomListed: true },
    orderBy: { agentId: "asc" },
    select: { agentId: true },
  });
  return lastCustom ? lastCustom.agentId - 1 : -1;
}
function scoreInput(
  payload: NormalizedOrbitIngestPayload,
  metadata: MetadataEntry[],
  image: string,
) {
  const now = new Date();
  return computeAgentScore({
    name: payload.name,
    description: payload.description,
    image,
    metadata,
    services: [],
    scoreWallet: payload.owner ? 50 : 0,
    x402Support: false,
    binanceCompatible: false,
    totalFeedback: 0,
    scoreQuality: 0,
    lastActiveAt: now,
  });
}
async function upsertOrbitLaunchSignal(agentDbId: number, payload: NormalizedOrbitIngestPayload) {
  const now = new Date();
  await upsertAgentSignals(agentDbId, [
    {
      signalType: ORBIT_SIGNAL_TYPE,
      status: "partner_registered",
      source: "orbit",
      confidence: "high",
      value: ORBIT_LAUNCH_BADGE_LABEL,
      payloadJson: {
        source: ORBIT_LISTING_REGISTRY_SOURCE,
        sourceType: "partner_launch",
        status: "active",
        orbitLaunchId: payload.orbitLaunchId,
        orbitUrl: payload.orbitUrl || undefined,
        tokenMint: payload.tokenMint || undefined,
        launchedAt: payload.launchedAt || undefined,
      },
      evidenceUrl: payload.orbitUrl || undefined,
      verifiedAt: now,
      lastCheckedAt: now,
    },
  ]);
}
export async function ingestOrbitAgent(
  payload: NormalizedOrbitIngestPayload,
): Promise<OrbitIngestResult> {
  const metadataEntries = metadataEntriesFromPayload(payload);
  let created = false;
  let updated = false;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ORBIT_INGEST_ADVISORY_LOCK})`;
    await ensureChainRow(tx, payload.chainId);
    let agentDbId =
      (await lookupAgentDbIdByOrbitLaunchId(payload.orbitLaunchId, tx)) ??
      (await lookupAgentDbIdByTokenMint(payload.tokenMint, tx));
    const existingAgent = agentDbId
      ? await tx.agent.findUnique({
          where: { id: agentDbId },
          select: {
            id: true,
            agentId: true,
            chainId: true,
            name: true,
            description: true,
            image: true,
            owner: true,
            tokenAddress: true,
            metaplexAssetAddress: true,
            agentURI: true,
          },
        })
      : null;
    const nextImage = payload.imageUrl || existingAgent?.image || "";
    const scores = scoreInput(payload, metadataEntries, nextImage);
    const now = new Date();
    if (existingAgent) {
      updated = true;
      const metaplexUpdate =
        payload.metaplexAssetId && !existingAgent.metaplexAssetAddress
          ? { metaplexAssetAddress: payload.metaplexAssetId }
          : {};
      await tx.agent.update({
        where: { id: existingAgent.id },
        data: {
          name: payload.name,
          description: payload.description || existingAgent.description,
          image: nextImage,
          owner: payload.owner || existingAgent.owner,
          tokenAddress: payload.tokenMint || existingAgent.tokenAddress,
          agentURI: payload.websiteUrl || payload.orbitUrl || existingAgent.agentURI,
          listingRegistrySource: ORBIT_LISTING_REGISTRY_SOURCE,
          isActive: true,
          isCustomListed: true,
          isVerified: false,
          lastActiveAt: now,
          ...(payload.tokenMint ? { metaplexAgentTokenMint: payload.tokenMint } : {}),
          ...metaplexUpdate,
          score: scores.score,
          hotScore: scores.hotScore,
          scoreMetadata: scores.scoreMetadata,
          scoreServices: scores.scoreEndpoints,
          scoreFreshness: scores.scoreFreshness,
          scorePopularity: scores.scorePopularity,
        },
      });
      await replaceOrbitMetadata(tx, existingAgent.id, metadataEntries);
      agentDbId = existingAgent.id;
    } else {
      created = true;
      const nextAgentId = await nextOrbitCustomAgentId(tx, payload.chainId);
      try {
        await assertNotBlocklisted({
          name: payload.name,
          agentURI: payload.websiteUrl || payload.orbitUrl || "",
          owner: payload.owner,
          chainId: payload.chainId,
          agentId: nextAgentId,
        });
      } catch (error) {
        if (error instanceof AgentBlocklistError) {
          throw error;
        }
        throw error;
      }
      const agent = await tx.agent.create({
        data: {
          agentId: nextAgentId,
          chainId: payload.chainId,
          name: payload.name,
          description: payload.description,
          image: nextImage,
          agentURI: sanitizeForPostgres((payload.websiteUrl || payload.orbitUrl).slice(0, 2000)),
          owner: payload.owner,
          isActive: true,
          isCustomListed: true,
          isVerified: false,
          listingRegistrySource: ORBIT_LISTING_REGISTRY_SOURCE,
          tokenAddress: payload.tokenMint,
          metaplexAgentTokenMint: payload.tokenMint || null,
          metaplexAssetAddress: payload.metaplexAssetId || null,
          score: scores.score,
          hotScore: scores.hotScore,
          rank: 0,
          x402Support: false,
          stars: 0,
          totalFeedback: 0,
          scoreMetadata: scores.scoreMetadata,
          scoreServices: scores.scoreEndpoints,
          scoreWallet: payload.owner ? 50 : 0,
          scoreFreshness: scores.scoreFreshness,
          scorePopularity: scores.scorePopularity,
          supportedTrust: "reputation",
          powerScore: 0,
          lastActiveAt: now,
          listedAt: payload.launchedAt ? new Date(payload.launchedAt) : now,
          metadata: { create: metadataEntries },
        },
        select: { id: true, agentId: true, chainId: true },
      });
      await tx.chain.update({
        where: { chainId: payload.chainId },
        data: { agentCount: { increment: 1 } },
      });
      agentDbId = agent.id;
    }
    if (agentDbId == null) {
      throw new Error("Orbit ingest failed to resolve agent id.");
    }
    const agentRow = await tx.agent.findUniqueOrThrow({
      where: { id: agentDbId },
      select: { id: true, agentId: true, chainId: true, name: true, isPremiumVerified: true, isVerified: true, score: true },
    });
    return agentRow;
  });
  await upsertOrbitLaunchSignal(result.id, payload);
  await invalidateAllPublicStatistics();
  const agentSlug = toAgentUrlSlug(result.name);
  const profilePath = agentPublicPath(result);
  const agentUrl = agentPublicUrl(getPublicSiteUrl(), result);
  return {
    ok: true,
    agentDbId: result.id,
    agentId: result.agentId,
    chainId: result.chainId,
    agentSlug,
    profilePath,
    agentUrl,
    badge: ORBIT_LAUNCH_BADGE_LABEL,
    created,
    updated,
  };
}
export {
  lookupAgentDbIdByOrbitLaunchId,
  lookupAgentDbIdByTokenMint,
};
