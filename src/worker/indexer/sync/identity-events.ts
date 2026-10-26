import { randomUUID } from "node:crypto";
import { throwIfAborted } from "../lib/abort.js";
import { reducedRpcLogRange } from "../lib/rpc-error-classification.js";
import type { ProgressCheckpoint } from "../lib/progress.js";
import {
  decodeEventLog,
  hexToBytes,
  parseAbi,
  zeroAddress,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db.js";
import { withSerializableRetry } from "../lib/serializable-retry.js";
import { toPostgresJsonValue } from "../lib/postgres-json.js";
import { logger } from "../logger.js";
import { createCompletionLogLimiter } from "../../job-completion-log.js";
import {
  canonicalEvmAddress,
  canonicalUint256,
  compareEvmEventPosition,
  evmEventKey,
  metadataKeyTopic,
  parseData32,
  parseRpcData,
  type EvmEventPosition,
} from "../lib/exact-protocol.js";
import { decodeOnchainMetadataValue } from "../lib/onchain-value-decoder.js";
import { prismaJson } from "../lib/prisma-json.js";
import { redactSensitiveText } from "../lib/secret-redaction.js";
import { enqueueAgentSyncBatchInTx } from "../queue/producer.js";
import type { SourceSnapshot } from "../queue/contracts.js";
import { INDEXER_QUEUES } from "../queue/queues.js";
import { config } from "../config.js";
import { classifyRpcError, withRpcFallback } from "./rpc.js";
import { resolveContractGeneration } from "./contract-generation.js";
import { hydrateMissingBlockTimes, preloadPersistedBlockTimes } from "./evm-block-time-cache.js";
import { generationStateBlockForTransaction, reduceIdentityTransactionStates, type IdentityState } from "./identity-state-reducer.js";

const scannedRangeLog = createCompletionLogLimiter();
const IDENTITY_STATE_LOOKUP_BATCH = 5_000;
const REORG_STATE_LOOKUP_BATCH = 1_000;
const REORG_OUTBOX_UPSERT_BATCH = 1_000;
export const IDENTITY_EVENT_DECODER_VERSION = "erc8004-identity/3.3.0";
export const IDENTITY_EVENTS_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)",
  "event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)",
  "event MetadataUpdate(uint256 tokenId)",
  "event Upgraded(address indexed implementation)",
  "event BeaconUpgraded(address indexed beacon)",
]);
const IDENTITY_READ_ABI = parseAbi([
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
type RawIdentityLog = Log<bigint, number, false, undefined, true>;
type DecodedIdentityEvent = {
  raw: RawIdentityLog;
  eventKey: string;
  eventName: string;
  args: Record<string, unknown>;
  protocolAgentId: string | null;
  position: EvmEventPosition;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
  blockTime: Date | null;
};
type AgentTxState = IdentityState;
function expectedTopicCount(eventName: string): number {
  switch (eventName) {
    case "Transfer": return 4;
    case "Registered": return 3;
    case "MetadataSet": return 3;
    case "URIUpdated": return 3;
    case "MetadataUpdate": return 1;
    case "Upgraded":
    case "BeaconUpgraded": return 2;
    default: return 0;
  }
}
function cachedBlockTime(cache: Map<string, Date | null>, hash: Hex, number: bigint): Date | null {
  const cacheKey = hash.toLowerCase();
  if (!cache.has(cacheKey)) {
    throw new Error(`identity block time ${hash} at height ${number} was not hydrated before decoding`);
  }
  return cache.get(cacheKey) ?? null;
}
export type IdentityLogRejectionCode =
  | "missing_signature_topic"
  | "strict_abi_decode_failed"
  | "wrong_topic_count"
  | "missing_canonical_coordinates";
type RejectedIdentityLog = {
  rejectionCode: IdentityLogRejectionCode;
  rejectionReason: string;
  cause?: unknown;
};
function decodeIdentityLog(
  chainId: number,
  canonicalContractAddress: string,
  raw: RawIdentityLog,
  timeCache: Map<string, Date | null>,
): DecodedIdentityEvent | RejectedIdentityLog {
  const topics = [...raw.topics] as Hex[];
  if (topics.length === 0) {
    return {
      rejectionCode: "missing_signature_topic",
      rejectionReason: "identity log has no signature topic",
    };
  }
  const data = parseRpcData(raw.data, undefined, "identity log data");
  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({ abi: IDENTITY_EVENTS_ABI, topics: topics as [Hex, ...Hex[]], data, strict: true });
  } catch (error) {
    return {
      rejectionCode: "strict_abi_decode_failed",
      rejectionReason: "strict ABI decode failed",
      cause: error,
    };
  }
  const count = expectedTopicCount(decoded.eventName);
  if (count === 0 || topics.length !== count) {
    return {
      rejectionCode: "wrong_topic_count",
      rejectionReason: `wrong topic count for ${decoded.eventName}: ${topics.length}`,
    };
  }
  if (
    raw.blockNumber == null || raw.blockHash == null || raw.transactionHash == null ||
    raw.transactionIndex == null || raw.logIndex == null
  ) {
    return {
      rejectionCode: "missing_canonical_coordinates",
      rejectionReason: "pending log has no canonical event coordinates",
    };
  }
  const blockHash = parseData32(raw.blockHash, "identity block hash");
  const transactionHash = parseData32(raw.transactionHash, "identity transaction hash");
  const args = decoded.args as Record<string, unknown>;
  const rawAgentId = args.agentId ?? args.tokenId;
  const eventKeyValue = evmEventKey({ chainId, contractAddress: canonicalContractAddress, blockHash, transactionHash, logIndex: raw.logIndex });
  return {
    raw,
    eventKey: eventKeyValue,
    eventName: decoded.eventName,
    args,
    protocolAgentId: typeof rawAgentId === "bigint" ? canonicalUint256(rawAgentId) : null,
    position: { blockNumber: raw.blockNumber, transactionIndex: raw.transactionIndex, logIndex: raw.logIndex },
    blockNumber: raw.blockNumber,
    blockHash,
    transactionHash,
    transactionIndex: raw.transactionIndex,
    logIndex: raw.logIndex,
    blockTime: cachedBlockTime(timeCache, blockHash, raw.blockNumber),
  };
}
async function persistRejectedLog(
  chainId: number,
  contractAddress: string,
  raw: RawIdentityLog,
  reason: string,
  error?: unknown,
): Promise<void> {
  const blockHash = raw.blockHash && /^0x[0-9a-fA-F]{64}$/.test(raw.blockHash) ? raw.blockHash : null;
  const txHash = raw.transactionHash && /^0x[0-9a-fA-F]{64}$/.test(raw.transactionHash) ? raw.transactionHash : null;
  const eventKeyValue = blockHash && txHash && raw.logIndex != null
    ? evmEventKey({ chainId, contractAddress, blockHash, transactionHash: txHash, logIndex: raw.logIndex })
    : `pending:${chainId}:${contractAddress.toLowerCase()}:${raw.transactionHash ?? "none"}:${raw.logIndex ?? "none"}`;
  let rejectedData: Uint8Array<ArrayBuffer>;
  try { rejectedData = Uint8Array.from(hexToBytes(parseRpcData(raw.data))); }
  catch { rejectedData = Uint8Array.from(Buffer.from(String(raw.data))); }
  const rejectionDetail = redactSensitiveText(
    `${reason}${
      error
        ? `: ${error instanceof Error ? error.message : String(error)}`
        : ""
    }`,
  ).slice(0, 2_000);
  await prisma.evmEventObservation.upsert({
    where: { eventKey: eventKeyValue },
    create: {
      eventKey: eventKeyValue,
      businessKey: `identity:rejected:${eventKeyValue}`,
      chainId,
      contractAddress,
      eventName: "Unknown",
      topic0: raw.topics[0] ?? null,
      topics: [...raw.topics],
      data: rejectedData,
      blockNumber: raw.blockNumber,
      blockHash,
      transactionHash: txHash,
      transactionIndex: raw.transactionIndex,
      logIndex: raw.logIndex,
      removed: raw.removed ?? false,
      status: raw.removed ? "removed" : "malformed",
      decoderVersion: IDENTITY_EVENT_DECODER_VERSION,
      rejectionReason: rejectionDetail,
    },
    update: {
      status: raw.removed ? "removed" : "malformed",
      decoderVersion: IDENTITY_EVENT_DECODER_VERSION,
      rejectionReason: rejectionDetail,
    },
  });
}
async function persistRawEvent(
  chainId: number,
  contractAddress: string,
  generationId: string | null,
  event: DecodedIdentityEvent,
  finalityPolicy: string,
): Promise<void> {
  await prisma.evmEventObservation.upsert({
    where: { eventKey: event.eventKey },
    create: {
      eventKey: event.eventKey,
      businessKey: `identity:${chainId}:${contractAddress.toLowerCase()}:${event.transactionHash}:${event.logIndex}`,
      chainId,
      contractAddress,
      contractGenerationId: generationId,
      eventName: event.eventName,
      topic0: event.raw.topics[0] ?? null,
      topics: [...event.raw.topics],
      data: Buffer.from(hexToBytes(event.raw.data)),
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      blockTime: event.blockTime,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      removed: event.raw.removed ?? false,
      status: event.raw.removed ? "removed" : "finalized",
      finalityPolicy,
      decoderVersion: IDENTITY_EVENT_DECODER_VERSION,
      decoded: toPostgresJsonValue(event.args) as never,
    },
    update: {
      // A decoder upgrade can turn an observation previously stored as
      // malformed into a valid event (for example the ERC-4906 indexed-layout
      // correction in decoder 3.3.0). Refresh the full decode-derived record,
      // not only its status, so durable raw-event provenance cannot remain
      // stuck on eventName=Unknown or an older decoder version.
      businessKey: `identity:${chainId}:${contractAddress.toLowerCase()}:${event.transactionHash}:${event.logIndex}`,
      contractGenerationId: generationId,
      eventName: event.eventName,
      topic0: event.raw.topics[0] ?? null,
      topics: [...event.raw.topics],
      data: Buffer.from(hexToBytes(event.raw.data)),
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      blockTime: event.blockTime,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      removed: event.raw.removed ?? false,
      status: event.raw.removed ? "removed" : "finalized",
      finalityPolicy,
      decoderVersion: IDENTITY_EVENT_DECODER_VERSION,
      decoded: toPostgresJsonValue(event.args) as never,
      rejectionReason: null,
    },
  });
}
function stateFromPrior(protocolAgentId: string, prior?: {
  registeredOwner: string | null;
  currentOwner: string | null;
  currentAgentWallet: string | null;
  agentUri: string | null;
}): AgentTxState {
  return {
    protocolAgentId,
    registeredOwner: prior?.registeredOwner ?? null,
    currentOwner: prior?.currentOwner ?? null,
    currentWallet: prior ? prior.currentAgentWallet : undefined,
    agentUri: prior ? prior.agentUri : undefined,
    registeredAt: null,
    ownerAt: null,
    walletAt: null,
    hydrationReasons: new Set(),
    lastLogIndex: -1,
  };
}
async function previousAgentStates(chainId: number, registryAddress: string, protocolAgentIds: string[]): Promise<Map<string, AgentTxState>> {
  const states = new Map<string, AgentTxState>();
  for (let offset = 0; offset < protocolAgentIds.length; offset += IDENTITY_STATE_LOOKUP_BATCH) {
    const batch = protocolAgentIds.slice(offset, offset + IDENTITY_STATE_LOOKUP_BATCH);
    const rows = await prisma.$queryRaw<Array<{
      protocolAgentId: string;
      registeredOwner: string | null;
      currentOwner: string | null;
      currentAgentWallet: string | null;
      agentUri: string | null;
    }>>(Prisma.sql`
      SELECT DISTINCT ON (observation.protocol_agent_id)
        observation.protocol_agent_id AS "protocolAgentId",
        observation.registered_owner AS "registeredOwner",
        observation.current_owner AS "currentOwner",
        observation.current_agent_wallet AS "currentAgentWallet",
        observation.agent_uri AS "agentUri"
      FROM evm_identity_observations AS observation
      WHERE observation.chain_id = ${chainId}
        AND observation.registry_address = ${registryAddress}
        AND observation.protocol_agent_id IN (${Prisma.join(batch)})
        AND observation.status = 'finalized'
      ORDER BY
        observation.protocol_agent_id,
        observation.block_number DESC,
        observation.transaction_index DESC,
        observation.last_log_index DESC
    `);
    for (const row of rows) {
      states.set(row.protocolAgentId, stateFromPrior(row.protocolAgentId, row));
    }
  }
  for (const protocolAgentId of protocolAgentIds) {
    if (!states.has(protocolAgentId)) states.set(protocolAgentId, stateFromPrior(protocolAgentId));
  }
  return states;
}
async function persistMetadata(input: {
  chainId: number;
  registryAddress: string;
  generation: string;
  event: DecodedIdentityEvent;
  agentId: string;
  operationContext: string | null;
}): Promise<string | null | undefined> {
  const metadataKey = input.event.args.metadataKey;
  const indexedHash = input.event.args.indexedMetadataKey;
  const metadataValue = input.event.args.metadataValue;
  if (typeof metadataKey !== "string" || typeof indexedHash !== "string" || typeof metadataValue !== "string") {
    throw new Error("MetadataSet decoded to unexpected argument types");
  }
  const expectedHash = metadataKeyTopic(metadataKey).toLowerCase();
  const topicHash = parseData32(indexedHash, "indexed metadata key hash");
  if (topicHash !== expectedHash) throw new Error("MetadataSet indexed key hash does not match plaintext metadata key");
  const rawBytes = hexToBytes(parseRpcData(metadataValue, undefined, "metadata value"));
  const decoded = decodeOnchainMetadataValue(metadataKey, rawBytes);
  const decodedType = decoded.decodedType;
  const decodedText = decoded.text;
  const decodedAddress = decoded.address;
  const walletState = metadataKey === "agentWallet" ? decoded.address : undefined;
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.evmIdentityMetadataObservation.updateMany({
      where: {
        chainId: input.chainId,
        registryAddress: input.registryAddress,
        protocolAgentId: input.agentId,
        metadataKey,
        isCurrent: true,
        status: "finalized",
      },
      data: { isCurrent: false, supersededByEventKey: input.event.eventKey, status: "superseded" },
    });
    await tx.evmIdentityMetadataObservation.upsert({
      where: { eventKey: input.event.eventKey },
      create: {
        eventKey: input.event.eventKey,
        chainId: input.chainId,
        registryAddress: input.registryAddress,
        registryGeneration: input.generation,
        protocolAgentId: input.agentId,
        metadataKey,
        metadataKeyHash: topicHash,
        rawValue: Buffer.from(rawBytes),
        hexValue: metadataValue.toLowerCase(),
        decodedType,
        decodedText,
        decodedAddress,
        decodedBoolean: decoded.boolean,
        decodedInteger: decoded.integer,
        decodedUri: decoded.uri,
        decodedBytes32: decoded.bytes32,
        decodedJson: prismaJson(decoded.json),
        semanticType: decoded.semanticType,
        normalizationEvidence: prismaJson(decoded.evidence),
        decoderVersion: IDENTITY_EVENT_DECODER_VERSION,
        operationContext: input.operationContext,
        blockNumber: input.event.blockNumber,
        blockHash: input.event.blockHash,
        transactionHash: input.event.transactionHash,
        transactionIndex: input.event.transactionIndex,
        logIndex: input.event.logIndex,
        status: "finalized",
        isCurrent: true,
      },
      update: {
        status: "finalized",
        isCurrent: true,
        supersededByEventKey: null,
        decodedType,
        decodedText,
        decodedAddress,
        decodedBoolean: decoded.boolean,
        decodedInteger: decoded.integer,
        decodedUri: decoded.uri,
        decodedBytes32: decoded.bytes32,
        decodedJson: prismaJson(decoded.json),
        semanticType: decoded.semanticType,
        normalizationEvidence: prismaJson(decoded.evidence),
      },
    });
  }, { isolationLevel: "Serializable" }));
  return walletState;
}
function agentIdFromEvent(event: DecodedIdentityEvent): string | null {
  return event.protocolAgentId;
}
async function reduceTransaction(input: {
  client: PublicClient;
  chainId: number;
  registryAddress: string;
  generation: string;
  generationId: string | null;
  events: DecodedIdentityEvent[];
  eventsAlreadySorted?: boolean;
  finalityPolicy: string;
  signal?: AbortSignal;
}): Promise<Array<{ agentId: string; sourceSnapshot: SourceSnapshot }>> {
  throwIfAborted(input.signal);
  const events = input.eventsAlreadySorted
    ? input.events
    : [...input.events].sort((a, b) => compareEvmEventPosition(a.position, b.position));
  const uniqueAgentIds = new Set<string>();
  for (const event of events) {
    if (event.protocolAgentId != null) uniqueAgentIds.add(event.protocolAgentId);
  }
  const agentIds = [...uniqueAgentIds];
  const initialStates = await previousAgentStates(input.chainId, input.registryAddress, agentIds);
  const laterTransferByEvent = new Array<boolean>(events.length).fill(false);
  const futureTransferAgentIds = new Set<string>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    const agentId = agentIdFromEvent(event);
    laterTransferByEvent[index] = agentId != null && futureTransferAgentIds.has(agentId);
    if (event.eventName === "Transfer" && agentId) futureTransferAgentIds.add(agentId);
  }
  const annotated: DecodedIdentityEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    throwIfAborted(input.signal);
    const event = events[index]!;
    await persistRawEvent(input.chainId, input.registryAddress, input.generationId, event, input.finalityPolicy);
    if (event.eventName !== "MetadataSet") { annotated.push(event); continue; }
    const agentId = agentIdFromEvent(event);
    if (!agentId) { annotated.push(event); continue; }
    const operationContext = event.args.metadataKey === "agentWallet" && laterTransferByEvent[index]
      ? "transfer-wallet-clear"
      : "metadata-write";
    const wallet = await persistMetadata({
      chainId: input.chainId,
      registryAddress: input.registryAddress,
      generation: input.generation,
      event,
      agentId,
      operationContext,
    });
    annotated.push(wallet === undefined ? event : { ...event, args: { ...event.args, decodedAgentWallet: wallet } });
  }
  const states = reduceIdentityTransactionStates(initialStates, annotated, { alreadySorted: true });
  const output = [];
  for (const state of states.values()) {
    throwIfAborted(input.signal);
    if (state.hydrationReasons.has("erc4906-invalidation") && !state.hydrationReasons.has("registered") && !state.hydrationReasons.has("uri-updated")) {
      try {
        state.agentUri = await input.client.readContract({
          address: input.registryAddress as Hex,
          abi: IDENTITY_READ_ABI,
          functionName: "tokenURI",
          args: [BigInt(state.protocolAgentId)],
          blockNumber: events[0]!.blockNumber,
        });
      } catch {
        state.hydrationReasons.add("token-uri-repair-failed");
      }
    }
    const terminal = events.at(-1)!;
    const businessKey = `identity:${input.chainId}:${input.registryAddress.toLowerCase()}:${terminal.transactionHash}:${state.protocolAgentId}`;
    const hydrationReason = [...state.hydrationReasons].sort().join(",");
    const sourceSnapshot = {
      finality: "finalized" as const,
      blockNumber: terminal.blockNumber.toString(10),
      blockHash: terminal.blockHash,
      transactionHash: terminal.transactionHash,
      transactionIndex: terminal.transactionIndex,
      logIndex: state.lastLogIndex,
      registeredOwner: state.registeredOwner,
      registryGeneration: input.generation,
    };
    const observation = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const persisted = await tx.evmIdentityObservation.upsert({
        where: { businessKey },
        create: {
          businessKey,
          chainId: input.chainId,
          registryAddress: input.registryAddress,
          registryGeneration: input.generation,
          protocolAgentId: state.protocolAgentId,
          registeredOwner: state.registeredOwner,
          currentOwner: state.currentOwner,
          currentAgentWallet: state.currentWallet === undefined ? null : state.currentWallet,
          agentUri: state.agentUri === undefined ? null : state.agentUri,
          registeredAtEventPosition: state.registeredAt ? toPostgresJsonValue(state.registeredAt) as never : undefined,
          currentOwnerEventPosition: state.ownerAt ? toPostgresJsonValue(state.ownerAt) as never : undefined,
          currentWalletEventPosition: state.walletAt ? toPostgresJsonValue(state.walletAt) as never : undefined,
          hydrationReason,
          blockNumber: terminal.blockNumber,
          blockHash: terminal.blockHash,
          transactionHash: terminal.transactionHash,
          transactionIndex: terminal.transactionIndex,
          lastLogIndex: state.lastLogIndex,
          blockTime: terminal.blockTime,
          status: "finalized",
          decoderVersion: IDENTITY_EVENT_DECODER_VERSION,
        },
        update: {
          registeredOwner: state.registeredOwner,
          currentOwner: state.currentOwner,
          currentAgentWallet: state.currentWallet === undefined ? null : state.currentWallet,
          agentUri: state.agentUri === undefined ? null : state.agentUri,
          hydrationReason,
          status: "finalized",
        },
        select: { lastLogIndex: true },
      });
      const finalSnapshot = { ...sourceSnapshot, logIndex: persisted.lastLogIndex };
      const outboxKey = `agent-sync:${input.chainId}:${state.protocolAgentId}:${terminal.blockHash}:${terminal.transactionHash}:${persisted.lastLogIndex}`;
      await tx.indexerOutbox.upsert({
        where: { businessKey: outboxKey },
        create: {
          businessKey: outboxKey,
          queueName: INDEXER_QUEUES.AGENT_SYNC,
          sourceKey: `evm:${input.chainId}:identity`,
          sourcePosition: toPostgresJsonValue(terminal.position) as never,
          payload: {
            v: 2,
            chainId: input.chainId,
            agentId: state.protocolAgentId,
            source: "identity-event",
            sourceSnapshot: finalSnapshot,
          },
        },
        update: {
          payload: {
            v: 2,
            chainId: input.chainId,
            agentId: state.protocolAgentId,
            source: "identity-event",
            sourceSnapshot: finalSnapshot,
          },
          lastError: null,
        },
      });
      return { persisted, finalSnapshot };
    }, { isolationLevel: "Serializable" }));
    output.push({ agentId: state.protocolAgentId, sourceSnapshot: observation.finalSnapshot });
  }
  return output;
}
export async function orphanIdentityBranch(input: {
  chainId: number;
  registryAddress: string;
  displacedBlockHash: string;
  displacedFromBlock?: bigint;
}): Promise<void> {
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const branchWhere = input.displacedFromBlock == null
      ? { blockHash: input.displacedBlockHash }
      : { OR: [{ blockHash: input.displacedBlockHash }, { blockNumber: { gte: input.displacedFromBlock } }] };
    const affectedIdentity = await tx.evmIdentityObservation.findMany({
      where: { chainId: input.chainId, registryAddress: input.registryAddress, ...branchWhere },
      select: { protocolAgentId: true },
    });
    await tx.evmEventObservation.updateMany({
      where: { chainId: input.chainId, contractAddress: input.registryAddress, ...branchWhere },
      data: { status: "orphaned", removed: true },
    });
    await tx.evmIdentityObservation.updateMany({
      where: { chainId: input.chainId, registryAddress: input.registryAddress, ...branchWhere },
      data: { status: "orphaned" },
    });
    const metadata = await tx.evmIdentityMetadataObservation.findMany({
      where: { chainId: input.chainId, registryAddress: input.registryAddress, ...branchWhere },
      select: { eventKey: true, protocolAgentId: true, metadataKey: true },
    });
    await tx.evmIdentityMetadataObservation.updateMany({
      where: { chainId: input.chainId, registryAddress: input.registryAddress, ...branchWhere },
      data: { status: "orphaned", isCurrent: false },
    });
    const metadataStates = new Map<string, { protocolAgentId: string; metadataKey: string }>();
    for (const row of metadata) {
      metadataStates.set(`${row.protocolAgentId}\u0000${row.metadataKey}`, {
        protocolAgentId: row.protocolAgentId,
        metadataKey: row.metadataKey,
      });
    }
    const metadataStateList = [...metadataStates.values()];
    for (let offset = 0; offset < metadataStateList.length; offset += REORG_STATE_LOOKUP_BATCH) {
      const batch = metadataStateList.slice(offset, offset + REORG_STATE_LOOKUP_BATCH);
      const prior = await tx.$queryRaw<Array<{ eventKey: string }>>(Prisma.sql`
        SELECT DISTINCT ON (m."protocol_agent_id", m."metadata_key")
          m."event_key" AS "eventKey"
        FROM "evm_identity_metadata_observations" m
        JOIN (VALUES ${Prisma.join(batch.map((row) => Prisma.sql`(${row.protocolAgentId}, ${row.metadataKey})`))})
          AS wanted("protocol_agent_id", "metadata_key")
          ON wanted."protocol_agent_id" = m."protocol_agent_id"
         AND wanted."metadata_key" = m."metadata_key"
        WHERE m."chain_id" = ${input.chainId}
          AND m."registry_address" = ${input.registryAddress}
          AND m."status" IN ('finalized', 'superseded')
        ORDER BY
          m."protocol_agent_id",
          m."metadata_key",
          m."block_number" DESC,
          m."transaction_index" DESC,
          m."log_index" DESC
      `);
      if (prior.length > 0) {
        await tx.evmIdentityMetadataObservation.updateMany({
          where: { eventKey: { in: prior.map((row) => row.eventKey) } },
          data: { status: "finalized", isCurrent: true, supersededByEventKey: null },
        });
      }
    }
    type PriorIdentity = {
      protocolAgentId: string;
      registeredOwner: string | null;
      registryGeneration: string;
      blockNumber: bigint;
      blockHash: string;
      transactionHash: string;
      transactionIndex: number;
      lastLogIndex: number;
    };
    const affectedAgentIdSet = new Set<string>();
    for (const row of affectedIdentity) affectedAgentIdSet.add(row.protocolAgentId);
    const affectedAgentIds = [...affectedAgentIdSet];
    const priorByAgentId = new Map<string, PriorIdentity>();
    for (let offset = 0; offset < affectedAgentIds.length; offset += REORG_STATE_LOOKUP_BATCH) {
      const batch = affectedAgentIds.slice(offset, offset + REORG_STATE_LOOKUP_BATCH);
      const rows = await tx.$queryRaw<PriorIdentity[]>(Prisma.sql`
        SELECT DISTINCT ON (o."protocol_agent_id")
          o."protocol_agent_id" AS "protocolAgentId",
          o."registered_owner" AS "registeredOwner",
          o."registry_generation" AS "registryGeneration",
          o."block_number" AS "blockNumber",
          o."block_hash" AS "blockHash",
          o."transaction_hash" AS "transactionHash",
          o."transaction_index" AS "transactionIndex",
          o."last_log_index" AS "lastLogIndex"
        FROM "evm_identity_observations" o
        JOIN (VALUES ${Prisma.join(batch.map((protocolAgentId) => Prisma.sql`(${protocolAgentId})`))})
          AS wanted("protocol_agent_id")
          ON wanted."protocol_agent_id" = o."protocol_agent_id"
        WHERE o."chain_id" = ${input.chainId}
          AND o."registry_address" = ${input.registryAddress}
          AND o."status" = 'finalized'
        ORDER BY
          o."protocol_agent_id",
          o."block_number" DESC,
          o."transaction_index" DESC,
          o."last_log_index" DESC
      `);
      for (const row of rows) priorByAgentId.set(row.protocolAgentId, row);
    }
    const missingPrior = affectedAgentIds.filter((protocolAgentId) => !priorByAgentId.has(protocolAgentId));
    for (let offset = 0; offset < missingPrior.length; offset += REORG_STATE_LOOKUP_BATCH) {
      await tx.agent.updateMany({
        where: {
          chainId: input.chainId,
          protocolAgentId: { in: missingPrior.slice(offset, offset + REORG_STATE_LOOKUP_BATCH) },
          OR: [{ isActive: { not: false } }, { sourceFinality: { not: "orphaned" } }, { sourceFinality: null }],
        },
        data: { isActive: false, sourceFinality: "orphaned" },
      });
    }
    type RestoreOutboxRow = {
      id: string;
      businessKey: string;
      sourcePosition: { blockNumber: string; transactionIndex: number; logIndex: number };
      payload: Record<string, unknown>;
    };
    let restoreOutboxRows: RestoreOutboxRow[] = [];
    const restoreSourceKey = `evm:${input.chainId}:identity`;
    const flushRestoreOutbox = async (): Promise<void> => {
      if (restoreOutboxRows.length === 0) return;
      const serialized = JSON.stringify(restoreOutboxRows);
      restoreOutboxRows = [];
      await tx.$executeRaw`
        INSERT INTO indexer_outbox (
          id,
          business_key,
          queue_name,
          payload,
          source_key,
          source_position
        )
        SELECT
          input.id,
          input."businessKey",
          ${INDEXER_QUEUES.AGENT_SYNC},
          input.payload,
          ${restoreSourceKey},
          input."sourcePosition"
        FROM jsonb_to_recordset(${serialized}::jsonb) AS input(
          id text,
          "businessKey" text,
          payload jsonb,
          "sourcePosition" jsonb
        )
        ON CONFLICT (business_key) DO UPDATE SET
          payload = EXCLUDED.payload,
          dispatched_at = NULL,
          available_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      `;
    };
    for (const [protocolAgentId, prior] of priorByAgentId) {
      const sourceSnapshot = {
        finality: "finalized",
        blockNumber: prior.blockNumber.toString(10),
        blockHash: prior.blockHash,
        transactionHash: prior.transactionHash,
        transactionIndex: prior.transactionIndex,
        logIndex: prior.lastLogIndex,
        registeredOwner: prior.registeredOwner,
        registryGeneration: prior.registryGeneration,
      };
      const businessKey = `agent-sync:restore:${input.chainId}:${protocolAgentId}:${prior.transactionHash}:${prior.lastLogIndex}`;
      restoreOutboxRows.push({
        id: randomUUID(),
        businessKey,
        sourcePosition: {
          blockNumber: prior.blockNumber.toString(10),
          transactionIndex: prior.transactionIndex,
          logIndex: prior.lastLogIndex,
        },
        payload: {
          v: 2,
          chainId: input.chainId,
          agentId: protocolAgentId,
          source: "identity-reorg-restore",
          sourceSnapshot,
        },
      });
      if (restoreOutboxRows.length >= REORG_OUTBOX_UPSERT_BATCH) {
        await flushRestoreOutbox();
      }
    }
    await flushRestoreOutbox();
  }, { isolationLevel: "Serializable" }));
}
type IdentityOutboxPayload = {
  chainId: number;
  agentId: string;
  source?: string;
  sourceSnapshot?: SourceSnapshot;
};

