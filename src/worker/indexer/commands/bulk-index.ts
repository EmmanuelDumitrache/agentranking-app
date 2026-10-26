/**
 * Resumable bulk EVM bootstrap/repair.
 *
 * Unlike the normal scheduled scanner, this operator command processes finalized
 * mint history directly and materializes agents immediately. It uses the same
 * provider health, weighted RPC budgets, cancellation, exact decoding, and
 * retry classifications as the live worker. Each completed block range is
 * checkpointed independently, so a later failure never forces already-covered
 * history to be fetched again.
 *
 * Stop the worker while this runs to avoid unnecessary duplicate pressure.
 *
 * Env:
 *   BULK_CHAINS=1,8453
 *   BULK_SKIP_EXISTING=true
 *   BULK_CONCURRENCY=12
 *   BULK_CHUNK_SIZE=2800
 *   BULK_MAX_NEW_AGENTS=2500
 *   BULK_PROCESS_ORDER=asc|desc
 *   BULK_RESET_CURSOR=true
 *   BULK_SKIP_SOLANA=true
 *   BULK_SKIP_REFRESH_COUNTS=true
 */
import { setTimeout as delay } from "node:timers/promises";
import { parseAbiItem, type Hex, type Log } from "viem";
import "../config.js";
import { prisma } from "../db.js";
import { getChainByChainId, isErc8004IndexingEnabled, registryDeploymentSearchHint } from "../chains.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import {
  classifyRpcError,
  getRpcFinalitySnapshot,
  getRpcUrls,
  getSyncableChainIds,
  withRpcFallback,
} from "../sync/rpc.js";
import { loadActiveBlocklistRules, upsertAgentFromChain } from "../sync/agents.js";
import { runDirectSolana8004Snapshot } from "../sync/solana-8004/snapshot.js";
import { refreshChainCounts } from "./refresh-chain-counts.js";
import { logger } from "../logger.js";
import {
  compatibleAgentInt,
  parseData32,
} from "../lib/exact-protocol.js";
import {
  compareCanonicalUnsignedDecimal,
  parseErc721MintTokenId,
} from "../lib/evm-mint-log.js";
import {
  parseOptionalStrictUnsignedInteger,
  parseStrictUnsignedInteger,
} from "../lib/strict-integer.js";
import {
  classifyDatabaseError,
  isSafePreExecutionDatabaseRetry,
} from "../lib/database-errors.js";
import { AgentBlocklistError } from "../lib/agent-blocklist-logic.js";
import { mapSideEffectsDrainOnError } from "../lib/concurrency.js";
import { registrySourceKey } from "../lib/source-cursor.js";
import { resolveRegistryDeploymentBoundary } from "../lib/registry-deployment-boundary.js";
import { redactSensitiveText } from "../lib/secret-redaction.js";
import {
  RetryBudget,
  currentRetryBudget,
  runWithJobRuntime,
} from "../queue/retry-budget.js";
import { INDEXER_QUEUES } from "../queue/queues.js";
import { WORKER_SEMANTIC_GENERATION } from "../queue/semantic-generation.js";
const BULK_FAST = process.env.BULK_FAST === "1" || process.env.BULK_FAST === "true";
const CHUNK_SIZE = Math.max(
  100,
  parseOptionalStrictUnsignedInteger(
    process.env.BULK_CHUNK_SIZE,
    "BULK_CHUNK_SIZE",
    BULK_FAST ? 4_500 : 2_800,
    { maximum: 1_000_000 },
  ),
);
const CONCURRENCY = Math.max(
  1,
  parseOptionalStrictUnsignedInteger(
    process.env.BULK_CONCURRENCY,
    "BULK_CONCURRENCY",
    BULK_FAST ? 16 : 12,
    { maximum: 1_024 },
  ),
);
const BULK_RETRY_BASE_MS = Math.max(
  50,
  parseOptionalStrictUnsignedInteger(
    process.env.BULK_RETRY_BASE_MS,
    "BULK_RETRY_BASE_MS",
    BULK_FAST ? 200 : 350,
    { maximum: 3_600_000 },
  ),
);
const BULK_AGENT_ATTEMPTS = Math.max(
  1,
  parseOptionalStrictUnsignedInteger(
    process.env.BULK_AGENT_ATTEMPTS,
    "BULK_AGENT_ATTEMPTS",
    3,
    { maximum: 20 },
  ),
);
const EXISTING_LOOKUP_CHUNK = BULK_FAST ? 18_000 : 12_000;
const SKIP_EXISTING = (process.env.BULK_SKIP_EXISTING ?? "true") !== "false";
const RESET_CURSOR = process.env.BULK_RESET_CURSOR === "true" || process.env.BULK_RESET_CURSOR === "1";
const MAX_NEW_AGENTS_PER_CHAIN = Math.max(
  0,
  parseOptionalStrictUnsignedInteger(
    process.env.BULK_MAX_NEW_AGENTS,
    "BULK_MAX_NEW_AGENTS",
    0,
    { allowZero: true, maximum: 2_147_483_647 },
  ),
);
const PROCESS_ORDER = (process.env.BULK_PROCESS_ORDER ?? "asc").toLowerCase() === "desc" ? "desc" : "asc";
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)");
type RawMintLog = Log<bigint, number, false, undefined, true>;
type MintObservation = {
  agentId: string;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};
