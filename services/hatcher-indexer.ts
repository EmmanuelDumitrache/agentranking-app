/**
 * Hatcher Labs partner indexer — public Explore feed → Postgres (chain 990002).
 * No SAP / Covenant paths. Page loads read DB only.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { forEachWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import { computeAgentScore } from "@/lib/agent-score";
import { persistAgentScoresById } from "@/lib/persist-agent-scores";
import { resolveImageUrl } from "@/lib/image-utils";
import {
  HATCHER_CHAIN_ID,
  HATCHER_ID_METADATA_KEY,
  HATCHER_LISTING_REGISTRY_SOURCE,
  HATCHER_METADATA_KEY,
  HATCHER_PROJECTION_DIGEST_KEY,
  HATCHER_SYNC_RUN_KEY,
  resolveHatcherSyncConcurrency,
  resolveHatcherSyncLimit,
} from "@/lib/hatcher/config";
import {
  fetchAllHatcherExploreAgents,
  fetchHatcherMcpManifest,
  fetchHatcherPassport,
  fetchHatcherPublicStats,
} from "@/lib/hatcher/client";
import { hatcherPublicId } from "@/lib/hatcher/links";
import { lookupAgentDbIdByHatcherId } from "@/lib/hatcher/lookup";
import {
  buildHatcherMetadataFromExplore,
  parseHatcherMetadata,
  serializeHatcherMetadata,
  type HatcherDetailFetchResult,
} from "@/lib/hatcher/snapshot";
import type { HatcherExploreAgent } from "@/lib/hatcher/types";
const HATCHER_INDEXER_TX = { maxWait: 20_000, timeout: 120_000 } as const;
const HATCHER_ADVISORY_LOCK = 1902543782;
const HATCHER_ERROR_DETAIL_LIMIT = 250;
const HATCHER_DETAIL_REFRESH_WINDOW_MS = 2 * 60 * 60 * 1_000;
const HATCHER_DETAIL_REFRESH_SHARDS = 12;
async function hatcherUpsertTxnLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${HATCHER_ADVISORY_LOCK})`;
}
async function ensureHatcherChain(tx: Prisma.TransactionClient): Promise<void> {
  await tx.chain.upsert({
    where: { chainId: HATCHER_CHAIN_ID },
    create: {
      chainId: HATCHER_CHAIN_ID,
      name: "Hatcher",
      shortName: "HATCHER",
      icon: "/branding/hatcher/hatcher-icon.svg",
      color: "#22c55e",
      identityRegistry: "",
      reputationRegistry: "",
      isActive: true,
    },
    update: { isActive: true },
  });
}
async function nextHatcherAgentId(tx: Prisma.TransactionClient): Promise<number> {
  const agg = await tx.agent.aggregate({
    where: { chainId: HATCHER_CHAIN_ID },
    _max: { agentId: true },
  });
  return (agg._max.agentId ?? 0) + 1;
}
async function replaceHatcherMetadata(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  hatcherId: string,
  hatcherJson: string,
  projectionDigest: string,
): Promise<void> {
  // Preserve the canonical row when its value is unchanged. The old
  // delete/reinsert pair generated four index mutations per agent on every
  // partner sweep even when the feed projection was identical.
  await tx.$executeRaw`
    WITH desired(key, value) AS (
      VALUES
        (${HATCHER_ID_METADATA_KEY}, ${hatcherId}),
        (${HATCHER_METADATA_KEY}, ${hatcherJson.slice(0, 48000)}),
        (${HATCHER_PROJECTION_DIGEST_KEY}, ${projectionDigest})
    ), kept AS MATERIALIZED (
      SELECT DISTINCT ON (metadata.key) metadata.id, metadata.key, metadata.value
      FROM "AgentMetadata" AS metadata
      INNER JOIN desired ON desired.key = metadata.key
      WHERE metadata."agentId" = ${agentDbId}
      ORDER BY metadata.key, metadata.id
    ), updated AS (
      UPDATE "AgentMetadata" AS metadata
      SET value = desired.value
      FROM desired
      INNER JOIN kept ON kept.key = desired.key
      WHERE metadata.id = kept.id
        AND metadata.value IS DISTINCT FROM desired.value
      RETURNING metadata.id
    ), inserted AS (
      INSERT INTO "AgentMetadata" ("agentId", key, value)
      SELECT ${agentDbId}, desired.key, desired.value
      FROM desired
      WHERE NOT EXISTS (SELECT 1 FROM kept WHERE kept.key = desired.key)
      RETURNING id
    )
    DELETE FROM "AgentMetadata" AS metadata
    WHERE metadata."agentId" = ${agentDbId}
      AND metadata.key IN (
        ${HATCHER_ID_METADATA_KEY},
        ${HATCHER_METADATA_KEY},
        ${HATCHER_PROJECTION_DIGEST_KEY}
      )
      AND NOT EXISTS (SELECT 1 FROM kept WHERE kept.id = metadata.id)
  `;
}
function resolveOwnerString(agent: HatcherExploreAgent): string {
  const username = agent.owner?.username?.trim();
  if (username) return username;
  const wallet = agent.owner?.walletAddress?.trim();
  if (wallet) {
    return wallet.length > 16 ? `${wallet.slice(0, 12)}…` : wallet;
  }
  return "";
}
function shouldIndexExploreAgent(agent: HatcherExploreAgent): boolean {
  if (!agent.id?.trim()) return false;
  if (agent.killed === true) return false;
  if (agent.isPublic === false) return false;
  return true;
}
export type HatcherIndexerResult = {
  ok: boolean;
  agentsFound: number;
  agentsUpserted: number;
  agentsFailed: number;
  agentsSkipped: number;
  detailsFetched: number;
  detailsFailed: number;
  badgeIndexed: number;
  durationMs: number;
  message?: string;
  errors: Array<{ hatcherId?: string; message: string }>;
};
type PriorHatcherAgent = {
  agentDbId: number;
  numericAgentId: number;
  metadata: ReturnType<typeof parseHatcherMetadata>;
  projectionDigest: string | null;
  listedAt: Date;
};

function hatcherDetailRefreshShard(hatcherId: string): number {
  let value = 2_166_136_261;
  for (let index = 0; index < hatcherId.length; index += 1) {
    value ^= hatcherId.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return (value >>> 0) % HATCHER_DETAIL_REFRESH_SHARDS;
}

function shouldRefreshHatcherDetails(
  hatcherId: string,
  prior: PriorHatcherAgent | null,
): boolean {
  if (!prior) return true;
  const fetchedAt = Date.parse(prior.metadata?.lastDetailFetchAt ?? "");
  if (Number.isFinite(fetchedAt) &&
      Date.now() - fetchedAt < HATCHER_DETAIL_REFRESH_WINDOW_MS * HATCHER_DETAIL_REFRESH_SHARDS) {
    return false;
  }
  const currentShard = Math.floor(Date.now() / HATCHER_DETAIL_REFRESH_WINDOW_MS) %
    HATCHER_DETAIL_REFRESH_SHARDS;
  return hatcherDetailRefreshShard(hatcherId) === currentShard;
}
async function loadPriorHatcherMetadata(
  hatcherIds: readonly string[],
): Promise<Map<string, PriorHatcherAgent>> {
  if (hatcherIds.length === 0) return new Map();
  const rows = await prisma.agentMetadata.findMany({
    where: { key: HATCHER_ID_METADATA_KEY, value: { in: [...new Set(hatcherIds)] } },
    select: {
      value: true,
      agentId: true,
      agent: {
        select: {
          agentId: true,
          listedAt: true,
          metadata: {
            where: { key: { in: [HATCHER_METADATA_KEY, HATCHER_PROJECTION_DIGEST_KEY] } },
            select: { key: true, value: true },
          },
        },
      },
    },
  });
  return new Map(rows.map((row) => [row.value, {
    agentDbId: row.agentId,
    numericAgentId: row.agent.agentId,
    metadata: parseHatcherMetadata(row.agent.metadata),
    projectionDigest: row.agent.metadata.find(
      (metadata) => metadata.key === HATCHER_PROJECTION_DIGEST_KEY,
    )?.value ?? null,
    listedAt: row.agent.listedAt,
  }]));
}
async function fetchAgentDetails(
  hatcherId: string,
  publicId: string,
): Promise<HatcherDetailFetchResult | null> {
  const fetchedAt = new Date().toISOString();
  const [publicStats, passportSnapshot, mcpManifestSnapshot] = await Promise.all([
    fetchHatcherPublicStats(hatcherId),
    fetchHatcherPassport(publicId),
    fetchHatcherMcpManifest(publicId),
  ]);
  return {
    publicStats,
    passportSnapshot,
    mcpManifestSnapshot,
    fetchedAt,
  };
}
async function upsertOneHatcherAgent(
  explore: HatcherExploreAgent,
  priorAgent: PriorHatcherAgent | null,
  stats: { detailsFetched: () => void; detailsFailed: () => void },
): Promise<void> {
  const hatcherId = explore.id?.trim();
  if (!hatcherId) throw new Error("missing hatcher id");
  const publicId = hatcherPublicId({ id: hatcherId, slug: explore.slug });
  const details = shouldRefreshHatcherDetails(hatcherId, priorAgent)
    ? await fetchAgentDetails(hatcherId, publicId)
    : null;
  if (details) {
    const anyDetail =
      details.passportSnapshot != null ||
      details.mcpManifestSnapshot != null ||
      details.publicStats != null;
    if (anyDetail) stats.detailsFetched();
    else stats.detailsFailed();
  }
  const candidateMeta = buildHatcherMetadataFromExplore(explore, {
    prior: priorAgent?.metadata ?? null,
    details,
    badge: "indexed",
    source: "explore",
  });
  const stableCandidateMeta = priorAgent?.metadata
    ? { ...candidateMeta, lastIndexedAt: priorAgent.metadata.lastIndexedAt }
    : candidateMeta;
  const priorMetadataJson = priorAgent?.metadata
    ? serializeHatcherMetadata(priorAgent.metadata)
    : null;
  const stableCandidateJson = serializeHatcherMetadata(stableCandidateMeta);
  const metadataUnchanged = priorMetadataJson != null && stableCandidateJson === priorMetadataJson;
  const meta = metadataUnchanged && priorAgent?.metadata
    ? priorAgent.metadata
    : candidateMeta;
  const hatcherJson = metadataUnchanged
    ? priorMetadataJson!
    : stableCandidateMeta === candidateMeta
      ? stableCandidateJson
      : serializeHatcherMetadata(candidateMeta);
  const name = (explore.name ?? "Hatcher Agent").trim() || "Hatcher Agent";
  const description = (explore.description ?? "").trim();
  const image = resolveImageUrl(explore.avatarUrl ?? "") ?? "";
  const owner = resolveOwnerString(explore);
  const metadataEntries: Array<{ key: string; value: string }> = [
    { key: HATCHER_ID_METADATA_KEY, value: hatcherId },
    { key: HATCHER_METADATA_KEY, value: hatcherJson },
  ];
  const services: Array<{ name: string; endpoint: string }> = [];
  const profileLink = meta.links?.profile ?? "";
  if (meta.framework) services.push({ name: meta.framework, endpoint: profileLink });
  if (meta.mcpManifestSnapshot) {
    services.push({ name: "MCP", endpoint: meta.links?.mcpManifest ?? profileLink });
  }
  const observedAt = new Date();
  const scores = computeAgentScore({
    name,
    description,
    image,
    metadata: metadataEntries,
    services,
    scoreWallet: 0,
    x402Support: false,
    binanceCompatible: false,
    totalFeedback: 0,
    scoreQuality: 0,
    lastActiveAt: observedAt,
  });
  const partnerScore = meta.partnerScore ?? 0;
  const score = Math.min(100, Math.max(partnerScore, Math.round(scores.score * 0.4 + partnerScore * 0.6)));
  const stableBaseData: Prisma.AgentUncheckedUpdateInput = {
    name,
    description,
    image,
    owner,
    isActive: true,
    listingRegistrySource: HATCHER_LISTING_REGISTRY_SOURCE,
    sapVerified: false,
    executionScore: 0,
    x402Support: false,
    score,
    hotScore: Math.min(100, scores.hotScore),
    scoreMetadata: scores.scoreMetadata,
    scoreServices: scores.scoreEndpoints,
    scoreFreshness: scores.scoreFreshness,
    protocolTrustScore: partnerScore,
    listedAt: explore.createdAt
      ? new Date(explore.createdAt)
      : priorAgent?.listedAt ?? observedAt,
  };
  const projectionDigest = createHash("sha256")
    .update(JSON.stringify({ agent: stableBaseData, metadata: hatcherJson }))
    .digest("hex");
  if (priorAgent?.projectionDigest === projectionDigest) return;
  await prisma.$transaction(async (tx) => {
    let agentDbId = priorAgent?.agentDbId ?? null;
    let numericAgentId = priorAgent?.numericAgentId ?? null;
    if (agentDbId == null) {
      agentDbId = await lookupAgentDbIdByHatcherId(hatcherId, tx);
      if (agentDbId != null) {
        numericAgentId = (await tx.agent.findUnique({
          where: { id: agentDbId },
          select: { agentId: true },
        }))?.agentId ?? null;
      }
    }
    if (agentDbId == null) {
      // Only ID allocation needs global serialization. Established agents can
      // update concurrently without contending on a process-wide database lock.
      await hatcherUpsertTxnLock(tx);
      agentDbId = await lookupAgentDbIdByHatcherId(hatcherId, tx);
      if (agentDbId != null) {
        numericAgentId = (await tx.agent.findUnique({
          where: { id: agentDbId },
          select: { agentId: true },
        }))?.agentId ?? null;
      } else {
        numericAgentId = await nextHatcherAgentId(tx);
      }
    }
    if (numericAgentId == null) throw new Error(`Hatcher agent ${hatcherId} disappeared during sync`);
    const baseData: Prisma.AgentUncheckedUpdateInput = {
      ...stableBaseData,
      lastActiveAt: observedAt,
    };
    if (agentDbId != null) {
      await tx.agent.update({
        where: { id: agentDbId },
        data: {
          ...baseData,
          agentId: numericAgentId,
          chainId: HATCHER_CHAIN_ID,
        },
      });
    } else {
      const created = await tx.agent.create({
        data: {
          name: baseData.name as string,
          description: baseData.description as string,
          image: baseData.image as string,
          owner: baseData.owner as string,
          isActive: true,
          listingRegistrySource: HATCHER_LISTING_REGISTRY_SOURCE,
          sapVerified: false,
          executionScore: 0,
          x402Support: false,
          score: baseData.score as number,
          hotScore: baseData.hotScore as number,
          scoreMetadata: baseData.scoreMetadata as number,
          scoreServices: baseData.scoreServices as number,
          scoreFreshness: baseData.scoreFreshness as number,
          protocolTrustScore: baseData.protocolTrustScore as number,
          lastActiveAt: baseData.lastActiveAt as Date,
          listedAt: baseData.listedAt as Date,
          agentId: numericAgentId,
          chainId: HATCHER_CHAIN_ID,
        },
        select: { id: true },
      });
      agentDbId = created.id;
    }
    await replaceHatcherMetadata(tx, agentDbId, hatcherId, hatcherJson, projectionDigest);
    await persistAgentScoresById(tx, agentDbId);
  }, HATCHER_INDEXER_TX);
}
async function recordSyncRun(summary: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify({ ...summary, at: new Date().toISOString() });
  const anyHatcher = await prisma.agent.findFirst({
    where: { chainId: HATCHER_CHAIN_ID },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!anyHatcher) return;
  await prisma.agentMetadata.deleteMany({
    where: { agentId: anyHatcher.id, key: HATCHER_SYNC_RUN_KEY },
  });
  await prisma.agentMetadata.create({
    data: { agentId: anyHatcher.id, key: HATCHER_SYNC_RUN_KEY, value: json.slice(0, 4000) },
  });
}
export async function runHatcherIndexer(options?: {
  respectBackgroundPause?: boolean;
}): Promise<HatcherIndexerResult> {
  const started = Date.now();
  const errors: Array<{ hatcherId?: string; message: string }> = [];
  if (options?.respectBackgroundPause) {
    const { isBackgroundJobsPaused } = await import("@/lib/pause-background-jobs");
    if (isBackgroundJobsPaused()) {
      return {
        ok: false,
        agentsFound: 0,
        agentsUpserted: 0,
        agentsFailed: 0,
        agentsSkipped: 0,
        detailsFetched: 0,
        detailsFailed: 0,
        badgeIndexed: 0,
        durationMs: Date.now() - started,
        message: "background jobs paused",
        errors: [],
      };
    }
  }
  let agents: HatcherExploreAgent[];
  let agentsSkipped = 0;
  try {
    const raw = await fetchAllHatcherExploreAgents({ maxAgents: resolveHatcherSyncLimit() });
    const unique = new Map<string, HatcherExploreAgent>();
    for (const agent of raw) {
      if (shouldIndexExploreAgent(agent)) unique.set(agent.id!.trim(), agent);
    }
    agents = [...unique.values()];
    agentsSkipped = raw.length - agents.length;
    if (agentsSkipped > 0) {
      console.info(`[hatcher-indexer] skipped ${agentsSkipped} non-public/killed/invalid/duplicate explore rows`);
    }
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return {
      ok: false,
      agentsFound: 0,
      agentsUpserted: 0,
      agentsFailed: 0,
      agentsSkipped: 0,
      detailsFetched: 0,
      detailsFailed: 0,
      badgeIndexed: 0,
      durationMs: Date.now() - started,
      message: `explore feed failed: ${msg}`,
      errors: [{ message: msg }],
    };
  }
  if (agents.length === 0) {
    return {
      ok: true,
      agentsFound: 0,
      agentsUpserted: 0,
      agentsFailed: 0,
      agentsSkipped: 0,
      detailsFetched: 0,
      detailsFailed: 0,
      badgeIndexed: 0,
      durationMs: Date.now() - started,
      message: "explore feed returned no agents (cached DB rows unchanged)",
      errors: [],
    };
  }
  const hatcherIds = agents.map((agent) => agent.id.trim());
  const agentsFound = agents.length;
  const [priorMetadata] = await Promise.all([
    loadPriorHatcherMetadata(hatcherIds),
    prisma.$transaction((tx) => ensureHatcherChain(tx), HATCHER_INDEXER_TX),
  ]);
  hatcherIds.length = 0;
  const concurrency = resolveHatcherSyncConcurrency();
  let upserted = 0;
  let agentsFailed = 0;
  let detailsFetched = 0;
  let detailsFailed = 0;
  await forEachWithConcurrency(
    agents,
    concurrency,
    async (agent, index) => {
      try {
        await upsertOneHatcherAgent(agent, priorMetadata.get(agent.id.trim()) ?? null, {
          detailsFetched: () => {
            detailsFetched += 1;
          },
          detailsFailed: () => {
            detailsFailed += 1;
          },
        });
        upserted += 1;
      } catch (e) {
        const msg = Error.isError(e) ? e.message : String(e);
        agentsFailed += 1;
        if (errors.length < HATCHER_ERROR_DETAIL_LIMIT) {
          errors.push({ hatcherId: agent.id, message: msg });
        }
      } finally {
        agents[index] = undefined as never;
      }
    },
  );
  agents.length = 0;
  const result: HatcherIndexerResult = {
    ok: agentsFailed === 0,
    agentsFound,
    agentsUpserted: upserted,
    agentsFailed,
    agentsSkipped,
    detailsFetched,
    detailsFailed,
    badgeIndexed: upserted,
    durationMs: Date.now() - started,
    errors,
  };
  console.info(
    `[hatcher-indexer] found=${result.agentsFound} upserted=${result.agentsUpserted} failed=${result.agentsFailed} detailsOk=${detailsFetched} detailsFail=${detailsFailed} badge=indexed:${result.badgeIndexed}`,
  );
  try {
    await recordSyncRun({
      agentsFound: result.agentsFound,
      agentsUpserted: result.agentsUpserted,
      agentsFailed: result.agentsFailed,
      detailsFetched,
      detailsFailed,
      badgeIndexed: result.badgeIndexed,
    });
  } catch {
    // non-fatal
  }
  return result;
}