// Occupancy is monotone within the producer because successful inserts update
// the cached count. Worker completions can only make this conservative, so a
// deep queue does not need another O(target) count every few seconds.
const AGENT_SYNC_BACKLOG_OPEN_CACHE_MS = 5_000;
const AGENT_SYNC_BACKLOG_FULL_CACHE_MS = 60_000;
const AGENT_SYNC_SINGLETON_RETRY_MS = 30_000;
type CachedOccupancy = { count: number; expiresAt: number };
let agentSyncQueueOccupancy: CachedOccupancy | null = null;
const agentSyncChainOccupancy = new Map<number, CachedOccupancy>();
const identityOutboxDispatchTails = new Map<number, Promise<void>>();

async function readAgentSyncOccupancy(chainId: number): Promise<{ occupied: number; chainOccupied: number }> {
  const now = Date.now();
  const cachedChain = agentSyncChainOccupancy.get(chainId);
  if (
    agentSyncQueueOccupancy && agentSyncQueueOccupancy.expiresAt > now &&
    cachedChain && cachedChain.expiresAt > now
  ) {
    return { occupied: agentSyncQueueOccupancy.count, chainOccupied: cachedChain.count };
  }
  // Once the global target is reached, the exact (possibly 100k+) count cannot
  // change the admission decision. Bound the scan at that target and only pay
  // for an exact per-chain count while the total queue is still below capacity.
  const occupancyScanLimit = Math.max(1, config.agentSyncBacklogTarget);
  const [queueRow] = await prisma.$queryRaw<Array<{ occupied: bigint; chainOccupied: bigint }>>`
    SELECT
      COUNT(*) AS "occupied",
      COUNT(*) FILTER (WHERE chain_id = ${String(chainId)}) AS "chainOccupied"
    FROM (
      SELECT data->>'chainId' AS chain_id
      FROM pgboss.job
      WHERE name = ${INDEXER_QUEUES.AGENT_SYNC}
        AND state <= 'active'
      LIMIT ${occupancyScanLimit}
    ) AS bounded_jobs
  `;
  const occupiedBigint = queueRow?.occupied ?? 0n;
  const chainOccupiedBigint = queueRow?.chainOccupied ?? 0n;
  if (
    occupiedBigint > BigInt(Number.MAX_SAFE_INTEGER) ||
    chainOccupiedBigint > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(`agent-sync backlog for chain ${chainId} exceeds the exact integer domain`);
  }
  const occupied = Number(occupiedBigint);
  const chainOccupied = Number(chainOccupiedBigint);
  const atCapacity = occupied >= config.agentSyncBacklogTarget ||
    chainOccupied >= config.agentSyncChainBacklogTarget;
  const expiresAt = Date.now() + (
    atCapacity ? AGENT_SYNC_BACKLOG_FULL_CACHE_MS : AGENT_SYNC_BACKLOG_OPEN_CACHE_MS
  );
  agentSyncQueueOccupancy = { count: occupied, expiresAt };
  agentSyncChainOccupancy.set(chainId, { count: chainOccupied, expiresAt });
  return { occupied, chainOccupied };
}