type AgentProcessResult =
  | { status: "ok"; observation: MintObservation }
  | { status: "quarantined"; observation: MintObservation; classification: string; error: unknown };
function compareMintObservations(left: MintObservation, right: MintObservation): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex - right.transactionIndex;
  return left.logIndex - right.logIndex;
}
function decodeMintObservation(raw: RawMintLog, registry: Hex): MintObservation {
  if (
    raw.blockNumber == null || raw.blockHash == null || raw.transactionHash == null ||
    raw.transactionIndex == null || raw.logIndex == null
  ) {
    throw new Error("finalized mint log is missing canonical source coordinates");
  }
  return {
    agentId: parseErc721MintTokenId(raw, registry),
    blockNumber: raw.blockNumber,
    blockHash: parseData32(raw.blockHash, "mint block hash"),
    transactionHash: parseData32(raw.transactionHash, "mint transaction hash"),
    transactionIndex: raw.transactionIndex,
    logIndex: raw.logIndex,
  };
}
async function getBlockHash(chainId: number, blockNumber: bigint): Promise<Hex> {
  return withRpcFallback(
    chainId,
    async (client) => {
      const block = await client.getBlock({ blockNumber, includeTransactions: false });
      if (!block.hash) throw new Error(`block ${blockNumber} is missing its hash`);
      return parseData32(block.hash, "bulk-index boundary block hash");
    },
    { blockNumber, requiresArchive: true },
  );
}
async function scanMintLogs(
  chainId: number,
  registry: Hex,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<MintObservation[]> {
  if (toBlock < fromBlock) return [];
  return withRpcFallback(
    chainId,
    async (client, endpoint) => {
      const observations: MintObservation[] = [];
      const rangeDomain = `operator-bulk-mint:${registry.toLowerCase()}`;
      let next = fromBlock;
      let range = Math.max(1, Math.min(CHUNK_SIZE, endpoint.learnedLogRange(rangeDomain, CHUNK_SIZE)));
      while (next <= toBlock) {
        const endCandidate = next + BigInt(range) - 1n;
        const end = endCandidate > toBlock ? toBlock : endCandidate;
        let logs: RawMintLog[];
        try {
          logs = await client.getLogs({
            address: registry,
            event: TRANSFER_EVENT,
            args: { from: "0x0000000000000000000000000000000000000000" },
            fromBlock: next,
            toBlock: end,
            strict: true,
          }) as RawMintLog[];
        } catch (error) {
          const classification = classifyRpcError(error);
          if ((classification === "range_limit" || classification === "response_size_limit") && range > 1) {
            range = Math.max(1, Math.floor(range / 2));
            await endpoint.recordLearnedLogRange(rangeDomain, range);
            continue;
          }
          throw error;
        }
        for (const log of logs) observations.push(decodeMintObservation(log, registry));
        next = end + 1n;
        if (range < CHUNK_SIZE) {
          range = Math.min(CHUNK_SIZE, range * 2);
          await endpoint.recordLearnedLogRange(rangeDomain, range);
        }
      }
      observations.sort(compareMintObservations);
      return observations;
    },
    { blockNumber: toBlock, requiresArchive: true, requiresLogs: true },
  );
}
function databaseRetryable(error: unknown): boolean {
  const classification = classifyDatabaseError(error);
  return classification === "serialization_failure" || classification === "deadlock" ||
    isSafePreExecutionDatabaseRetry(error);
}
function rpcRetryable(error: unknown): boolean {
  return [
    "rate_limit",
    "transport_failure",
    "provider_lag",
    "unknown_block",
    "pruned_history",
    "response_size_limit",
    "range_limit",
  ].includes(classifyRpcError(error));
}
function deterministicAgentFailure(error: unknown): string | null {
  if (error instanceof AgentBlocklistError) return "blocklisted";
  const database = classifyDatabaseError(error);
  if (database === "invalid_input" || database === "unique_conflict" || database === "foreign_key_conflict") {
    return `database_${database}`;
  }
  const rpc = classifyRpcError(error);
  if (rpc === "contract_revert" || rpc === "contract_decode" || rpc === "invalid_parameter") return rpc;
  return null;
}
async function recordDeterministicFailure(input: {
  chainId: number;
  registry: Hex;
  observation: MintObservation;
  observationBlock: bigint;
  observationBlockHash: Hex;
  classification: string;
  error: unknown;
}): Promise<void> {
  const message = redactSensitiveText(input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 2_000);
  const deadLetterJobId = [
    "operator-bulk",
    input.chainId,
    input.registry.toLowerCase(),
    input.observation.transactionHash.toLowerCase(),
    input.observation.logIndex,
  ].join(":");
  const payload = {
    v: 2,
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    chainId: input.chainId,
    agentId: input.observation.agentId,
    source: "operator-bulk-index",
    sourceSnapshot: {
      finality: "finalized",
      blockNumber: input.observationBlock.toString(10),
      blockHash: input.observationBlockHash,
    },
  };
  await prisma.indexerDeadLetterRecord.upsert({
    where: { deadLetterJobId },
    create: {
      deadLetterJobId,
      originalQueue: INDEXER_QUEUES.AGENT_SYNC,
      originalPayload: payload,
      payloadGeneration: 2,
      firstAttemptAt: new Date(),
      lastAttemptAt: new Date(),
      retryCount: 1,
      errorHistory: [{ at: new Date().toISOString(), classification: input.classification, message }],
      sourceNetwork: `eip155:${input.chainId}`,
      sourceCoordinates: {
        registry: input.registry,
        mintBlock: input.observation.blockNumber.toString(10),
        mintBlockHash: input.observation.blockHash,
        transactionHash: input.observation.transactionHash,
        transactionIndex: input.observation.transactionIndex,
        logIndex: input.observation.logIndex,
        observationBlock: input.observationBlock.toString(10),
        observationBlockHash: input.observationBlockHash,
      },
      decoderGeneration: "erc721-transfer/1",
      configurationGeneration: process.env.INDEXER_CONFIGURATION_GENERATION?.trim() || "runtime-config-v3",
      status: "quarantined",
    },
    update: {
      originalPayload: payload,
      lastAttemptAt: new Date(),
      retryCount: { increment: 1 },
      errorHistory: [{ at: new Date().toISOString(), classification: input.classification, message }],
      status: "quarantined",
    },
  });
}
async function upsertWithRetry(input: {
  chainId: number;
  observation: MintObservation;
  observationBlock: bigint;
  observationBlockHash: Hex;
  blocklistRules: Awaited<ReturnType<typeof loadActiveBlocklistRules>>;
}): Promise<AgentProcessResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= BULK_AGENT_ATTEMPTS; attempt += 1) {
    try {
      await upsertAgentFromChain(input.chainId, input.observation.agentId, {
        sourceSnapshot: {
          finality: "finalized",
          blockNumber: input.observationBlock.toString(10),
          blockHash: input.observationBlockHash,
        },
        stageBusinessKey: `operator-bulk:${input.chainId}:${input.observationBlockHash}:${input.observation.agentId}`,
        blocklistRules: input.blocklistRules,
      });
      return { status: "ok", observation: input.observation };
    } catch (error) {
      lastError = error;
      const deterministic = deterministicAgentFailure(error);
      if (deterministic) {
        await recordDeterministicFailure({
          ...input,
          registry: getChainByChainId(input.chainId)!.identityRegistry as Hex,
          classification: deterministic,
          error,
        });
        return { status: "quarantined", observation: input.observation, classification: deterministic, error };
      }
      const retryable = databaseRetryable(error) || rpcRetryable(error);
      if (!retryable || attempt >= BULK_AGENT_ATTEMPTS) throw error;
      const waitMs = BULK_RETRY_BASE_MS * attempt * attempt;
      currentRetryBudget()?.consumeDelay(waitMs);
      await delay(waitMs);
    }
  }
  throw lastError;
}
async function existingAgentIds(chainId: number, observations: readonly MintObservation[]): Promise<Set<number>> {
  const compatibleIds = observations
    .map((observation) => compatibleAgentInt(observation.agentId))
    .filter((value): value is number => value != null);
  const have = new Set<number>();
  for (let index = 0; index < compatibleIds.length; index += EXISTING_LOOKUP_CHUNK) {
    const slice = compatibleIds.slice(index, index + EXISTING_LOOKUP_CHUNK);
    const existing = await prisma.agent.findMany({
      where: { chainId, agentId: { in: slice } },
      select: { agentId: true },
    });
    for (const row of existing) have.add(row.agentId);
  }
  return have;
}
async function commitOperatorCursor(input: {
  sourceKey: string;
  chainId: number;
  registry: Hex;
  registryGeneration: string;
  boundaryBlock: bigint;
  boundaryHash: Hex;
  finalizedHead: bigint;
  latestHead: bigint;
  processed: number;
  quarantined: number;
}): Promise<void> {
  await prisma.indexerSourceCursor.upsert({
    where: { sourceKey: input.sourceKey },
    create: {
      sourceKey: input.sourceKey,
      chainId: input.chainId,
      domain: `operator-bulk-mint-${PROCESS_ORDER}`,
      registryAddress: input.registry,
      registryGeneration: input.registryGeneration,
      blockNumber: input.boundaryBlock,
      blockHash: input.boundaryHash,
      finalityPolicy: "finalized",
      sourceHead: input.latestHead,
      canonicalHead: input.finalizedHead,
      opaqueCursor: JSON.stringify({ v: 1, order: PROCESS_ORDER, processed: input.processed, quarantined: input.quarantined }),
      lastAdvancedAt: new Date(),
    },
    update: {
      registryAddress: input.registry,
      registryGeneration: input.registryGeneration,
      blockNumber: input.boundaryBlock,
      blockHash: input.boundaryHash,
      sourceHead: input.latestHead,
      canonicalHead: input.finalizedHead,
      opaqueCursor: JSON.stringify({ v: 1, order: PROCESS_ORDER, processed: input.processed, quarantined: input.quarantined }),
      lastAdvancedAt: new Date(),
    },
  });
}
async function runBulkIndexForChainInternal(chainId: number, chainBudget: RetryBudget): Promise<void> {
  const chain = getChainByChainId(chainId);
  if (!chain || getRpcUrls(chainId).length === 0) throw new Error(`bulk-index chain ${chainId} has no canonical descriptor or RPC`);
  if (!isErc8004IndexingEnabled(chain)) throw new Error(`ERC-8004 indexing is disabled for chain ${chainId}`);
  const registry = chain.identityRegistry as Hex;
  const deploymentSearchHint = registryDeploymentSearchHint(chain, "identity");
  const finality = await getRpcFinalitySnapshot(chainId);
  const discoveryIdentity = registrySourceKey({
    chainId,
    domain: "identity",
    registryAddress: registry,
    eventSignature: "erc8004.identity.events.v2",
    deploymentBlock: deploymentSearchHint,
  });
  const deploymentBlock = await resolveRegistryDeploymentBoundary({
    chain,
    domain: "identity",
    sourceKey: discoveryIdentity.sourceKey,
    registryGeneration: discoveryIdentity.registryGeneration,
    finalizedHead: finality.finalized,
    finalizedHash: finality.finalizedHash,
  });
  if (deploymentBlock > finality.finalized) {
    logger.info("bulk-index registry is not deployed at the finalized head", {
      chainId,
      registry,
      finalizedHead: finality.finalized.toString(10),
    }, "sync");
    return;
  }
  const cursorIdentity = registrySourceKey({
    chainId,
    domain: `operator-bulk-mint-${PROCESS_ORDER}`,
    registryAddress: registry,
    eventSignature: "erc721.Transfer(address,address,uint256):mint",
    deploymentBlock: deploymentSearchHint,
  });
  if (RESET_CURSOR) await prisma.indexerSourceCursor.deleteMany({ where: { sourceKey: cursorIdentity.sourceKey } });
  let cursor = await prisma.indexerSourceCursor.findUnique({ where: { sourceKey: cursorIdentity.sourceKey } });
  if (cursor?.blockNumber != null && cursor.blockHash) {
    if (cursor.blockNumber > finality.finalized) {
      throw new Error(`bulk-index cursor ${cursor.blockNumber} is ahead of finalized head ${finality.finalized}`);
    }
    const canonical = await getBlockHash(chainId, cursor.blockNumber);
    if (canonical.toLowerCase() !== cursor.blockHash.toLowerCase()) {
      logger.warn("bulk-index cursor boundary became noncanonical; resetting operator cursor", {
        chainId,
        cursorBlock: cursor.blockNumber.toString(10),
      }, "sync");
      await prisma.indexerSourceCursor.delete({ where: { sourceKey: cursorIdentity.sourceKey } });
      cursor = null;
    }
  }
  await prisma.chain.upsert({
    where: { chainId },
    create: {
      chainId,
      name: chain.name,
      shortName: chain.shortName,
      icon: "",
      color: "#888",
      identityRegistry: chain.identityRegistry,
      reputationRegistry: chain.reputationRegistry,
      validationRegistry: chain.validationRegistry,
      indexingEnabled: true,
    },
    update: {
      name: chain.name,
      shortName: chain.shortName,
      identityRegistry: chain.identityRegistry,
      reputationRegistry: chain.reputationRegistry,
      validationRegistry: chain.validationRegistry,
    },
  });
  let nextAsc = cursor?.blockNumber == null ? deploymentBlock : cursor.blockNumber + 1n;
  let nextDesc = cursor?.blockNumber == null ? finality.finalized : cursor.blockNumber - 1n;
  let totalProcessed = 0;
  let totalQuarantined = 0;
  let totalSkippedExisting = 0;
  const startedAt = Date.now();
  await runWithJobRuntime({
    queueName: "operator-bulk-index",
    rpcPriority: 5,
    retryBudget: chainBudget,
  }, async () => {
    for (;;) {
      if (MAX_NEW_AGENTS_PER_CHAIN > 0 && totalProcessed >= MAX_NEW_AGENTS_PER_CHAIN) break;
      let rangeStart: bigint;
      let rangeEnd: bigint;
      if (PROCESS_ORDER === "asc") {
        if (nextAsc > finality.finalized) break;
        rangeStart = nextAsc < deploymentBlock ? deploymentBlock : nextAsc;
        rangeEnd = rangeStart + BigInt(CHUNK_SIZE) - 1n;
        if (rangeEnd > finality.finalized) rangeEnd = finality.finalized;
      } else {
        if (nextDesc < deploymentBlock) break;
        rangeEnd = nextDesc > finality.finalized ? finality.finalized : nextDesc;
        rangeStart = rangeEnd - BigInt(CHUNK_SIZE) + 1n;
        if (rangeStart < deploymentBlock) rangeStart = deploymentBlock;
      }
      const observations = await scanMintLogs(chainId, registry, rangeStart, rangeEnd);
      const uniqueById = new Map<string, MintObservation>();
      for (const observation of observations) {
        if (compatibleAgentInt(observation.agentId) == null) {
          logger.warn("bulk-index protocol id is outside compatibility Int projection", { chainId, agentId: observation.agentId }, "sync");
          continue;
        }
        if (!uniqueById.has(observation.agentId)) uniqueById.set(observation.agentId, observation);
      }
      let work = [...uniqueById.values()];
      work.sort(compareMintObservations);
      if (PROCESS_ORDER === "desc") work.reverse();
      if (SKIP_EXISTING && work.length > 0) {
        const existing = await existingAgentIds(chainId, work);
        const before = work.length;
        work = work.filter((observation) => !existing.has(compatibleAgentInt(observation.agentId)!));
        totalSkippedExisting += before - work.length;
      }
      // Moderation rules are immutable for this scan chunk: one bounded DB read,
      // then shared by every parallel Agent synchronization in the batch.
      const blocklistRules = await loadActiveBlocklistRules();
      const results = await mapSideEffectsDrainOnError(work, CONCURRENCY, (observation) => upsertWithRetry({
        chainId,
        observation,
        observationBlock: finality.finalized,
        observationBlockHash: finality.finalizedHash,
        blocklistRules,
      }));
      for (const result of results) {
        totalProcessed += 1;
        if (result.status === "quarantined") totalQuarantined += 1;
      }
      const boundaryBlock = PROCESS_ORDER === "asc" ? rangeEnd : rangeStart;
      const boundaryHash = await getBlockHash(chainId, boundaryBlock);
      await commitOperatorCursor({
        sourceKey: cursorIdentity.sourceKey,
        chainId,
        registry,
        registryGeneration: cursorIdentity.registryGeneration,
        boundaryBlock,
        boundaryHash,
        finalizedHead: finality.finalized,
        latestHead: finality.latest,
        processed: totalProcessed,
        quarantined: totalQuarantined,
      });
      logger.info("bulk-index range committed", {
        chainId,
        fromBlock: rangeStart.toString(10),
        toBlock: rangeEnd.toString(10),
        discovered: observations.length,
        processed: work.length,
        totalProcessed,
        totalQuarantined,
        totalSkippedExisting,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1_000),
      }, "sync");
      if (PROCESS_ORDER === "asc") nextAsc = rangeEnd + 1n;
      else nextDesc = rangeStart - 1n;
    }
  });
  const agentCount = await prisma.agent.count({ where: { chainId } });
  await prisma.chain.update({ where: { chainId }, data: { agentCount } });
  logger.info("bulk-index chain complete", {
    chainId,
    finalizedHead: finality.finalized.toString(10),
    totalProcessed,
    totalQuarantined,
    totalSkippedExisting,
    agentCount,
    retryBudget: chainBudget.snapshot(),
  }, "sync");
}
function createBulkRetryBudget(): RetryBudget {
  return new RetryBudget({
    maxTotalAttempts: parseOptionalStrictUnsignedInteger(process.env.BULK_RETRY_TOTAL_ATTEMPTS, "BULK_RETRY_TOTAL_ATTEMPTS", 20_000, { maximum: 10_000_000 }),
    maxProviderSwitches: parseOptionalStrictUnsignedInteger(process.env.BULK_RETRY_PROVIDER_SWITCHES, "BULK_RETRY_PROVIDER_SWITCHES", 5_000, { maximum: 1_000_000 }),
    maxElapsedMs: parseOptionalStrictUnsignedInteger(process.env.BULK_RETRY_ELAPSED_MS, "BULK_RETRY_ELAPSED_MS", 24 * 60 * 60_000, { maximum: 7 * 24 * 60 * 60_000 }),
    maxCumulativeDelayMs: parseOptionalStrictUnsignedInteger(process.env.BULK_RETRY_DELAY_MS, "BULK_RETRY_DELAY_MS", 2 * 60 * 60_000, { maximum: 24 * 60 * 60_000 }),
    maxCumulativeRpcWeight: parseOptionalStrictUnsignedInteger(process.env.BULK_RPC_WEIGHT_BUDGET, "BULK_RPC_WEIGHT_BUDGET", 5_000_000, { maximum: 100_000_000 }),
  });
}
async function runBulkIndexForChain(chainId: number): Promise<void> {
  const chainBudget = createBulkRetryBudget();
  await runWithJobRuntime({
    queueName: "operator-bulk-index",
    rpcPriority: 5,
    retryBudget: chainBudget,
  }, () => runBulkIndexForChainInternal(chainId, chainBudget));
}
async function disconnectPrismaSafe(): Promise<void> {
  try { await prisma.$disconnect(); } catch { /* already disconnected */ }
}
async function main(): Promise<void> {
  const filterRaw = process.env.BULK_CHAINS?.split(",")
    .map((token) => parseStrictUnsignedInteger(token.trim(), "BULK_CHAINS entry", { maximum: 2_147_483_647 }));
  const syncable = getSyncableChainIds().filter((id) => id !== SOLANA_CHAIN_ID);
  const chainIds = filterRaw && filterRaw.length > 0
    ? syncable.filter((id) => filterRaw.includes(id))
    : syncable;
  if (chainIds.length === 0) throw new Error("bulk-index: no chains to process (check RPC env / BULK_CHAINS)");
  logger.info("bulk-index start", {
    chains: chainIds,
    skipExisting: SKIP_EXISTING,
    concurrency: CONCURRENCY,
    chunkSize: CHUNK_SIZE,
    maxNewAgentsPerChain: MAX_NEW_AGENTS_PER_CHAIN || null,
    processOrder: PROCESS_ORDER,
    resetCursor: RESET_CURSOR,
  }, "sync");
  await prisma.$connect();
  for (const chainId of chainIds) await runBulkIndexForChain(chainId);
  const skipSolana = process.env.BULK_SKIP_SOLANA === "true" || process.env.BULK_SKIP_SOLANA === "1";
  if (!skipSolana) {
    logger.info("bulk-index running direct Solana 8004 snapshot", {}, "sync");
    const result = await runDirectSolana8004Snapshot();
    logger.info("bulk-index direct Solana 8004 snapshot complete", {
      generation: result.generation,
      sourceSlot: result.sourceSlot,
      inventoryCount: result.inventoryCount,
      indexedCount: result.indexedCount,
      terminalRejectCount: result.terminalRejectCount,
      inventoryDigest: result.inventoryDigest,
    }, "sync");
  }
  const skipRefreshCounts = process.env.BULK_SKIP_REFRESH_COUNTS === "true" || process.env.BULK_SKIP_REFRESH_COUNTS === "1";
  if (!skipRefreshCounts) {
    logger.info("bulk-index refreshing exact chain counts", {}, "sync");
    const result = await refreshChainCounts();
    logger.info("bulk-index chain counts refreshed", result, "sync");
  }
  logger.info("bulk-index complete", {}, "sync");
  await disconnectPrismaSafe();
}
void main().catch(async (error) => {
  logger.error("bulk-index fatal", {
    error: redactSensitiveText(error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 4_000),
  }, "sync");
  await disconnectPrismaSafe();
  process.exit(1);
});
