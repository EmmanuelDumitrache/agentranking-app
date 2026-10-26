import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { throwIfAborted } from "../lib/abort.js";
import { reducedRpcLogRange } from "../lib/rpc-error-classification.js";
import {
  bytesToHex,
  decodeEventLog,
  keccak256,
  hexToBytes,
  parseAbi,
  type Hex,
  type Log,
} from "viem";
import type { ProgressCheckpoint } from "../lib/progress.js";
import { prisma } from "../db.js";
import { withSerializableRetry } from "../lib/serializable-retry.js";
import { toPostgresJsonValue } from "../lib/postgres-json.js";
import { prismaJson } from "../lib/prisma-json.js";
import { nextCursorStart, registrySourceKey } from "../lib/source-cursor.js";
import { config } from "../config.js";
import { getChainByChainId, isErc8004IndexingEnabled, registryDeploymentSearchHint } from "../chains.js";
import { resolveRegistryDeploymentBoundary } from "../lib/registry-deployment-boundary.js";
import { classifyRpcError, getRpcFinalitySnapshot, getRpcUrls, withRpcFallback } from "./rpc.js";
import { normalizeChainString, normalizationEvidence } from "../lib/chain-string.js";
import {
  UINT64_MAX,
  canonicalEvmAddress,
  canonicalUint256,
  compatibleAgentInt,
  evmEventKey,
  exactFixedPoint,
  parseData32,
  parseRpcData,
  validateErc8004FeedbackValue,
} from "../lib/exact-protocol.js";
import { resolveContractGeneration } from "./contract-generation.js";
import { hydrateMissingBlockTimes, preloadPersistedBlockTimes } from "./evm-block-time-cache.js";
import { fetchIpfsBytes, isIpfsReference } from "../lib/ipfs-rpc.js";
import { fetchPublicBytes } from "../lib/public-json.js";
import { decodeJsonBytes, isLosslessObject, type LosslessJsonValue } from "../lib/lossless-json.js";
import { decodeProtocolDocument } from "../lib/protocol-document-decoder.js";
import { protocolDocumentConsistency } from "../lib/protocol-document-consistency.js";
import { parseOptionalStrictUnsignedInteger } from "../lib/strict-integer.js";
import { redactSensitiveText } from "../lib/secret-redaction.js";
import { adjustChainFeedbackCounts } from "./chain-feedback-counts.js";
const REPUTATION_DECODER_VERSION = "erc8004-reputation/3.1.0";
const EXISTING_EVENT_LOOKUP_BATCH = 5_000;
// Keep each Prisma multi-row insert below PostgreSQL's parameter ceiling while
// halving statement/trigger overhead for large first-time projections.
const FEEDBACK_PROJECTION_BATCH = 2_000;
const POSTGRES_INT_MAX = 2_147_483_647n;
class MalformedReputationObservationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MalformedReputationObservationError";
  }
}
function malformedObservation<T>(label: string, operation: () => T): T {
  try { return operation(); }
  catch (error) { throw new MalformedReputationObservationError(label, error); }
}
const REPUTATION_ABI = parseAbi([
  "event NewFeedback(uint256 indexed agentId,address indexed clientAddress,uint64 feedbackIndex,int128 value,uint8 valueDecimals,string indexed indexedTag1,string tag1,string tag2,string endpoint,string feedbackURI,bytes32 feedbackHash)",
  "event FeedbackRevoked(uint256 indexed agentId,address indexed clientAddress,uint64 indexed feedbackIndex)",
  "event ResponseAppended(uint256 indexed agentId,address indexed clientAddress,uint64 feedbackIndex,address indexed responder,string responseURI,bytes32 responseHash)",
]);
type RawLog = Log<bigint, number, false, undefined, true>;
type Decoded = {
  raw: RawLog;
  eventName: string;
  args: Record<string, unknown>;
  eventKey: string;
  blockNumber: bigint;
  blockHash: Hex;
  blockTime: Date | null;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};
