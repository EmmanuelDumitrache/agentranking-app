import { prisma } from "@/lib/db";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { sanitizeForPostgres } from "@/lib/utils";
import { getChainByChainId } from "@/lib/chains";
import { computeAgentScore } from "@/lib/agent-score";
import { assertNotBlocklisted, AgentBlocklistError } from "@/lib/agent-blocklist";
import {
  AGENT_RANKING_LISTING_METADATA_KEY,
  mergeDescriptionWithListingAttribution,
  mergeRegisterMetadataForDb,
} from "@/lib/site-agent-listing-attribution";
export type RegisterAgentInput = {
  chainId: number;
  agentId: number;
  name: string;
  description?: string;
  image?: string;
  owner: string;
  services?: Array<{ name: string; endpoint: string }>;
  txHash?: string;
  metadata?: Array<{ key: string; value: string }>;
};
export async function upsertRegisteredAgent(input: RegisterAgentInput) {
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
  } = input;
  const chainConfig = getChainByChainId(chainId);
  if (!chainConfig) {
    throw new Error(`Unknown chain: ${chainId}`);
  }
  await prisma.chain.upsert({
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
  const serviceData = (services ?? []).map((s) => ({
    name: sanitizeForPostgres(s.name.toUpperCase().slice(0, 20)),
    endpoint: sanitizeForPostgres(s.endpoint),
    version: "1.0",
  }));
  const mergedDescription = mergeDescriptionWithListingAttribution(description ?? "");
  const nextDescription = sanitizeForPostgres(mergedDescription);
  const mergedMetaRows = mergeRegisterMetadataForDb(owner, bodyMetadata);
  const metaRowsForScore = mergedMetaRows.map(({ key, value }) => ({
    key: sanitizeForPostgres(key.slice(0, 80)),
    value: sanitizeForPostgres(value),
  }));
  const scoreWallet = 100;
  const initialScores = computeAgentScore({
    name,
    description: mergedDescription,
    image: image || "",
    metadata: metaRowsForScore,
    services: serviceData,
    scoreWallet,
    x402Support: false,
    binanceCompatible: false,
    totalFeedback: 0,
    scoreQuality: 0,
    lastActiveAt: new Date(),
  });
  const existing = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
  });
  const nextName = sanitizeForPostgres(name);
  const nextOwner = sanitizeForPostgres(owner);
  const nextUri = existing
    ? existing.agentURI
    : txHash
      ? sanitizeForPostgres(`tx:${txHash}`)
      : "";
  try {
    await assertNotBlocklisted({
      name: nextName,
      agentURI: nextUri,
      owner: nextOwner,
      chainId,
      agentId,
    });
  } catch (e) {
    if (e instanceof AgentBlocklistError) throw e;
    throw e;
  }
  let agent;
  if (existing) {
    agent = await prisma.agent.update({
      where: { agentId_chainId: { agentId, chainId } },
      data: {
        name: nextName,
        description: nextDescription,
        image: sanitizeForPostgres(image || ""),
        owner: nextOwner,
        scoreMetadata: initialScores.scoreMetadata,
        scoreServices: initialScores.scoreEndpoints,
        scoreWallet,
        scoreFreshness: initialScores.scoreFreshness,
        scorePopularity: initialScores.scorePopularity,
        score: initialScores.score,
        hotScore: initialScores.hotScore,
        services: {
          deleteMany: {},
          create: serviceData,
        },
      },
    });
    const keysToRefresh = new Set<string>(["agentWallet", AGENT_RANKING_LISTING_METADATA_KEY]);
    if (bodyMetadata !== undefined) {
      for (const e of bodyMetadata) {
        const k = sanitizeForPostgres(e.key.trim().slice(0, 80));
        if (k && k !== "agentWallet" && k !== AGENT_RANKING_LISTING_METADATA_KEY) {
          keysToRefresh.add(k);
        }
      }
    }
    await prisma.agentMetadata.deleteMany({
      where: { agentId: existing.id, key: { in: [...keysToRefresh] } },
    });
    await prisma.agentMetadata.createMany({
      data: metaRowsForScore.map((m) => ({
        agentId: existing.id,
        key: m.key,
        value: m.value,
      })),
    });
  } else {
    agent = await prisma.agent.create({
      data: {
        agentId,
        chainId,
        name: nextName,
        description: nextDescription,
        image: sanitizeForPostgres(image || ""),
        agentURI: nextUri,
        owner: nextOwner,
        isActive: true,
        isVerified: false,
        score: initialScores.score,
        hotScore: initialScores.hotScore,
        rank: 0,
        x402Support: false,
        stars: 0,
        totalFeedback: 0,
        scoreWallet,
        scoreMetadata: initialScores.scoreMetadata,
        scoreServices: initialScores.scoreEndpoints,
        scoreFreshness: initialScores.scoreFreshness,
        scorePopularity: initialScores.scorePopularity,
        supportedTrust: "reputation",
        services: {
          create: serviceData,
        },
        metadata: {
          create: metaRowsForScore.map((m) => ({
            key: m.key,
            value: m.value,
          })),
        },
      },
    });
  }
  const agentCount = await prisma.agent.count({ where: { chainId } });
  await prisma.chain.update({
    where: { chainId },
    data: { agentCount },
  });
  await invalidateAllPublicStatistics();
  return agent;
}
