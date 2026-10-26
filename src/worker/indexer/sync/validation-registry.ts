import {
  decodeEventLog,
  hexToBytes,
  parseAbi,
  type Hex,
  type Log,
} from "viem";
import { Prisma } from "@/generated/prisma/client";
import type { ProgressCheckpoint } from "../lib/progress.js";
import { reducedRpcLogRange } from "../lib/rpc-error-classification.js";
import { prisma } from "../db.js";
import { withSerializableRetry } from "../lib/serializable-retry.js";
import { toPostgresJsonValue } from "../lib/postgres-json.js";
import { prismaJson } from "../lib/prisma-json.js";
import { nextCursorStart, registrySourceKey } from "../lib/source-cursor.js";
import { config } from "../config.js";
import { getChainByChainId, isErc8004IndexingEnabled, registryDeploymentSearchHint } from "../chains.js";
import { resolveRegistryDeploymentBoundary } from "../lib/registry-deployment-boundary.js";
import { classifyRpcError, getRpcFinalitySnapshot, getRpcUrls, withRpcFallback } from "./rpc.js";
import {
  canonicalEvmAddress,
  canonicalUint256,
  compatibleAgentInt,
  evmEventKey,
  parseData32,
  parseRpcData,
} from "../lib/exact-protocol.js";
import { normalizeChainString, normalizationEvidence } from "../lib/chain-string.js";
import { resolveContractGeneration } from "./contract-generation.js";
import { hydrateMissingBlockTimes, preloadPersistedBlockTimes } from "./evm-block-time-cache.js";
import { logger } from "../logger.js";
import { parseOptionalStrictUnsignedInteger } from "../lib/strict-integer.js";
import { fetchIpfsBytes, isIpfsReference } from "../lib/ipfs-rpc.js";
import { fetchPublicBytes } from "../lib/public-json.js";
import { decodeProtocolDocument } from "../lib/protocol-document-decoder.js";
import { protocolDocumentConsistency } from "../lib/protocol-document-consistency.js";
import { redactSensitiveText } from "../lib/secret-redaction.js";
import { throwIfAborted } from "../lib/abort.js";
const VALIDATION_DECODER_VERSION = "erc8004-validation/3.1.0";
const EXISTING_EVENT_LOOKUP_BATCH = 5_000;
const ZERO_HASH = `0x${"0".repeat(64)}`;
const VALIDATION_ABI = parseAbi([
  "event ValidationRequest(address indexed validatorAddress,uint256 indexed agentId,string requestURI,bytes32 indexed requestHash)",
  "event ValidationResponse(address indexed validatorAddress,uint256 indexed agentId,bytes32 indexed requestHash,uint8 response,string responseURI,bytes32 responseHash,string tag)",
]);
export const VALIDATION_PASS_SCORE = 100;
type ValidationDocumentEvidence = {
  role: "validation-request" | "validation-response";
  uri: string | null;
  rawBytes: Uint8Array | null;
  rawDigest: string | null;
  commitmentDigest: string | null;
  hashValid: boolean | null;
  parsed: unknown | null;
  normalized: Record<string, unknown> | null;
  diagnostics: Record<string, unknown> | null;
  fetchedAt: Date | null;
  error: string | null;
};
async function fetchValidationDocument(uri: string | null, expectedHash: string | null, role: ValidationDocumentEvidence["role"], signal?: AbortSignal): Promise<ValidationDocumentEvidence> {
  throwIfAborted(signal);
  if (!uri) return { role, uri, rawBytes: null, rawDigest: null, commitmentDigest: null, hashValid: null, parsed: null, normalized: null, diagnostics: null, fetchedAt: null, error: null };
  const fetchedAt = new Date();
  try {
    const bytes = isIpfsReference(uri) ? (await fetchIpfsBytes(uri, signal)).bytes : (await fetchPublicBytes(uri, 15_000, 1_048_576, signal)).bytes;
    const decoded = decodeProtocolDocument(bytes, role);
    const hashValid = expectedHash == null || expectedHash.toLowerCase() === ZERO_HASH ? null : decoded.commitmentDigest.toLowerCase() === expectedHash.toLowerCase();
    return { role, uri, rawBytes: bytes, rawDigest: decoded.rawDigest, commitmentDigest: decoded.commitmentDigest, hashValid, parsed: decoded.parsed, normalized: decoded.normalized, diagnostics: decoded.diagnostics, fetchedAt, error: null };
  } catch (error) {
    return { role, uri, rawBytes: null, rawDigest: null, commitmentDigest: null, hashValid: null, parsed: null, normalized: null, diagnostics: null, fetchedAt, error: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 2_000) };
  }
}
type RawLog = Log<bigint, number, false, undefined, true>;
type Decoded = {
  raw: RawLog;
  eventName: "ValidationRequest" | "ValidationResponse";
  args: Record<string, unknown>;
  eventKey: string;
  blockNumber: bigint;
  blockHash: Hex;
  blockTime: Date | null;
  transactionHash: Hex;
  transactionIndex: number;
  logIndex: number;
};
export type ValidationLogArgs = {
  agentId: bigint | number | null | undefined;
  response: number | null | undefined;
  validatorAddress?: string | null;
  tag?: string | null;
  requestHash?: string | null;
  responseURI?: string | null;
  responseHash?: string | null;
};
export function isChainVerificationPass(response: number): boolean {
  return response >= VALIDATION_PASS_SCORE;
}
export function validationVerificationFromLog(chainId: number, args: ValidationLogArgs, txHash = "") {
  const protocolAgentId = args.agentId == null ? null : canonicalUint256(typeof args.agentId === "number" ? BigInt(args.agentId) : args.agentId);
  if (protocolAgentId == null) return null;
  const agentId = compatibleAgentInt(protocolAgentId);
  if (agentId == null) return null;
  const response = Number(args.response ?? 0);
  if (!Number.isInteger(response) || response < 0 || response > 255) return null;
  return {
    chainId,
    agentId,
    protocolAgentId,
    verified: isChainVerificationPass(response),
    score: response,
    validator: String(args.validatorAddress ?? ""),
    tag: String(args.tag ?? ""),
    txHash,
    requestHash: args.requestHash ?? null,
    responseURI: args.responseURI ?? null,
    responseHash: args.responseHash ?? null,
    hasResponse: true,
  };
}
function cachedBlockTime(cache: Map<string, Date | null>, hash: Hex): Date | null {
  const cacheKey = hash.toLowerCase();
  if (!cache.has(cacheKey)) {
    throw new Error(`validation block time ${hash} was not hydrated before decoding`);
  }
  return cache.get(cacheKey) ?? null;
}
function decodeLog(chainId: number, address: string, raw: RawLog, cache: Map<string, Date | null>): Decoded | null {
  if (raw.blockNumber == null || raw.blockHash == null || raw.transactionHash == null || raw.transactionIndex == null || raw.logIndex == null) return null;
  let decoded: ReturnType<typeof decodeEventLog>;
  try { decoded = decodeEventLog({ abi: VALIDATION_ABI, topics: raw.topics, data: raw.data, strict: true }); } catch { return null; }
  if (decoded.eventName !== "ValidationRequest" && decoded.eventName !== "ValidationResponse") return null;
  if (raw.topics.length !== 4) return null;
  const blockHash = parseData32(raw.blockHash, "validation block hash");
  const transactionHash = parseData32(raw.transactionHash, "validation transaction hash");
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
      businessKey: `validation:${chainId}:${address.toLowerCase()}:${event.transactionHash}:${event.logIndex}`,
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
      decoderVersion: VALIDATION_DECODER_VERSION,
      decoded: toPostgresJsonValue(event.args) as never,
    },
    update: { status: "finalized", contractGenerationId: generationId, decoded: toPostgresJsonValue(event.args) as never },
  });
}
async function persistObservation(chainId: number, address: string, generation: string, event: Decoded, signal?: AbortSignal): Promise<string> {
  const validator = canonicalEvmAddress(String(event.args.validatorAddress));
  const agentRaw = event.args.agentId;
  const requestHash = parseData32(event.args.requestHash, "validation request hash");
  if (typeof agentRaw !== "bigint") throw new Error("validation agent id is not uint256");
  const protocolAgentId = canonicalUint256(agentRaw);
  let requestUri: string | null = null;
  let response: number | null = null;
  let responseUri: string | null = null;
  let responseHash: string | null = null;
  let tag: string | null = null;
  let stringNormalizationEvidence: Record<string, unknown> | null = null;
  const hasResponse = event.eventName === "ValidationResponse";
  let document: ValidationDocumentEvidence;
  if (event.eventName === "ValidationRequest") {
    const normalizedRequestUri = normalizeChainString(event.args.requestURI ?? "", { label: "validation request URI", maxBytes: 2_048, allowTruncation: true });
    requestUri = normalizedRequestUri.value;
    const evidence = normalizationEvidence(normalizedRequestUri);
    stringNormalizationEvidence = evidence ? { requestUri: evidence } : null;
    const existing = await prisma.evmValidationObservation.findFirst({
      where: { chainId, registryAddress: address, requestHash, eventType: "ValidationRequest", status: "finalized" },
      select: { eventKey: true },
    });
    if (existing && existing.eventKey !== event.eventKey) throw new Error("duplicate registry-global validation request hash");
    document = await fetchValidationDocument(requestUri, requestHash, "validation-request", signal);
  } else {
    const rawResponse = event.args.response;
    if (typeof rawResponse !== "number" || !Number.isInteger(rawResponse) || rawResponse < 0 || rawResponse > 255) throw new Error("validation response is outside uint8 range");
    response = rawResponse;
    const normalizedResponseUri = normalizeChainString(event.args.responseURI ?? "", { label: "validation response URI", maxBytes: 2_048, allowTruncation: true });
    const normalizedTag = normalizeChainString(event.args.tag ?? "", { label: "validation tag", maxBytes: 512, allowTruncation: true });
    responseUri = normalizedResponseUri.value; responseHash = parseData32(event.args.responseHash, "validation response hash"); tag = normalizedTag.value;
    stringNormalizationEvidence = Object.fromEntries([
      ["responseUri", normalizationEvidence(normalizedResponseUri)], ["tag", normalizationEvidence(normalizedTag)],
    ].filter((entry): entry is [string, Record<string, unknown>] => entry[1] != null));
    if (Object.keys(stringNormalizationEvidence).length === 0) stringNormalizationEvidence = null;
    document = await fetchValidationDocument(responseUri, responseHash, "validation-response", signal);
  }
  const documentConsistency = protocolDocumentConsistency(document.normalized, [
    { key: "agentId", expected: protocolAgentId, kind: "integer" },
    { key: "validatorAddress", expected: validator, kind: "address" },
    { key: "requestHash", expected: requestHash, kind: "string" },
    { key: "requestUri", expected: requestUri, kind: "uri" },
    { key: "response", expected: response, kind: "integer" },
    { key: "responseUri", expected: responseUri, kind: "uri" },
    { key: "responseHash", expected: responseHash, kind: "string" },
    { key: "tag", expected: tag, kind: "string" },
  ]);
  const combinedNormalizationEvidence = {
    ...(stringNormalizationEvidence ?? {}),
    documentConsistency,
  };
  await prisma.evmValidationObservation.upsert({
    where: { eventKey: event.eventKey },
    create: {
      eventKey: event.eventKey,
      chainId,
      registryAddress: address,
      registryGeneration: generation,
      requestHash,
      eventType: event.eventName,
      validatorAddress: validator,
      protocolAgentId,
      requestUri,
      response,
      responseUri,
      responseHash,
      tag,
      hasResponse,
      documentRole: document.role,
      documentUri: document.uri,
      documentRawBytes: document.rawBytes == null ? null : Buffer.from(document.rawBytes),
      documentRawDigest: document.rawDigest,
      documentCommitmentDigest: document.commitmentDigest,
      documentHashValid: document.hashValid,
      documentParsed: prismaJson(document.parsed),
      documentNormalized: prismaJson(document.normalized),
      documentDiagnostics: prismaJson(document.diagnostics),
      documentFetchedAt: document.fetchedAt,
      documentError: document.error,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      blockTime: event.blockTime,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      status: "finalized",
      decoderVersion: VALIDATION_DECODER_VERSION,
      normalizationEvidence: combinedNormalizationEvidence as never,
    },
    update: {
      status: "finalized", response, responseUri, responseHash, tag, hasResponse,
      materializedAt: null,
      normalizationEvidence: combinedNormalizationEvidence as never,
      documentRole: document.role,
      documentUri: document.uri,
      documentRawBytes: document.rawBytes == null ? undefined : Buffer.from(document.rawBytes),
      documentRawDigest: document.rawDigest ?? undefined,
      documentCommitmentDigest: document.commitmentDigest ?? undefined,
      documentHashValid: document.hashValid ?? undefined,
      documentParsed: prismaJson(document.parsed),
      documentNormalized: prismaJson(document.normalized),
      documentDiagnostics: prismaJson(document.diagnostics),
      documentFetchedAt: document.fetchedAt ?? undefined,
      documentError: document.error,
    },
  });
  return protocolAgentId;
}
async function materializeAgents(
  chainId: number,
  currentRegistryAddress: string,
  protocolAgentIds: readonly string[],
): Promise<number> {
  const seenProtocolAgentIds = new Set<string>();
  const affectedAgents: Array<{ protocolAgentId: string; agentId: number }> = [];
  for (const protocolAgentId of protocolAgentIds) {
    if (seenProtocolAgentIds.has(protocolAgentId)) continue;
    seenProtocolAgentIds.add(protocolAgentId);
    const agentId = compatibleAgentInt(protocolAgentId);
    if (agentId == null) continue;
    affectedAgents.push({ protocolAgentId, agentId });
  }
  let materialized = 0;
  for (let offset = 0; offset < affectedAgents.length; offset += 500) {
    const batch = affectedAgents.slice(offset, offset + 500);
    const [result] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      WITH affected(protocol_agent_id, agent_id) AS (
        VALUES ${Prisma.join(batch.map((row) => Prisma.sql`(
          ${row.protocolAgentId}::text,
          ${row.agentId}::integer
        )`))}
      ), latest AS MATERIALIZED (
        SELECT DISTINCT ON (observation.protocol_agent_id)
          affected.agent_id,
          observation.protocol_agent_id,
          observation.registry_address,
          observation.response,
          observation.validator_address,
          observation.tag,
          observation.block_time,
          observation.transaction_hash,
          observation.request_hash,
          observation.response_uri,
          observation.response_hash,
          observation.block_number,
          observation.block_hash,
          observation.transaction_index,
          observation.log_index,
          observation.status
        FROM evm_validation_observations AS observation
        JOIN affected USING (protocol_agent_id)
        WHERE observation.chain_id = ${chainId}
          AND observation.registry_address = ${currentRegistryAddress}
          AND observation.event_type = 'ValidationResponse'
          AND observation.has_response = TRUE
          AND observation.response IS NOT NULL
          AND observation.status = 'finalized'
        ORDER BY
          observation.protocol_agent_id,
          observation.block_number DESC,
          observation.transaction_index DESC,
          observation.log_index DESC
      ), upserted AS (
        INSERT INTO "AgentChainVerification" (
          "chainId",
          "agentId",
          protocol_agent_id,
          source_registry,
          verified,
          score,
          validator,
          tag,
          "attestedAt",
          "txHash",
          request_hash,
          request_uri,
          response_uri,
          response_hash,
          has_response,
          source_block_number,
          source_block_hash,
          source_transaction_index,
          source_log_index,
          source_finality
        )
        SELECT
          ${chainId},
          latest.agent_id,
          latest.protocol_agent_id,
          latest.registry_address,
          latest.response >= ${VALIDATION_PASS_SCORE},
          latest.response,
          latest.validator_address,
          COALESCE(latest.tag, ''),
          latest.block_time,
          latest.transaction_hash,
          latest.request_hash,
          request.request_uri,
          latest.response_uri,
          latest.response_hash,
          TRUE,
          latest.block_number,
          latest.block_hash,
          latest.transaction_index,
          latest.log_index,
          latest.status
        FROM latest
        LEFT JOIN LATERAL (
          SELECT observation.request_uri
          FROM evm_validation_observations AS observation
          WHERE observation.chain_id = ${chainId}
            AND observation.registry_address = latest.registry_address
            AND observation.request_hash = latest.request_hash
            AND observation.event_type = 'ValidationRequest'
            AND observation.status = 'finalized'
          ORDER BY
            observation.block_number ASC,
            observation.transaction_index ASC,
            observation.log_index ASC
          LIMIT 1
        ) AS request ON TRUE
        WHERE latest.agent_id IS NOT NULL
        ON CONFLICT ("chainId", "agentId") DO UPDATE SET
          protocol_agent_id = EXCLUDED.protocol_agent_id,
          source_registry = EXCLUDED.source_registry,
          verified = EXCLUDED.verified,
          score = EXCLUDED.score,
          validator = EXCLUDED.validator,
          tag = EXCLUDED.tag,
          "attestedAt" = EXCLUDED."attestedAt",
          "txHash" = EXCLUDED."txHash",
          request_hash = EXCLUDED.request_hash,
          request_uri = EXCLUDED.request_uri,
          response_uri = EXCLUDED.response_uri,
          response_hash = EXCLUDED.response_hash,
          has_response = EXCLUDED.has_response,
          source_block_number = EXCLUDED.source_block_number,
          source_block_hash = EXCLUDED.source_block_hash,
          source_transaction_index = EXCLUDED.source_transaction_index,
          source_log_index = EXCLUDED.source_log_index,
          source_finality = EXCLUDED.source_finality
        WHERE (
          "AgentChainVerification".protocol_agent_id,
          "AgentChainVerification".source_registry,
          "AgentChainVerification".verified,
          "AgentChainVerification".score,
          "AgentChainVerification".validator,
          "AgentChainVerification".tag,
          "AgentChainVerification"."attestedAt",
          "AgentChainVerification"."txHash",
          "AgentChainVerification".request_hash,
          "AgentChainVerification".request_uri,
          "AgentChainVerification".response_uri,
          "AgentChainVerification".response_hash,
          "AgentChainVerification".has_response,
          "AgentChainVerification".source_block_number,
          "AgentChainVerification".source_block_hash,
          "AgentChainVerification".source_transaction_index,
          "AgentChainVerification".source_log_index,
          "AgentChainVerification".source_finality
        ) IS DISTINCT FROM (
          EXCLUDED.protocol_agent_id,
          EXCLUDED.source_registry,
          EXCLUDED.verified,
          EXCLUDED.score,
          EXCLUDED.validator,
          EXCLUDED.tag,
          EXCLUDED."attestedAt",
          EXCLUDED."txHash",
          EXCLUDED.request_hash,
          EXCLUDED.request_uri,
          EXCLUDED.response_uri,
          EXCLUDED.response_hash,
          EXCLUDED.has_response,
          EXCLUDED.source_block_number,
          EXCLUDED.source_block_hash,
          EXCLUDED.source_transaction_index,
          EXCLUDED.source_log_index,
          EXCLUDED.source_finality
        )
        RETURNING 1
      ), reset_orphaned AS (
        UPDATE "AgentChainVerification" AS verification
        SET
          verified = FALSE,
          score = NULL,
          validator = '',
          "attestedAt" = NULL,
          request_hash = NULL,
          request_uri = NULL,
          response_uri = NULL,
          response_hash = NULL,
          has_response = FALSE,
          source_block_number = NULL,
          source_block_hash = NULL,
          source_transaction_index = NULL,
          source_log_index = NULL,
          source_finality = 'orphaned'
        FROM affected
        WHERE verification."chainId" = ${chainId}
          AND verification."agentId" = affected.agent_id
          AND NOT EXISTS (
            SELECT 1 FROM latest WHERE latest.agent_id = affected.agent_id
          )
          AND (
            verification.verified,
            verification.score,
            verification.validator,
            verification."attestedAt",
            verification.request_hash,
            verification.request_uri,
            verification.response_uri,
            verification.response_hash,
            verification.has_response,
            verification.source_block_number,
            verification.source_block_hash,
            verification.source_transaction_index,
            verification.source_log_index,
            verification.source_finality
          ) IS DISTINCT FROM (
            FALSE, NULL, '', NULL, NULL, NULL, NULL, NULL,
            FALSE, NULL, NULL, NULL, NULL, 'orphaned'
          )
        RETURNING 1
      ), marked AS (
        UPDATE evm_validation_observations AS observation
        SET materialized_at = NOW()
        FROM affected
        WHERE observation.chain_id = ${chainId}
          AND observation.registry_address = ${currentRegistryAddress}
          AND observation.protocol_agent_id = affected.protocol_agent_id
          AND observation.materialized_at IS NULL
        RETURNING 1
      )
      SELECT
        (SELECT COUNT(*)::bigint FROM latest WHERE agent_id IS NOT NULL) AS count,
        (SELECT COUNT(*)::bigint FROM marked) AS marked
    `);
    materialized += Number(result?.count ?? 0n);
  }
  return materialized;
}
async function quarantineMalformedLog(chainId: number, registryAddress: string, raw: RawLog, reason: string): Promise<void> {
  const blockHash = raw.blockHash && /^0x[0-9a-fA-F]{64}$/.test(raw.blockHash) ? raw.blockHash : null;
  const transactionHash = raw.transactionHash && /^0x[0-9a-fA-F]{64}$/.test(raw.transactionHash) ? raw.transactionHash : null;
  const eventKey = blockHash && transactionHash && raw.logIndex != null
    ? evmEventKey({ chainId, contractAddress: registryAddress, blockHash, transactionHash, logIndex: raw.logIndex })
    : `validation:malformed:${chainId}:${registryAddress.toLowerCase()}:${raw.transactionHash ?? "none"}:${raw.logIndex ?? "none"}`;
  let data: Uint8Array<ArrayBuffer>;
  try { data = Uint8Array.from(hexToBytes(parseRpcData(raw.data))); }
  catch { data = Uint8Array.from(Buffer.from(String(raw.data))); }
  await prisma.evmEventObservation.upsert({
    where: { eventKey },
    create: {
      eventKey,
      businessKey: `validation:rejected:${eventKey}`,
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
      decoderVersion: VALIDATION_DECODER_VERSION,
      rejectionReason: reason.slice(0, 2_000),
    },
    update: { status: "malformed", rejectionReason: reason.slice(0, 2_000) },
  });
}
async function orphanValidationBranch(input: {
  chainId: number;
  registryAddress: string;
  fromBlock: bigint;
}): Promise<string[]> {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const where = {
      chainId: input.chainId,
      registryAddress: input.registryAddress,
      blockNumber: { gte: input.fromBlock },
    };
    const affected = await tx.$queryRaw<Array<{ protocolAgentId: string }>>`
      SELECT DISTINCT protocol_agent_id AS "protocolAgentId"
      FROM evm_validation_observations
      WHERE chain_id = ${input.chainId}
        AND registry_address = ${input.registryAddress}
        AND block_number >= ${input.fromBlock}
        AND (status = 'finalized' OR materialized_at IS NULL)
    `;
    await tx.evmValidationObservation.updateMany({
      where,
      data: { status: "orphaned", materializedAt: null },
    });
    await tx.evmEventObservation.updateMany({
      where: {
        chainId: input.chainId,
        contractAddress: input.registryAddress,
        blockNumber: { gte: input.fromBlock },
      },
      data: { status: "orphaned", removed: true },
    });
    return affected.map((row) => row.protocolAgentId);
  }, { isolationLevel: "Serializable" }));
}
export async function syncValidationRegistryForChain(chainId: number, maxBlocks?: number, signal?: AbortSignal, checkpoint?: ProgressCheckpoint, payloadContinuationFromBlock?: string): Promise<{ upserted: number; scanned: number; hasMore: boolean; nextBlock: string | null }> {
  const chain = getChainByChainId(chainId);
  const registryRaw = chain?.validationRegistry ?? "";
  if (!chain || !isErc8004IndexingEnabled(chain) || !registryRaw || getRpcUrls(chainId).length === 0) return { upserted: 0, scanned: 0, hasMore: false, nextBlock: null };
  const address = canonicalEvmAddress(registryRaw);
  const finality = await getRpcFinalitySnapshot(chainId, signal);
  const deploymentSearchHint = registryDeploymentSearchHint(chain, "validation");
  const cursorIdentity = registrySourceKey({
    chainId, domain: "validation", registryAddress: address, eventSignature: "erc8004.validation.events.v2", deploymentBlock: deploymentSearchHint,
  });
  const { sourceKey, registryGeneration } = cursorIdentity;
  const deployment = await resolveRegistryDeploymentBoundary({
    chain,
    domain: "validation",
    sourceKey,
    registryGeneration,
    finalizedHead: finality.finalized,
    finalizedHash: finality.finalizedHash,
    signal,
  });
  const cursor = await prisma.indexerSourceCursor.findUnique({ where: { sourceKey } });
  let start = nextCursorStart({ sourceKey, deploymentBlock: deployment, persistedBlock: cursor?.blockNumber, finalizedHead: finality.finalized });
  if (payloadContinuationFromBlock != null && BigInt(payloadContinuationFromBlock) !== start) {
    logger.info("validation continuation payload differs from authoritative cursor", {
      chainId,
      payloadContinuationFromBlock,
      authoritativeFromBlock: start.toString(10),
    }, "sync");
  }
  const affected = new Set<string>();
  if (cursor?.blockNumber != null && cursor.blockHash) {
    const canonicalHash = await withRpcFallback(chainId, async (client) => (await client.getBlock({ blockNumber: cursor.blockNumber!, includeTransactions: false })).hash, { blockNumber: cursor.blockNumber, signal });
    if (!canonicalHash || canonicalHash.toLowerCase() !== cursor.blockHash.toLowerCase()) {
      const overlap = BigInt(parseOptionalStrictUnsignedInteger(process.env.EVM_REORG_OVERLAP_BLOCKS, "EVM_REORG_OVERLAP_BLOCKS", 128, { maximum: 10_000_000 }));
      const rewound = cursor.blockNumber > overlap ? cursor.blockNumber - overlap : 0n;
      start = rewound > deployment ? rewound : deployment;
      for (const protocolAgentId of await orphanValidationBranch({
        chainId,
        registryAddress: address,
        fromBlock: start,
      })) affected.add(protocolAgentId);
    }
  }
  if (start > finality.finalized) return { upserted: 0, scanned: 0, hasMore: false, nextBlock: null };
  const span = BigInt(Math.max(1, maxBlocks ?? config.catchupMaxBlocks));
  const end = start + span - 1n > finality.finalized ? finality.finalized : start + span - 1n;
  let scanned = 0;
  await withRpcFallback(chainId, async (client, endpoint) => {
    const timeCache = new Map<string, Date | null>();
    let scan = start;
    const logRangeDomain = `validation:${address.toLowerCase()}`;
    const configuredChunk = parseOptionalStrictUnsignedInteger(process.env.VALIDATION_GETLOGS_CHUNK, "VALIDATION_GETLOGS_CHUNK", 2_000, { maximum: 10_000_000 });
    let chunk = Math.max(1, Math.min(configuredChunk, endpoint.learnedLogRange(logRangeDomain, configuredChunk)));
    while (scan <= end) {
      if (signal?.aborted) throw signal.reason;
      const to = scan + BigInt(chunk) - 1n > end ? end : scan + BigInt(chunk) - 1n;
      let logs: RawLog[];
      try {
        logs = await client.getLogs({
          address: address as Hex,
          events: VALIDATION_ABI,
          fromBlock: scan,
          toBlock: to,
        }) as RawLog[];
        await preloadPersistedBlockTimes(chainId, logs, timeCache);
      }
      catch (error) {
        const classification = classifyRpcError(error);
        if ((classification === "range_limit" || classification === "response_size_limit") && chunk > 1) { chunk = reducedRpcLogRange(error, chunk); await endpoint.recordLearnedLogRange(logRangeDomain, chunk); continue; }
        throw error;
      }
      await hydrateMissingBlockTimes(chainId, client, logs, timeCache, signal);
      const decodedEvents: Decoded[] = [];
      for (const raw of logs) {
        const event = decodeLog(chainId, address, raw, timeCache);
        if (!event) {
          await quarantineMalformedLog(chainId, address, raw, "strict ABI/topic/coordinate decoding failed");
          continue;
        }
        decodedEvents.push(event);
      }
      const existingByEventKey = new Map<string, { protocolAgentId: string; status: string; decoderVersion: string; materializedAt: Date | null }>();
      for (let offset = 0; offset < decodedEvents.length; offset += EXISTING_EVENT_LOOKUP_BATCH) {
        const existing = await prisma.evmValidationObservation.findMany({
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
        if (existing?.status === "finalized" && existing.decoderVersion === VALIDATION_DECODER_VERSION) {
          if (existing.materializedAt == null) affected.add(existing.protocolAgentId);
          scanned += 1;
          continue;
        }
        const generation = await resolveContractGeneration({ client, chainId, proxyAddress: address, blockNumber: event.blockNumber, blockHash: event.blockHash, effectiveFromTxIndex: event.transactionIndex, effectiveFromLogIndex: event.logIndex, decoderVersion: VALIDATION_DECODER_VERSION });
        await persistRaw(chainId, address, generation.id, event, finality.policy);
        affected.add(await persistObservation(chainId, address, generation.generationKey, event, signal));
        scanned += 1;
      }
      await checkpoint?.({ phase: "validation-range-reduced", chainId, completedBlock: to.toString(10), affectedAgents: affected.size, scanned });
      scan = to + 1n;
    }
  }, { blockNumber: end, signal, requiresArchive: true, requiresLogs: true });
  const upserted = await materializeAgents(chainId, address, [...affected]);
  const endHash = await withRpcFallback(chainId, async (client) => {
    const block = await client.getBlock({ blockNumber: end, includeTransactions: false });
    if (!block.hash) throw new Error("validation boundary block has no hash");
    return parseData32(block.hash);
  }, { blockNumber: end, signal });
  await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.indexerSourceCursor.upsert({
      where: { sourceKey },
      create: { sourceKey, chainId, domain: "validation", registryAddress: address, registryGeneration, blockNumber: end, blockHash: endHash, finalityPolicy: finality.policy, sourceHead: finality.latest, canonicalHead: finality.finalized, lastAdvancedAt: new Date() },
      update: { registryAddress: address, registryGeneration, blockNumber: end, blockHash: endHash, finalityPolicy: finality.policy, sourceHead: finality.latest, canonicalHead: finality.finalized, lastAdvancedAt: new Date() },
    });
  }, { isolationLevel: "Serializable" }));
  await checkpoint?.({ phase: "validation-cursor-committed", chainId, completedBlock: end.toString(10), finalizedHead: finality.finalized.toString(10), scanned, upserted });
  const hasMore = end < finality.finalized;
  return { upserted, scanned, hasMore, nextBlock: hasMore ? (end + 1n).toString(10) : null };
}
export async function fetchAndPersistChainVerification(chainId: number, agentId: number) {
  await syncValidationRegistryForChain(chainId, parseOptionalStrictUnsignedInteger(process.env.CHAIN_VERIFICATION_RPC_MAX_BLOCKS, "CHAIN_VERIFICATION_RPC_MAX_BLOCKS", 250_000, { maximum: 100_000_000 }));
  const row = await prisma.agentChainVerification.findUnique({ where: { chainId_agentId: { chainId, agentId } } });
  if (!row || row.score == null) return null;
  return {
    chainId,
    agentId,
    protocolAgentId: row.protocolAgentId ?? String(agentId),
    verified: row.verified,
    score: row.score,
    validator: row.validator,
    tag: row.tag,
    txHash: row.txHash,
    requestHash: row.requestHash,
    responseURI: row.responseURI,
    responseHash: row.responseHash,
    hasResponse: row.hasResponse === true,
  };
}