function expectedTopicCount(eventName: string): number {
  if (eventName === "NewFeedback" || eventName === "FeedbackRevoked" || eventName === "ResponseAppended") return 4;
  return 0;
}
function cachedBlockTime(cache: Map<string, Date | null>, hash: Hex): Date | null {
  const cacheKey = hash.toLowerCase();
  if (!cache.has(cacheKey)) {
    throw new Error(`feedback block time ${hash} was not hydrated before decoding`);
  }
  return cache.get(cacheKey) ?? null;
}
function decodeLog(chainId: number, address: string, raw: RawLog, cache: Map<string, Date | null>): Decoded | null {
  if (raw.blockNumber == null || raw.blockHash == null || raw.transactionHash == null || raw.transactionIndex == null || raw.logIndex == null) return null;
  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({ abi: REPUTATION_ABI, topics: raw.topics, data: raw.data, strict: true });
  } catch {
    return null;
  }
  if (raw.topics.length !== expectedTopicCount(decoded.eventName)) return null;
  const blockHash = parseData32(raw.blockHash, "feedback block hash");
  const transactionHash = parseData32(raw.transactionHash, "feedback transaction hash");
  return {
    raw,
    eventName: decoded.eventName,
    args: decoded.args as Record<string, unknown>,
    eventKey: evmEventKey({ chainId, contractAddress: address, blockHash, transactionHash, logIndex: raw.logIndex }),
    blockNumber: raw.blockNumber,
    blockHash,
    blockTime: cachedBlockTime(cache, blockHash),
    transactionHash,
    transactionIndex: raw.transactionIndex,
    logIndex: raw.logIndex,
  };
}
async function persistRaw(chainId: number, address: string, generationId: string | null, event: Decoded, policy: string): Promise<void> {
  await prisma.evmEventObservation.upsert({
    where: { eventKey: event.eventKey },
    create: {
      eventKey: event.eventKey,
      businessKey: `reputation:${chainId}:${address.toLowerCase()}:${event.transactionHash}:${event.logIndex}`,
      chainId,
      contractAddress: address,
      contractGenerationId: generationId,
      eventName: event.eventName,
      topic0: event.raw.topics[0] ?? null,
      topics: [...event.raw.topics],
      data: Buffer.from(hexToBytes(parseRpcData(event.raw.data))),
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      blockTime: event.blockTime,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      status: "finalized",
      finalityPolicy: policy,
      decoderVersion: REPUTATION_DECODER_VERSION,
      decoded: toPostgresJsonValue(event.args) as never,
    },
    update: { status: "finalized", contractGenerationId: generationId, decoded: toPostgresJsonValue(event.args) as never },
  });
}
async function classifyResponder(chainId: number, registryAddress: string, agentId: string, responder: string, event: Decoded) {
  const identity = await prisma.evmIdentityObservation.findFirst({
    where: {
      chainId,
      registryAddress,
      protocolAgentId: agentId,
      status: "finalized",
      OR: [
        { blockNumber: { lt: event.blockNumber } },
        { blockNumber: event.blockNumber, transactionIndex: { lt: event.transactionIndex } },
        { blockNumber: event.blockNumber, transactionIndex: event.transactionIndex, lastLogIndex: { lte: event.logIndex } },
      ],
    },
    orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { lastLogIndex: "desc" }],
    select: {
      businessKey: true,
      currentOwner: true,
      currentAgentWallet: true,
      blockNumber: true,
    },
  });
  const normalized = canonicalEvmAddress(responder).toLowerCase();
  if (identity?.currentOwner?.toLowerCase() === normalized) return { classification: "current_owner", identity };
  if (identity?.currentAgentWallet?.toLowerCase() === normalized) return { classification: "verified_agent_wallet", identity };
  return { classification: "third_party", identity };
}
type FeedbackDocumentEvidence = {
  rawBytes: Uint8Array | null;
  rawDigest: string | null;
  commitmentDigest: string | null;
  hashValid: boolean | null;
  declaredAt: Date | null;
  fetchedAt: Date | null;
  error: string | null;
  parsed: unknown | null;
  normalized: Record<string, unknown> | null;
  diagnostics: Record<string, unknown> | null;
};
const ZERO_HASH = `0x${"0".repeat(64)}`;
function declaredDocumentTime(value: LosslessJsonValue): Date | null {
  if (!isLosslessObject(value)) return null;
  for (const key of ["timestamp", "createdAt", "created_at", "updatedAt", "updated_at"]) {
    const candidate = value[key];
    if (typeof candidate !== "string") continue;
    const date = new Date(candidate);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}
async function fetchFeedbackDocumentEvidence(uri: string | null, expectedHash: string | null, role: "feedback" | "feedback-response", signal?: AbortSignal): Promise<FeedbackDocumentEvidence> {
  throwIfAborted(signal);
  if (!uri) return { rawBytes: null, rawDigest: null, commitmentDigest: null, hashValid: null, declaredAt: null, fetchedAt: null, error: null, parsed: null, normalized: null, diagnostics: null };
  const fetchedAt = new Date();
  try {
    const bytes = isIpfsReference(uri)
      ? (await fetchIpfsBytes(uri, signal)).bytes
      : (await fetchPublicBytes(uri, 15_000, 1_048_576, signal)).bytes;
    const commitmentDigest = keccak256(bytesToHex(bytes));
    const rawDigest = createHash("sha256").update(bytes).digest("hex");
    const hashValid = expectedHash == null || expectedHash.toLowerCase() === ZERO_HASH
      ? null
      : commitmentDigest.toLowerCase() === expectedHash.toLowerCase();
    let declaredAt: Date | null = null;
    try { declaredAt = declaredDocumentTime(decodeJsonBytes(bytes).value); } catch { /* document can be non-JSON */ }
    const decoded = decodeProtocolDocument(bytes, role);
    return { rawBytes: bytes, rawDigest, commitmentDigest, hashValid, declaredAt, fetchedAt, error: null, parsed: decoded.parsed, normalized: decoded.normalized, diagnostics: decoded.diagnostics };
  } catch (error) {
    return {
      rawBytes: null, rawDigest: null, commitmentDigest: null, hashValid: null, declaredAt: null, fetchedAt,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 2_000), parsed: null, normalized: null, diagnostics: null,
    };
  }
}
async function persistObservation(chainId: number, address: string, generation: string, event: Decoded, signal?: AbortSignal): Promise<string | null> {
  throwIfAborted(signal);
  const parsedIdentity = malformedObservation("invalid reputation event identity", () => {
    const agentRaw = event.args.agentId;
    const clientRaw = event.args.clientAddress;
    const indexRaw = event.args.feedbackIndex;
    if (typeof agentRaw !== "bigint" || typeof clientRaw !== "string" || typeof indexRaw !== "bigint") {
      throw new Error("invalid reputation event identity fields");
    }
    if (indexRaw <= 0n || indexRaw > UINT64_MAX) throw new Error("feedback index is outside one-based uint64 range");
    return { agentId: canonicalUint256(agentRaw), clientAddress: canonicalEvmAddress(clientRaw), indexRaw };
  });
  const { agentId, clientAddress, indexRaw } = parsedIdentity;
  let rawValue: string | null = null;
  let valueDecimals: number | null = null;
  let exactValue: string | null = null;
  let tag1: string | null = null;
  let tag2: string | null = null;
  let endpoint: string | null = null;
  let feedbackUri: string | null = null;
  let feedbackHash: string | null = null;
  let revoked = event.eventName === "FeedbackRevoked";
  let responder: string | null = null;
  let responseUri: string | null = null;
  let responseHash: string | null = null;
  let responderClassification: string | null = null;
  let classificationEvidence: unknown = null;
  let stringNormalizationEvidence: Record<string, unknown> | null = null;
  let documentEvidence: FeedbackDocumentEvidence = { rawBytes: null, rawDigest: null, commitmentDigest: null, hashValid: null, declaredAt: null, fetchedAt: null, error: null, parsed: null, normalized: null, diagnostics: null };
  if (event.eventName === "NewFeedback") {
    const parsed = malformedObservation("invalid NewFeedback payload", () => {
      const value = event.args.value;
      const decimals = event.args.valueDecimals;
      if (typeof value !== "bigint" || typeof decimals !== "number") throw new Error("invalid NewFeedback numeric fields");
      validateErc8004FeedbackValue(value, decimals);
      const normalized = {
        tag1: normalizeChainString(event.args.tag1, { label: "feedback tag1", maxBytes: 512, allowTruncation: true }),
        tag2: normalizeChainString(event.args.tag2, { label: "feedback tag2", maxBytes: 512, allowTruncation: true }),
        endpoint: normalizeChainString(event.args.endpoint ?? "", { label: "feedback endpoint", maxBytes: 2_048, allowTruncation: true }),
        feedbackUri: normalizeChainString(event.args.feedbackURI, { label: "feedback URI", maxBytes: 2_048, allowTruncation: true }),
      };
      stringNormalizationEvidence = Object.fromEntries(Object.entries(normalized).flatMap(([key, item]) => {
        const evidence = normalizationEvidence(item);
        return evidence ? [[key, evidence]] : [];
      }));
      if (Object.keys(stringNormalizationEvidence).length === 0) stringNormalizationEvidence = null;
      return {
        rawValue: value.toString(10), valueDecimals: decimals, exactValue: exactFixedPoint(value, decimals),
        tag1: normalized.tag1.value, tag2: normalized.tag2.value, endpoint: normalized.endpoint.value, feedbackUri: normalized.feedbackUri.value,
        feedbackHash: parseData32(event.args.feedbackHash, "feedback hash"),
      };
    });
    ({ rawValue, valueDecimals, exactValue, tag1, tag2, endpoint, feedbackUri, feedbackHash } = parsed);
    documentEvidence = await fetchFeedbackDocumentEvidence(feedbackUri, feedbackHash, "feedback", signal);
  } else if (event.eventName === "ResponseAppended") {
    const parsed = malformedObservation("invalid ResponseAppended payload", () => {
      const normalizedResponseUri = normalizeChainString(event.args.responseURI, { label: "response URI", maxBytes: 2_048, allowTruncation: true });
      const evidence = normalizationEvidence(normalizedResponseUri);
      stringNormalizationEvidence = evidence ? { responseUri: evidence } : null;
      return { responder: canonicalEvmAddress(String(event.args.responder)), responseUri: normalizedResponseUri.value, responseHash: parseData32(event.args.responseHash, "response hash") };
    });
    ({ responder, responseUri, responseHash } = parsed);
    documentEvidence = await fetchFeedbackDocumentEvidence(responseUri, responseHash, "feedback-response", signal);
    const classified = await classifyResponder(chainId, address, agentId, responder, event);
    responderClassification = responder.toLowerCase() === clientAddress.toLowerCase() ? "original_feedback_client" : classified.classification;
    classificationEvidence = classified.identity == null ? null : {
      identityObservation: classified.identity.businessKey,
      owner: classified.identity.currentOwner,
      wallet: classified.identity.currentAgentWallet,
      sourceBlock: classified.identity.blockNumber.toString(10),
    };
  }
  const chain = getChainByChainId(chainId);
  const documentConsistency = protocolDocumentConsistency(documentEvidence.normalized, [
    { key: "agentRegistry", expected: chain?.identityRegistry ? `eip155:${chainId}:${canonicalEvmAddress(chain.identityRegistry)}` : null, kind: "registry" },
    { key: "agentId", expected: agentId, kind: "integer" },
    { key: "clientAddress", expected: clientAddress, kind: "address" },
    { key: "feedbackIndex", expected: indexRaw, kind: "integer" },
    { key: "value", expected: rawValue, kind: "integer" },
    { key: "valueDecimals", expected: valueDecimals, kind: "integer" },
    { key: "tag1", expected: tag1, kind: "string" },
    { key: "tag2", expected: tag2, kind: "string" },
    { key: "endpoint", expected: endpoint, kind: "uri" },
    { key: "responseUri", expected: responseUri, kind: "uri" },
    { key: "responseHash", expected: responseHash, kind: "string" },
    { key: "responder", expected: responder, kind: "address" },
  ]);
  const combinedNormalizationEvidence = {
    ...(stringNormalizationEvidence ?? {}),
    documentConsistency,
  };
  await prisma.evmFeedbackObservation.upsert({
    where: { eventKey: event.eventKey },
    create: {
      eventKey: event.eventKey,
      chainId,
      registryAddress: address,
      registryGeneration: generation,
      protocolAgentId: agentId,
      eventType: event.eventName,
      clientAddress,
      feedbackIndex: indexRaw,
      rawValue,
      valueDecimals,
      exactValue,
      tag1,
      tag2,
      endpoint,
      feedbackUri,
      feedbackHash,
      documentRawBytes: documentEvidence.rawBytes == null ? null : Buffer.from(documentEvidence.rawBytes),
      documentRawDigest: documentEvidence.rawDigest,
      documentCommitmentDigest: documentEvidence.commitmentDigest,
      documentHashValid: documentEvidence.hashValid,
      documentDeclaredAt: documentEvidence.declaredAt,
      documentFetchedAt: documentEvidence.fetchedAt,
      documentError: documentEvidence.error,
      documentParsed: prismaJson(documentEvidence.parsed),
      documentNormalized: prismaJson(documentEvidence.normalized),
      documentDiagnostics: prismaJson(documentEvidence.diagnostics),
      revoked,
      responder,
      responseUri,
      responseHash,
      responderClassification,
      classificationEvidence: classificationEvidence as never,
      normalizationEvidence: combinedNormalizationEvidence as never,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      blockTime: event.blockTime,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      status: "finalized",
      decoderVersion: REPUTATION_DECODER_VERSION,
    },
    update: {
      status: "finalized",
      materializedAt: null,
      revoked,
      responderClassification,
      classificationEvidence: classificationEvidence as never,
      normalizationEvidence: combinedNormalizationEvidence as never,
      documentRawBytes: documentEvidence.rawBytes == null ? undefined : Buffer.from(documentEvidence.rawBytes),
      documentRawDigest: documentEvidence.rawDigest ?? undefined,
      documentCommitmentDigest: documentEvidence.commitmentDigest ?? undefined,
      documentHashValid: documentEvidence.hashValid ?? undefined,
      documentDeclaredAt: documentEvidence.declaredAt ?? undefined,
      documentFetchedAt: documentEvidence.fetchedAt ?? undefined,
      documentError: documentEvidence.error,
      documentParsed: prismaJson(documentEvidence.parsed),
      documentNormalized: prismaJson(documentEvidence.normalized),
      documentDiagnostics: prismaJson(documentEvidence.diagnostics),
    },
  });
  return agentId;
}
function compatibilityFeedbackValue(rawValue: string | null, exactValue: string | null): number {
  if (rawValue == null) return 0;
  const negative = rawValue.startsWith("-");
  const digits = rawValue.replace(/^-/, "").replace(/^0+/, "") || "0";
  if (digits.length > 15) return negative ? -1_000_000_000_000_000 : 1_000_000_000_000_000;
  const parsed = Number(exactValue ?? rawValue);
  return Number.isFinite(parsed) ? parsed : (negative ? -1_000_000_000_000_000 : 1_000_000_000_000_000);
}
type CanonicalFeedbackObservation = {
  clientAddress: string;
  feedbackIndex: bigint;
  rawValue: string | null;
  exactValue: string | null;
  valueDecimals: number | null;
  tag1: string | null;
  tag2: string | null;
  feedbackUri: string | null;
  registryAddress: string;
  transactionHash: string;
  blockNumber: bigint;
  blockHash: string;
  transactionIndex: number;
  logIndex: number;
  blockTime: Date | null;
  documentDeclaredAt: Date | null;
  documentFetchedAt: Date | null;
  revoked: boolean;
};
function feedbackProjectionRow(agentId: number, observation: CanonicalFeedbackObservation) {
  return {
    agentId,
    clientAddress: observation.clientAddress,
    feedbackIndex: observation.feedbackIndex > POSTGRES_INT_MAX ? null : Number(observation.feedbackIndex),
    value: compatibilityFeedbackValue(observation.rawValue, observation.exactValue),
    rawValue: observation.rawValue,
    exactValue: observation.exactValue,
    valueDecimals: observation.valueDecimals ?? 0,
    tag1: observation.tag1 ?? "",
    tag2: observation.tag2 ?? "",
    comment: observation.feedbackUri ?? "",
    revoked: observation.revoked,
    sourceRegistry: observation.registryAddress,
    sourceTxHash: observation.transactionHash,
    sourceBlockNumber: observation.blockNumber,
    sourceBlockHash: observation.blockHash,
    sourceTransactionIndex: observation.transactionIndex,
    sourceLogIndex: observation.logIndex,
    sourceFinality: "finalized",
    chainSubmittedAt: observation.blockTime,
    documentDeclaredAt: observation.documentDeclaredAt,
    documentFetchedAt: observation.documentFetchedAt,
  };
}
async function rebuildAgentFeedbackProjection(
  chainId: number,
  currentRegistryAddress: string,
  protocolAgentId: string,
): Promise<{ rows: number; agentId: number | null; changed: boolean }> {
  const compatibilityId = compatibleAgentInt(protocolAgentId);
  if (compatibilityId == null) {
    await prisma.evmFeedbackObservation.updateMany({
      where: {
        chainId,
        registryAddress: currentRegistryAddress,
        protocolAgentId,
        materializedAt: null,
      },
      data: { materializedAt: new Date() },
    });
    return { rows: 0, agentId: null, changed: false };
  }
  return prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findFirst({
      where: { chainId, OR: [{ protocolAgentId }, { agentId: compatibilityId }] },
      select: { id: true, evmFeedbackSourceDigest: true, feedbackObservedBlock: true, activityObservedAt: true, lastActiveAt: true },
    });
    if (!agent) return { rows: 0, agentId: null, changed: false };
    // NewFeedback is the durable row identity. Revocations only contribute a
    // boolean projection, so do not load and retain the entire mixed event
    // history just to rebuild the current table.
    const observations = await tx.$queryRaw<CanonicalFeedbackObservation[]>`
      SELECT
        created.client_address AS "clientAddress",
        created.feedback_index AS "feedbackIndex",
        created.raw_value AS "rawValue",
        created.exact_value AS "exactValue",
        created.value_decimals AS "valueDecimals",
        created.tag1,
        created.tag2,
        created.feedback_uri AS "feedbackUri",
        created.registry_address AS "registryAddress",
        created.transaction_hash AS "transactionHash",
        created.block_number AS "blockNumber",
        created.block_hash AS "blockHash",
        created.transaction_index AS "transactionIndex",
        created.log_index AS "logIndex",
        created.block_time AS "blockTime",
        created.document_declared_at AS "documentDeclaredAt",
        created.document_fetched_at AS "documentFetchedAt",
        EXISTS (
          SELECT 1
          FROM evm_feedback_observations AS revoked
          WHERE revoked.chain_id = created.chain_id
            AND revoked.registry_address = created.registry_address
            AND revoked.protocol_agent_id = created.protocol_agent_id
            AND revoked.client_address = created.client_address
            AND revoked.feedback_index = created.feedback_index
            AND revoked.status = 'finalized'
            AND revoked.event_type = 'FeedbackRevoked'
        ) AS revoked
      FROM evm_feedback_observations AS created
      WHERE created.chain_id = ${chainId}
        AND created.registry_address = ${currentRegistryAddress}
        AND created.protocol_agent_id = ${protocolAgentId}
        AND created.status = 'finalized'
        AND created.event_type = 'NewFeedback'
      ORDER BY created.client_address ASC, created.feedback_index ASC
    `;
    const feedbackDigestHash = createHash("sha256");
    let previousKey: string | null = null;
    for (const observation of observations) {
      const key = `${observation.clientAddress.toLowerCase()}:${observation.feedbackIndex}`;
      if (key === previousKey) throw new Error(`duplicate canonical feedback key ${key}`);
      previousKey = key;
      feedbackDigestHash.update(JSON.stringify({
        key,
        rawValue: observation.rawValue,
        exactValue: observation.exactValue,
        valueDecimals: observation.valueDecimals,
        tag1: observation.tag1,
        tag2: observation.tag2,
        feedbackUri: observation.feedbackUri,
        revoked: observation.revoked,
        sourceRegistry: observation.registryAddress,
        sourceTxHash: observation.transactionHash,
        sourceBlockNumber: observation.blockNumber.toString(10),
        sourceBlockHash: observation.blockHash,
        sourceTransactionIndex: observation.transactionIndex,
        sourceLogIndex: observation.logIndex,
        sourceFinality: "finalized",
        chainSubmittedAt: observation.blockTime?.toISOString() ?? null,
        documentDeclaredAt: observation.documentDeclaredAt?.toISOString() ?? null,
        documentFetchedAt: observation.documentFetchedAt?.toISOString() ?? null,
      })).update("\n");
    }
    const feedbackDigest = feedbackDigestHash.digest("hex");
    const feedbackChanged = agent.evmFeedbackSourceDigest !== feedbackDigest;
    if (!feedbackChanged) {
      await tx.evmFeedbackObservation.updateMany({
        where: {
          chainId,
          registryAddress: currentRegistryAddress,
          protocolAgentId,
          materializedAt: null,
        },
        data: { materializedAt: new Date() },
      });
      return { rows: observations.length, agentId: agent.id, changed: false };
    }
    const latestObservation = await tx.evmFeedbackObservation.findFirst({
      where: {
        chainId,
        registryAddress: currentRegistryAddress,
        protocolAgentId,
        status: "finalized",
        eventType: { in: ["NewFeedback", "FeedbackRevoked"] },
      },
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { logIndex: "desc" }],
      select: { blockNumber: true, blockTime: true },
    });
    const rows = observations.map((observation) => feedbackProjectionRow(agent.id, observation));
    const [removed] = await tx.$queryRaw<Array<{ active: bigint }>>`
      WITH deleted AS (
        DELETE FROM "Feedback"
        WHERE "agentId" = ${agent.id}
          AND source_registry ~* '^0x[0-9a-f]{40}$'
        RETURNING revoked
      )
      SELECT COUNT(*) FILTER (WHERE revoked = FALSE)::bigint AS active
      FROM deleted
    `;
    for (let offset = 0; offset < rows.length; offset += FEEDBACK_PROJECTION_BATCH) {
      await tx.feedback.createMany({
        data: rows.slice(offset, offset + FEEDBACK_PROJECTION_BATCH),
      });
    }
    const activityAt = latestObservation?.blockTime &&
      (!agent.activityObservedAt || latestObservation.blockTime > agent.activityObservedAt)
      ? latestObservation.blockTime
      : agent.activityObservedAt ?? agent.lastActiveAt;
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        evmFeedbackSourceDigest: feedbackDigest,
        feedbackObservedBlock: latestObservation?.blockNumber ?? agent.feedbackObservedBlock,
        activityObservedAt: activityAt,
        lastActiveAt: activityAt,
        lastIndexedAt: new Date(),
      },
    });
    const nextActive = rows.reduce(
      (count, row) => count + (row.revoked ? 0 : 1),
      0,
    );
    const previousActive = Number(removed?.active ?? 0n);
    if (!Number.isSafeInteger(previousActive)) {
      throw new Error("EVM feedback projection count exceeds the safe integer domain");
    }
    await adjustChainFeedbackCounts(tx, chainId, {
      onchain: nextActive - previousActive,
    });
    await tx.evmFeedbackObservation.updateMany({
      where: {
        chainId,
        registryAddress: currentRegistryAddress,
        protocolAgentId,
        materializedAt: null,
      },
      data: { materializedAt: new Date() },
    });
    return { rows: rows.length, agentId: agent.id, changed: true };
  }, { isolationLevel: "RepeatableRead" });
}
type FeedbackProjectionCoordinate = {
  clientAddress: string;
  feedbackIndex: bigint;
  requiresProjection: boolean;
};
async function materializeAgentFeedback(
  chainId: number,
  currentRegistryAddress: string,
  protocolAgentId: string,
): Promise<{ rows: number; agentId: number | null; changed: boolean }> {
  const compatibilityId = compatibleAgentInt(protocolAgentId);
  const pendingCoordinates = await prisma.$queryRaw<FeedbackProjectionCoordinate[]>`
    SELECT
      client_address AS "clientAddress",
      feedback_index AS "feedbackIndex",
      BOOL_OR(event_type IN ('NewFeedback', 'FeedbackRevoked')) AS "requiresProjection"
    FROM evm_feedback_observations
    WHERE chain_id = ${chainId}
      AND registry_address = ${currentRegistryAddress}
      AND protocol_agent_id = ${protocolAgentId}
      AND materialized_at IS NULL
    GROUP BY client_address, feedback_index
    ORDER BY client_address ASC, feedback_index ASC
  `;
  if (pendingCoordinates.length === 0) {
    return { rows: 0, agentId: null, changed: false };
  }
  // The compatibility projection has only an integer feedback key. Preserve the
  // established full-rebuild behavior for the exceptional uint64 values that
  // cannot be addressed incrementally in that schema.
  if (
    compatibilityId == null ||
    pendingCoordinates.some(
      (coordinate) => coordinate.requiresProjection && coordinate.feedbackIndex > POSTGRES_INT_MAX,
    )
  ) {
    return rebuildAgentFeedbackProjection(chainId, currentRegistryAddress, protocolAgentId);
  }
  return prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findFirst({
      where: { chainId, OR: [{ protocolAgentId }, { agentId: compatibilityId }] },
      select: {
        id: true,
        feedbackObservedBlock: true,
        activityObservedAt: true,
        lastActiveAt: true,
      },
    });
    // Keep the marker pending until its registry Agent exists so a later identity
    // materialization can project the already-observed feedback.
    if (!agent) return { rows: 0, agentId: null, changed: false };
    let projectedRows = 0;
    let previousActive = 0;
    let nextActive = 0;
    let projectionRequired = false;
    for (let offset = 0; offset < pendingCoordinates.length; offset += FEEDBACK_PROJECTION_BATCH) {
      const batch = pendingCoordinates.slice(offset, offset + FEEDBACK_PROJECTION_BATCH);
      const projectionBatch = batch.filter((coordinate) => coordinate.requiresProjection);
      if (projectionBatch.length > 0) {
        projectionRequired = true;
        const projectionCoordinates = Prisma.join(projectionBatch.map((coordinate) => Prisma.sql`(
          ${coordinate.clientAddress}::text,
          ${coordinate.feedbackIndex}::bigint
        )`));
        const observations = await tx.$queryRaw<CanonicalFeedbackObservation[]>(Prisma.sql`
          WITH affected(client_address, feedback_index) AS (
            VALUES ${projectionCoordinates}
          )
          SELECT
            created.client_address AS "clientAddress",
            created.feedback_index AS "feedbackIndex",
            created.raw_value AS "rawValue",
            created.exact_value AS "exactValue",
            created.value_decimals AS "valueDecimals",
            created.tag1,
            created.tag2,
            created.feedback_uri AS "feedbackUri",
            created.registry_address AS "registryAddress",
            created.transaction_hash AS "transactionHash",
            created.block_number AS "blockNumber",
            created.block_hash AS "blockHash",
            created.transaction_index AS "transactionIndex",
            created.log_index AS "logIndex",
            created.block_time AS "blockTime",
            created.document_declared_at AS "documentDeclaredAt",
            created.document_fetched_at AS "documentFetchedAt",
            EXISTS (
              SELECT 1
              FROM evm_feedback_observations AS revoked
              WHERE revoked.chain_id = created.chain_id
                AND revoked.registry_address = created.registry_address
                AND revoked.protocol_agent_id = created.protocol_agent_id
                AND revoked.client_address = created.client_address
                AND revoked.feedback_index = created.feedback_index
                AND revoked.status = 'finalized'
                AND revoked.event_type = 'FeedbackRevoked'
            ) AS revoked
          FROM evm_feedback_observations AS created
          INNER JOIN affected
            ON affected.client_address = created.client_address
           AND affected.feedback_index = created.feedback_index
          WHERE created.chain_id = ${chainId}
            AND created.registry_address = ${currentRegistryAddress}
            AND created.protocol_agent_id = ${protocolAgentId}
            AND created.status = 'finalized'
            AND created.event_type = 'NewFeedback'
          ORDER BY created.client_address ASC, created.feedback_index ASC
        `);
        let previousKey: string | null = null;
        for (const observation of observations) {
          const key = `${observation.clientAddress.toLowerCase()}:${observation.feedbackIndex}`;
          if (key === previousKey) throw new Error(`duplicate canonical feedback key ${key}`);
          previousKey = key;
        }
        const [removed] = await tx.$queryRaw<Array<{ active: bigint }>>(Prisma.sql`
          WITH affected(client_address, feedback_index) AS (
            VALUES ${projectionCoordinates}
          ), deleted AS (
            DELETE FROM "Feedback" AS feedback
            USING affected
            WHERE feedback."agentId" = ${agent.id}
              AND feedback.source_registry = ${currentRegistryAddress}
              AND feedback."clientAddress" = affected.client_address
              AND feedback."feedbackIndex" = affected.feedback_index::integer
            RETURNING feedback.revoked
          )
          SELECT COUNT(*) FILTER (WHERE revoked = FALSE)::bigint AS active
          FROM deleted
        `);
        const removedActive = Number(removed?.active ?? 0n);
        if (!Number.isSafeInteger(removedActive)) {
          throw new Error("EVM feedback projection count exceeds the safe integer domain");
        }
        previousActive += removedActive;
        const rows = observations.map((observation) => feedbackProjectionRow(agent.id, observation));
        if (rows.length > 0) await tx.feedback.createMany({ data: rows });
        projectedRows += rows.length;
        nextActive += rows.reduce((count, row) => count + (row.revoked ? 0 : 1), 0);
      }
      const markerCoordinates = Prisma.join(batch.map((coordinate) => Prisma.sql`(
        ${coordinate.clientAddress}::text,
        ${coordinate.feedbackIndex}::bigint
      )`));
      await tx.$executeRaw(Prisma.sql`
        WITH affected(client_address, feedback_index) AS (
          VALUES ${markerCoordinates}
        )
        UPDATE evm_feedback_observations AS observation
        SET materialized_at = now()
        FROM affected
        WHERE observation.chain_id = ${chainId}
          AND observation.registry_address = ${currentRegistryAddress}
          AND observation.protocol_agent_id = ${protocolAgentId}
          AND observation.client_address = affected.client_address
          AND observation.feedback_index = affected.feedback_index
          AND observation.materialized_at IS NULL
      `);
    }
    if (!projectionRequired) {
      return { rows: 0, agentId: agent.id, changed: false };
    }
    const latestObservation = await tx.evmFeedbackObservation.findFirst({
      where: {
        chainId,
        registryAddress: currentRegistryAddress,
        protocolAgentId,
        status: "finalized",
        eventType: { in: ["NewFeedback", "FeedbackRevoked"] },
      },
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { logIndex: "desc" }],
      select: { blockNumber: true, blockTime: true },
    });
    const activityAt = latestObservation?.blockTime &&
      (!agent.activityObservedAt || latestObservation.blockTime > agent.activityObservedAt)
      ? latestObservation.blockTime
      : agent.activityObservedAt ?? agent.lastActiveAt;
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        evmFeedbackSourceDigest: null,
        feedbackObservedBlock: latestObservation?.blockNumber ?? agent.feedbackObservedBlock,
        activityObservedAt: activityAt,
        lastActiveAt: activityAt,
        lastIndexedAt: new Date(),
      },
    });
    await adjustChainFeedbackCounts(tx, chainId, {
      onchain: nextActive - previousActive,
    });
    return { rows: projectedRows, agentId: agent.id, changed: true };
  }, { isolationLevel: "RepeatableRead" });
}
async function quarantineMalformedLog(chainId: number, registryAddress: string, raw: RawLog, reason: string): Promise<void> {
  const blockHash = raw.blockHash && /^0x[0-9a-fA-F]{64}$/.test(raw.blockHash) ? raw.blockHash : null;
  const transactionHash = raw.transactionHash && /^0x[0-9a-fA-F]{64}$/.test(raw.transactionHash) ? raw.transactionHash : null;
  const eventKey = blockHash && transactionHash && raw.logIndex != null
    ? evmEventKey({ chainId, contractAddress: registryAddress, blockHash, transactionHash, logIndex: raw.logIndex })
    : `reputation:malformed:${chainId}:${registryAddress.toLowerCase()}:${raw.transactionHash ?? "none"}:${raw.logIndex ?? "none"}`;
  let data: Uint8Array<ArrayBuffer>;
  try { data = Uint8Array.from(hexToBytes(parseRpcData(raw.data))); }
  catch { data = Uint8Array.from(Buffer.from(String(raw.data))); }
  await prisma.evmEventObservation.upsert({
    where: { eventKey },
    create: {
      eventKey,
      businessKey: `reputation:rejected:${eventKey}`,
      chainId,
      contractAddress: registryAddress,
      eventName: "Unknown",
      topic0: raw.topics[0] ?? null,
      topics: [...raw.topics],
      data,
      blockNumber: raw.blockNumber,
      blockHash,
      transactionHash,
      transactionIndex: raw.transactionIndex,
      logIndex: raw.logIndex,
      status: "malformed",
      decoderVersion: REPUTATION_DECODER_VERSION,
      rejectionReason: reason.slice(0, 2_000),
    },
    update: { status: "malformed", rejectionReason: reason.slice(0, 2_000) },
  });
}
async function markOrphaned(chainId: number, registryAddress: string, fromBlock: bigint): Promise<string[]> {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const affected = await tx.$queryRaw<Array<{ protocolAgentId: string }>>`
      SELECT DISTINCT protocol_agent_id AS "protocolAgentId"
      FROM evm_feedback_observations
      WHERE chain_id = ${chainId}
        AND registry_address = ${registryAddress}
        AND block_number >= ${fromBlock}
        AND (status = 'finalized' OR materialized_at IS NULL)
    `;
    const branch = { blockNumber: { gte: fromBlock } };
    await tx.evmEventObservation.updateMany({ where: { chainId, contractAddress: registryAddress, ...branch }, data: { status: "orphaned", removed: true } });
    await tx.evmFeedbackObservation.updateMany({
      where: { chainId, registryAddress, ...branch },
      data: { status: "orphaned", materializedAt: null },
    });
    return affected.map((row) => row.protocolAgentId);
  }, { isolationLevel: "Serializable" }));
}
export async function syncFeedbackFromChain(chainId: number, signal?: AbortSignal, checkpoint?: ProgressCheckpoint): Promise<{ synced: number; errors: number; scanned: number; hasMore: boolean }> {
  const chain = getChainByChainId(chainId);
  if (!chain || !isErc8004IndexingEnabled(chain) || getRpcUrls(chainId).length === 0 || !chain.reputationRegistry) return { synced: 0, errors: 0, scanned: 0, hasMore: false };
  const registryAddress = canonicalEvmAddress(chain.reputationRegistry);
  const finality = await getRpcFinalitySnapshot(chainId, signal);
  const deploymentSearchHint = registryDeploymentSearchHint(chain, "reputation");
  const cursorIdentity = registrySourceKey({
    chainId, domain: "reputation", registryAddress, eventSignature: "erc8004.reputation.events.v2", deploymentBlock: deploymentSearchHint,
  });
  const { sourceKey, registryGeneration } = cursorIdentity;
  const deployment = await resolveRegistryDeploymentBoundary({
    chain,
    domain: "reputation",
    sourceKey,
    registryGeneration,
    finalizedHead: finality.finalized,
    finalizedHash: finality.finalizedHash,
    signal,
  });
  const cursor = await prisma.indexerSourceCursor.findUnique({ where: { sourceKey } });
  let start = nextCursorStart({ sourceKey, deploymentBlock: deployment, persistedBlock: cursor?.blockNumber, finalizedHead: finality.finalized });
  const affected = new Set<string>();
  if (cursor?.blockNumber != null && cursor.blockHash) {
    const canonicalHash = await withRpcFallback(chainId, async (client) => (await client.getBlock({ blockNumber: cursor.blockNumber!, includeTransactions: false })).hash, { blockNumber: cursor.blockNumber, signal });
    if (!canonicalHash || canonicalHash.toLowerCase() !== cursor.blockHash.toLowerCase()) {
      const overlap = BigInt(parseOptionalStrictUnsignedInteger(process.env.EVM_REORG_OVERLAP_BLOCKS, "EVM_REORG_OVERLAP_BLOCKS", 128, { maximum: 1_000_000 }));
      const rewound = cursor.blockNumber > overlap ? cursor.blockNumber - overlap : 0n;
      start = rewound > deployment ? rewound : deployment;
      for (const agentId of await markOrphaned(chainId, registryAddress, start)) affected.add(agentId);
    }
  }
  if (start > finality.finalized) {
    return { synced: 0, errors: 0, scanned: 0, hasMore: false };
  }
  const boundedSpan = BigInt(Math.max(1, config.catchupGetLogsChunkMax) * Math.max(1, config.maxBlockChunksPerJob));
  const end = start + boundedSpan - 1n > finality.finalized ? finality.finalized : start + boundedSpan - 1n;
  let errors = 0;
  let observedLogs = 0;
  await withRpcFallback(chainId, async (client, endpoint) => {
    const timeCache = new Map<string, Date | null>();
    let scan = start;
    const logRangeDomain = `reputation:${registryAddress.toLowerCase()}`;
    let chunk = Math.max(1, Math.min(config.catchupGetLogsChunkMax, endpoint.learnedLogRange(logRangeDomain, config.catchupGetLogsChunkMax)));
    while (scan <= end) {
      if (signal?.aborted) throw signal.reason;
      const to = scan + BigInt(chunk) - 1n > end ? end : scan + BigInt(chunk) - 1n;
      let logs: RawLog[];
      try {
        logs = await client.getLogs({
          address: registryAddress as Hex,
          events: REPUTATION_ABI,
          fromBlock: scan,
          toBlock: to,
        }) as RawLog[];
        await preloadPersistedBlockTimes(chainId, logs, timeCache);
      } catch (error) {
        const classification = classifyRpcError(error);
        if ((classification === "range_limit" || classification === "response_size_limit") && chunk > 1) { chunk = reducedRpcLogRange(error, chunk); await endpoint.recordLearnedLogRange(logRangeDomain, chunk); continue; }
        throw error;
      }
      await hydrateMissingBlockTimes(chainId, client, logs, timeCache, signal);
      observedLogs += logs.length;
      const decodedEvents: Decoded[] = [];
      for (const raw of logs) {
        const event = decodeLog(chainId, registryAddress, raw, timeCache);
        if (!event) {
          errors += 1;
          await quarantineMalformedLog(chainId, registryAddress, raw, "strict ABI/topic/coordinate decoding failed");
          continue;
        }
        decodedEvents.push(event);
      }
      const existingByEventKey = new Map<string, { protocolAgentId: string; status: string; decoderVersion: string; materializedAt: Date | null }>();
      for (let offset = 0; offset < decodedEvents.length; offset += EXISTING_EVENT_LOOKUP_BATCH) {
        const existing = await prisma.evmFeedbackObservation.findMany({
          where: {
            eventKey: {
              in: decodedEvents
                .slice(offset, offset + EXISTING_EVENT_LOOKUP_BATCH)
                .map((event) => event.eventKey),
            },
          },
          select: {
            eventKey: true,
            protocolAgentId: true,
            status: true,
            decoderVersion: true,
            materializedAt: true,
          },
        });
        for (const row of existing) existingByEventKey.set(row.eventKey, row);
      }
      for (const event of decodedEvents) {
        const existing = existingByEventKey.get(event.eventKey);
        if (existing?.status === "finalized" && existing.decoderVersion === REPUTATION_DECODER_VERSION) {
          if (existing.materializedAt == null) affected.add(existing.protocolAgentId);
          continue;
        }
        try {
          const generation = await resolveContractGeneration({ client, chainId, proxyAddress: registryAddress, blockNumber: event.blockNumber, blockHash: event.blockHash, effectiveFromTxIndex: event.transactionIndex, effectiveFromLogIndex: event.logIndex, decoderVersion: REPUTATION_DECODER_VERSION });
          await persistRaw(chainId, registryAddress, generation.id, event, finality.policy);
          const agentId = await persistObservation(chainId, registryAddress, generation.generationKey, event, signal);
          if (agentId) affected.add(agentId);
        } catch (error) {
          if (error instanceof MalformedReputationObservationError) {
            errors += 1;
            await quarantineMalformedLog(chainId, registryAddress, event.raw, redactSensitiveText(error.message));
            continue;
          }
          throw error;
        }
      }
      await checkpoint?.({ phase: "reputation-range-reduced", chainId, completedBlock: to.toString(10), affectedAgents: affected.size, errors });
      scan = to + 1n;
    }
  }, { blockNumber: end, signal, requiresArchive: true, requiresLogs: true });
  if (errors >= 3 && errors / Math.max(1, observedLogs) >= 0.25) {
    throw new Error(`feedback scan degraded: ${errors} of ${observedLogs} logs were malformed or failed persistence`);
  }
  let synced = 0;
  for (const agentId of affected) {
    throwIfAborted(signal);
    const result = await materializeAgentFeedback(chainId, registryAddress, agentId);
    synced += result.rows;
  }
  const endHash = await withRpcFallback(chainId, async (client) => {
    const block = await client.getBlock({ blockNumber: end, includeTransactions: false });
    if (!block.hash) throw new Error("feedback boundary block has no hash");
    return parseData32(block.hash);
  }, { blockNumber: end, signal });
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.indexerSourceCursor.upsert({
      where: { sourceKey },
      create: { sourceKey, chainId, domain: "reputation", registryAddress, registryGeneration, blockNumber: end, blockHash: endHash, finalityPolicy: finality.policy, sourceHead: finality.latest, canonicalHead: finality.finalized, lastAdvancedAt: new Date() },
      update: { registryAddress, registryGeneration, blockNumber: end, blockHash: endHash, finalityPolicy: finality.policy, sourceHead: finality.latest, canonicalHead: finality.finalized, lastAdvancedAt: new Date() },
    });
  }, { isolationLevel: "Serializable" }));
  await checkpoint?.({ phase: "reputation-cursor-committed", chainId, completedBlock: end.toString(10), finalizedHead: finality.finalized.toString(10), synced, errors });
  return { synced, errors, scanned: Number(end - start + 1n), hasMore: end < finality.finalized };
}