function consumeAgentSyncCapacity(chainId: number, count: number): void {
  if (count === 0) return;
  if (agentSyncQueueOccupancy) agentSyncQueueOccupancy.count += count;
  const chain = agentSyncChainOccupancy.get(chainId);
  if (chain) chain.count += count;
}

async function dispatchIdentityOutboxOnce(chainId: number, limit: number): Promise<number> {
  const { occupied, chainOccupied } = await readAgentSyncOccupancy(chainId);
  const capacity = Math.max(
    0,
    Math.min(
      config.agentSyncBacklogTarget - occupied,
      config.agentSyncChainBacklogTarget - chainOccupied,
    ),
  );
  const boundedLimit = Math.max(0, Math.min(limit, capacity));
  if (boundedLimit === 0) return 0;
  const sourceKey = `evm:${chainId}:identity`;
  const readyAt = new Date();
  let attemptedIds: string[] = [];
  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; payload: unknown }>>`
        SELECT id, payload
        FROM indexer_outbox
        WHERE queue_name = ${INDEXER_QUEUES.AGENT_SYNC}
          AND source_key = ${sourceKey}
          AND dispatched_at IS NULL
          AND available_at <= ${readyAt}
        ORDER BY available_at ASC, created_at ASC
        LIMIT ${boundedLimit}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return { enqueued: 0, inserted: 0 };
      attemptedIds = rows.map((row) => row.id);
      const requests = rows.map((row) => ({
        outboxId: row.id,
        jobId: randomUUID(),
        payload: row.payload as IdentityOutboxPayload,
      }));
      const insertedIdSet = new Set(await enqueueAgentSyncBatchInTx(
        tx,
        requests.map(({ jobId, payload }) => ({ id: jobId, payload })),
      ));
      const dispatchedOutboxIds: string[] = [];
      const blockedOutboxIds: string[] = [];
      for (const request of requests) {
        (insertedIdSet.has(request.jobId) ? dispatchedOutboxIds : blockedOutboxIds).push(request.outboxId);
      }
      let enqueued = 0;
      if (dispatchedOutboxIds.length > 0) {
        const marked = await tx.indexerOutbox.updateMany({
          where: { id: { in: dispatchedOutboxIds }, dispatchedAt: null },
          data: { dispatchedAt: new Date(), attempts: { increment: 1 }, lastError: null },
        });
        enqueued = marked.count;
      }
      if (blockedOutboxIds.length > 0) {
        // A matching singleton is still active. Leave these rows undispatched so a later
        // outbox pass can prove that durable queue rows were actually accepted.
        await tx.indexerOutbox.updateMany({
          where: { id: { in: blockedOutboxIds }, dispatchedAt: null },
          data: {
            attempts: { increment: 1 },
            lastError: "matching pg-boss singleton still active",
            availableAt: new Date(Date.now() + AGENT_SYNC_SINGLETON_RETRY_MS),
          },
        });
      }
      return { enqueued, inserted: insertedIdSet.size };
    }, { timeout: 30_000, maxWait: 10_000 });
    consumeAgentSyncCapacity(chainId, result.inserted);
    return result.enqueued;
  } catch (error) {
    if (attemptedIds.length > 0) {
      await prisma.indexerOutbox.updateMany({
        where: { id: { in: attemptedIds }, dispatchedAt: null },
        data: {
          attempts: { increment: 1 },
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
          availableAt: new Date(Date.now() + 5_000),
        },
      });
    }
    throw error;
  }
}

export function dispatchIdentityOutbox(
  chainId: number,
  limit = config.agentSyncBacklogTarget,
): Promise<number> {
  const tail = identityOutboxDispatchTails.get(chainId) ?? Promise.resolve();
  const result = tail.then(() => dispatchIdentityOutboxOnce(chainId, limit));
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  identityOutboxDispatchTails.set(chainId, settled);
  void settled.then(() => {
    if (identityOutboxDispatchTails.get(chainId) === settled) {
      identityOutboxDispatchTails.delete(chainId);
    }
  });
  return result;
}
export async function scanIdentityEvents(input: {
  chainId: number;
  registryAddress: string;
  fromBlock: bigint;
  toBlock: bigint;
  chunkMax: number;
  finalityPolicy: string;
  signal?: AbortSignal;
  checkpoint?: ProgressCheckpoint;
}): Promise<{
  enqueued: number;
  decoded: number;
  malformed: number;
  malformedByReason: Readonly<Record<IdentityLogRejectionCode, number>>;
}> {
  throwIfAborted(input.signal);
  const registryAddress = canonicalEvmAddress(input.registryAddress);
  return withRpcFallback(input.chainId, async (client, endpoint) => {
    throwIfAborted(input.signal);
    const timeCache = new Map<string, Date | null>();
    let workCount = 0;
    let decodedCount = 0;
    let malformed = 0;
    const malformedByReason: Record<IdentityLogRejectionCode, number> = {
      missing_signature_topic: 0,
      strict_abi_decode_failed: 0,
      wrong_topic_count: 0,
      missing_canonical_coordinates: 0,
    };
    let cursor = input.fromBlock;
    const logRangeDomain = `identity:${registryAddress.toLowerCase()}`;
    let chunkSize = Math.max(1, Math.min(input.chunkMax, endpoint.learnedLogRange(logRangeDomain, input.chunkMax)));
    while (cursor <= input.toBlock) {
      throwIfAborted(input.signal);
      const end = cursor + BigInt(chunkSize) - 1n > input.toBlock ? input.toBlock : cursor + BigInt(chunkSize) - 1n;
      let logs: RawIdentityLog[];
      try {
        logs = await client.getLogs({
          address: registryAddress as Hex,
          events: IDENTITY_EVENTS_ABI,
          fromBlock: cursor,
          toBlock: end,
        }) as RawIdentityLog[];
        await preloadPersistedBlockTimes(input.chainId, logs, timeCache);
      } catch (error) {
        const classification = classifyRpcError(error);
        if ((classification === "range_limit" || classification === "response_size_limit") && chunkSize > 1) {
          chunkSize = reducedRpcLogRange(error, chunkSize);
          await endpoint.recordLearnedLogRange(logRangeDomain, chunkSize);
          continue;
        }
        throw error;
      }
      await hydrateMissingBlockTimes(input.chainId, client, logs, timeCache, input.signal);
      const byTransaction = new Map<string, DecodedIdentityEvent[]>();
      const earliestUpgradeByBlock = new Map<bigint, number>();
      for (const raw of logs) {
        throwIfAborted(input.signal);
        const event = decodeIdentityLog(input.chainId, registryAddress, raw, timeCache);
        if ("rejectionReason" in event) {
          await persistRejectedLog(
            input.chainId,
            registryAddress,
            raw,
            event.rejectionReason,
            event.cause,
          );
          malformed += 1;
          malformedByReason[event.rejectionCode] += 1;
          continue;
        }
        decodedCount += 1;
        const list = byTransaction.get(event.transactionHash);
        if (list) list.push(event);
        else byTransaction.set(event.transactionHash, [event]);
        if (event.eventName === "Upgraded" || event.eventName === "BeaconUpgraded") {
          const current = earliestUpgradeByBlock.get(event.blockNumber);
          if (current == null || event.transactionIndex < current) {
            earliestUpgradeByBlock.set(event.blockNumber, event.transactionIndex);
          }
        }
      }
      const transactions = [...byTransaction.values()];
      for (const events of transactions) {
        events.sort((a, b) => compareEvmEventPosition(a.position, b.position));
      }
      transactions.sort((a, b) => compareEvmEventPosition(a[0]!.position, b[0]!.position));
      for (const events of transactions) {
        throwIfAborted(input.signal);
        const first = events[0]!;
        const generation = await resolveContractGeneration({
          client,
          chainId: input.chainId,
          proxyAddress: registryAddress,
          blockNumber: first.blockNumber,
          blockHash: first.blockHash,
          stateBlockNumber: generationStateBlockForTransaction(
            first.blockNumber,
            first.transactionIndex,
            earliestUpgradeByBlock.get(first.blockNumber) ?? null,
          ),
          effectiveFromTxIndex: first.transactionIndex,
          effectiveFromLogIndex: first.logIndex,
          decoderVersion: IDENTITY_EVENT_DECODER_VERSION,
        });
        workCount += (await reduceTransaction({
          client,
          chainId: input.chainId,
          registryAddress,
          generation: generation.generationKey,
          generationId: generation.id,
          events,
          eventsAlreadySorted: true,
          finalityPolicy: input.finalityPolicy,
          signal: input.signal,
        })).length;
      }
      await input.checkpoint?.({ phase: "identity-range-reduced", chainId: input.chainId, completedBlock: end.toString(10), decoded: decodedCount, malformed });
      cursor = end + 1n;
    }
    // Observation and outbox intent are committed together. Delivery can be retried without
    // advancing the source cursor past undispatched materialization work.
    throwIfAborted(input.signal);
    const enqueued = await dispatchIdentityOutbox(input.chainId, Math.max(1, workCount));
    const logSummary = scannedRangeLog(String(input.chainId));
    if (logSummary) {
      logger.info("identity event ranges scanned", {
        ...logSummary,
        chainId: input.chainId,
        registryAddress: input.registryAddress,
        fromBlock: input.fromBlock.toString(10),
        toBlock: input.toBlock.toString(10),
        configuredChunkMax: input.chunkMax,
        effectiveChunkSize: chunkSize,
        finalityPolicy: input.finalityPolicy,
        decoded: decodedCount,
        malformed,
        malformedByReason,
        enqueued,
      }, "sync");
    }
    return { enqueued, decoded: decodedCount, malformed, malformedByReason };
  }, { blockNumber: input.toBlock, signal: input.signal, requiresArchive: true, requiresLogs: true });
}
