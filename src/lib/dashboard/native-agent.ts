import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AGENTRANKING_NATIVE_CHAIN_ID } from "@/lib/chain-constants";
import { getChainByChainId } from "@/lib/chains";
import { computeAgentScore } from "@/lib/agent-score";
import { assertNotBlocklisted, AgentBlocklistError } from "@/lib/agent-blocklist";
import { sanitizeForPostgres } from "@/lib/utils";
import {
  normalizeOptionalWebsiteUrl,
  normalizeUserMediaUrl,
} from "@/lib/public-media-url";
import { ensureAppAccountForProfile } from "@/lib/custodial-wallet/bootstrap";
import { attachAgentWalletInTx, attachAgentEvmWalletInTx } from "@/lib/custodial-wallet/read";
import {
  provisionCustodialSolanaWallet,
  provisionCustodialEvmWallet,
} from "@/lib/custodial-wallet/provision";
import { buildAgentLaunchFeedEvent } from "@/lib/public-site/ar-live-feed-builders.server";
import { publishArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-publish.server";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
export const AGENTRANKING_LISTING_SOURCE = "agentranking" as const;
export type CreateNativeAgentInput = {
  readonly name: string;
  readonly description?: string;
  readonly persona?: string;
  readonly image?: string;
  readonly website?: string;
  readonly twitter?: string;
  readonly telegram?: string;
  readonly github?: string;
  readonly tags?: readonly string[];
  readonly metadata?: readonly { readonly key: string; readonly value: string }[];
  readonly agentWallet?: string;
};
export type CreateNativeAgentProfile = {
  readonly id: number;
  readonly walletAddress: string | null;
  readonly solanaWallet: string | null;
};
function normalizeHandle(value: string | undefined): string {
  return (value?.trim() ?? "").replace(/^@/, "");
}
export async function ensureAgentRankingNativeChain(): Promise<void> {
  const chainConfig = getChainByChainId(AGENTRANKING_NATIVE_CHAIN_ID);
  if (!chainConfig) {
    throw new Error("AgentRanking native chain is not configured");
  }
  await prisma.chain.upsert({
    where: { chainId: AGENTRANKING_NATIVE_CHAIN_ID },
    create: {
      chainId: AGENTRANKING_NATIVE_CHAIN_ID,
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
}
async function nextNativeAgentId(tx: Prisma.TransactionClient): Promise<number> {
  // Native AgentRanking IDs descend from -1. Serialise allocation in PostgreSQL
  // so concurrent public launches cannot calculate and insert the same ID.
  // Use $executeRaw — pg_advisory_xact_lock returns void; $queryRaw fails to deserialize it.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AGENTRANKING_NATIVE_CHAIN_ID}, 1)`;
  const last = await tx.agent.findFirst({
    where: {
      chainId: AGENTRANKING_NATIVE_CHAIN_ID,
      listingRegistrySource: AGENTRANKING_LISTING_SOURCE,
    },
    orderBy: { agentId: "asc" },
    select: { agentId: true },
  });
  const next = last ? last.agentId - 1 : -1;
  if (!Number.isSafeInteger(next) || next >= 0 || next < -2_147_483_648) {
    throw new Error("AgentRanking native agent ID space is exhausted");
  }
  return next;
}
export async function createNativeAgentRankingAgent(
  profile: CreateNativeAgentProfile,
  input: CreateNativeAgentInput,
) {
  const name = input.name.trim();
  if (!name || name.length > 80) {
    throw new Error("Name is required and must be 80 characters or less");
  }
  const description = (input.description ?? "").trim().slice(0, 2000);
  const persona = (input.persona ?? "").trim().slice(0, 1000);
  const image = normalizeUserMediaUrl(input.image, "Avatar");
  const website = normalizeOptionalWebsiteUrl(input.website);
  const twitter = normalizeHandle(input.twitter);
  const telegram = normalizeHandle(input.telegram);
  const github = normalizeHandle(input.github);
  const tags = (input.tags ?? [])
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
  await ensureAgentRankingNativeChain();
  const chainId = AGENTRANKING_NATIVE_CHAIN_ID;
  const appAccount = await ensureAppAccountForProfile({
    id: profile.id,
    displayName: null,
    email: null,
    avatarUrl: null,
  });
  const metadataEntries: Array<{ key: string; value: string }> = [
    { key: "origin", value: "agentranking_native" },
    { key: "creatorProfileId", value: String(profile.id) },
  ];
  if (website) metadataEntries.push({ key: "website", value: sanitizeForPostgres(website) });
  if (twitter) metadataEntries.push({ key: "twitter", value: sanitizeForPostgres(twitter) });
  if (telegram) metadataEntries.push({ key: "telegram", value: sanitizeForPostgres(telegram) });
  if (github) metadataEntries.push({ key: "github", value: sanitizeForPostgres(github) });
  if (persona) metadataEntries.push({ key: "persona", value: sanitizeForPostgres(persona) });
  for (const tag of tags) {
    metadataEntries.push({ key: "capability", value: sanitizeForPostgres(tag) });
  }
  for (const row of input.metadata ?? []) {
    const key = row.key.trim().slice(0, 128);
    const value = row.value.trim().slice(0, 4_096);
    if (!key || !value) continue;
    if (metadataEntries.some((entry) => entry.key === key && entry.value === value)) continue;
    metadataEntries.push({
      key: sanitizeForPostgres(key),
      value: sanitizeForPostgres(value),
    });
  }
  const now = new Date();
  const scores = computeAgentScore({
    name,
    description,
    image,
    metadata: metadataEntries,
    services: [],
    scoreWallet: 100,
    x402Support: false,
    binanceCompatible: false,
    totalFeedback: 0,
    scoreQuality: 0,
    lastActiveAt: now,
  });
  const provisionedWallet = await prisma.$transaction(async (tx) => {
    const agentId = await nextNativeAgentId(tx);
    const wallet = await provisionCustodialSolanaWallet(tx, {
      scope: "AGENT",
      actorProfileId: profile.id,
    });
    const evmWallet = await provisionCustodialEvmWallet(tx, {
      scope: "AGENT",
      actorProfileId: profile.id,
    });
    metadataEntries.push({ key: "agentWallet", value: sanitizeForPostgres(wallet.publicKey) });
    try {
      await assertNotBlocklisted({
        name: sanitizeForPostgres(name),
        agentURI: website ? sanitizeForPostgres(website) : "",
        owner: sanitizeForPostgres(wallet.publicKey),
        chainId,
        agentId,
      });
    } catch (error) {
      if (error instanceof AgentBlocklistError) {
        throw new Error(error.message);
      }
      throw error;
    }
    const created = await tx.agent.create({
      data: {
        agentId,
        chainId,
        name: sanitizeForPostgres(name),
        description: sanitizeForPostgres(description),
        image: image ? sanitizeForPostgres(image) : "",
        agentURI: website ? sanitizeForPostgres(website) : "",
        owner: sanitizeForPostgres(wallet.publicKey),
        listingRegistrySource: AGENTRANKING_LISTING_SOURCE,
        isActive: true,
        isVerified: false,
        score: scores.score,
        hotScore: scores.hotScore,
        rank: 0,
        x402Support: false,
        mppSupport: false,
        stars: 0,
        totalFeedback: 0,
        scoreWallet: 100,
        scoreMetadata: scores.scoreMetadata,
        scoreServices: scores.scoreEndpoints,
        scoreFreshness: scores.scoreFreshness,
        scorePopularity: scores.scorePopularity,
        supportedTrust: "agentranking",
        lastActiveAt: now,
        listedAt: now,
        metadata: { create: metadataEntries.map((row) => ({ key: row.key, value: row.value })) },
      },
      select: { id: true, agentId: true, chainId: true, name: true },
    });
    await attachAgentWalletInTx(tx, created.id, wallet.id, wallet.publicKey);
    await attachAgentEvmWalletInTx(tx, created.id, evmWallet.id, evmWallet.publicKey);
    await tx.$executeRaw`
      UPDATE "Agent" SET owner_account_id = ${appAccount.id} WHERE id = ${created.id}
    `;
    await tx.sapAgentOperatorClaim.create({
      data: {
        agentId: created.id,
        userProfileId: profile.id,
        solanaWallet: profile.solanaWallet?.trim() || profile.walletAddress?.trim() || "",
      },
    });
    // Increment in the same transaction as the agent insert. A post-commit
    // count-then-set sequence can write a stale count when two agents are
    // created concurrently.
    await tx.chain.update({
      where: { chainId },
      data: { agentCount: { increment: 1 } },
    });
    return { wallet, evmWallet, agent: created };
  });
  const agent = provisionedWallet.agent;
  await invalidateAllPublicStatistics();
  publishArLiveFeedEvent(
    buildAgentLaunchFeedEvent({
      agentDbId: agent.id,
      chainId: agent.chainId,
      agentId: agent.agentId,
      name: agent.name,
      description: input.description ?? null,
      listedAt: new Date(),
    }),
  );
  return agent;
}
export function isAgentRankingNativeAgent(agent: {
  listingRegistrySource: string;
  chainId: number;
}): boolean {
  return (
    agent.listingRegistrySource === AGENTRANKING_LISTING_SOURCE &&
    agent.chainId === AGENTRANKING_NATIVE_CHAIN_ID
  );
}
