import "../config.js";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { decodeOnchainMetadataValue, ONCHAIN_VALUE_DECODER_VERSION } from "../lib/onchain-value-decoder.js";
import { decodeProtocolDocument, type ProtocolDocumentRole } from "../lib/protocol-document-decoder.js";
import { decodeRegistrationDocument, REGISTRATION_DECODER_VERSION } from "../lib/registration-decoder.js";
import { protocolDocumentConsistency } from "../lib/protocol-document-consistency.js";
import { canonicalEvmAddress } from "../lib/exact-protocol.js";
import { getChainByChainId } from "../chains.js";
import { fetchIpfsBytes, isIpfsReference } from "../lib/ipfs-rpc.js";
import { fetchPublicBytes } from "../lib/public-json.js";
import { redactSensitiveText } from "../lib/secret-redaction.js";
import {
  decodeSolanaAgentInstruction,
  SOLANA_AGENT_INSTRUCTION_DECODER_VERSION,
  summarizeDecodedSolanaInstructions,
} from "../lib/solana-agent-instruction-decoder.js";
import { parseOptionalStrictUnsignedInteger } from "../lib/strict-integer.js";
import { prismaJson } from "../lib/prisma-json.js";
import { normalizedAgentServiceData } from "../../../lib/agent-service-normalization.js";
import {
  updateAgentServicesInBulk,
  type AgentServiceUpdate,
} from "../sync/relation-diff.js";
const BATCH_SIZE = parseOptionalStrictUnsignedInteger(process.env.ONCHAIN_INTELLIGENCE_BACKFILL_BATCH_SIZE, "ONCHAIN_INTELLIGENCE_BACKFILL_BATCH_SIZE", 250, { maximum: 5_000 });
const LIMIT = parseOptionalStrictUnsignedInteger(process.env.ONCHAIN_INTELLIGENCE_BACKFILL_LIMIT, "ONCHAIN_INTELLIGENCE_BACKFILL_LIMIT", 0, { allowZero: true, maximum: 10_000_000 });
const INCLUDE_SERVICES = !["0", "false", "no"].includes((process.env.ONCHAIN_INTELLIGENCE_BACKFILL_SERVICES ?? "true").toLowerCase());
const FETCH_MISSING_DOCUMENTS = !["0", "false", "no"].includes((process.env.ONCHAIN_INTELLIGENCE_BACKFILL_FETCH_DOCUMENTS ?? "true").toLowerCase());
type Counters = { scanned: number; updated: number; skipped: number; failed: number };
function withinLimit(count: number): boolean {
  return LIMIT === 0 || count < LIMIT;
}
function normalizedCommitment(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!/^0x[0-9a-f]{64}$/.test(normalized) || /^0x0{64}$/.test(normalized)) return null;
  return normalized;
}
function hashValidity(expected: string | null | undefined, actual: string): boolean | null {
  const commitment = normalizedCommitment(expected);
  return commitment == null ? null : commitment === actual.toLowerCase();
}
function feedbackRole(eventType: string): ProtocolDocumentRole {
  return /response/i.test(eventType) ? "feedback-response" : "feedback";
}
function validationRole(eventType: string): ProtocolDocumentRole {
  return /response/i.test(eventType) ? "validation-response" : "validation-request";
}
function protocolEvidence(existing: unknown, source: string, role?: string): Record<string, unknown> {
  const prior = existing && typeof existing === "object" && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  return {
    ...prior,
    backfill: {
      source,
      role: role ?? null,
      performedAt: new Date().toISOString(),
    },
  };
}
async function fetchDocument(uri: string): Promise<Uint8Array> {
  return isIpfsReference(uri)
    ? (await fetchIpfsBytes(uri)).bytes
    : (await fetchPublicBytes(uri, 15_000, 1_048_576)).bytes;
}
async function hydrateMissingFeedbackDocuments(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  if (!FETCH_MISSING_DOCUMENTS) return counters;
  let cursor: string | undefined;
  while (withinLimit(counters.scanned)) {
    const take = LIMIT === 0 ? BATCH_SIZE : Math.min(BATCH_SIZE, LIMIT - counters.scanned);
    const rows = await prisma.evmFeedbackObservation.findMany({
      where: {
        documentRawBytes: null,
        OR: [{ feedbackUri: { not: null } }, { responseUri: { not: null } }],
      },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        chainId: true,
        protocolAgentId: true,
        eventType: true,
        clientAddress: true,
        feedbackIndex: true,
        rawValue: true,
        valueDecimals: true,
        tag1: true,
        tag2: true,
        endpoint: true,
        feedbackUri: true,
        responseUri: true,
        responder: true,
        feedbackHash: true,
        responseHash: true,
        normalizationEvidence: true,
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      counters.scanned += 1;
      cursor = row.id;
      const role = feedbackRole(row.eventType);
      const uri = role === "feedback-response" ? row.responseUri : row.feedbackUri;
      const expected = role === "feedback-response" ? row.responseHash : row.feedbackHash;
      if (!uri?.trim()) { counters.skipped += 1; continue; }
      try {
        const bytes = await fetchDocument(uri);
        const decoded = decodeProtocolDocument(bytes, role);
        const chain = getChainByChainId(row.chainId);
        const consistency = protocolDocumentConsistency(decoded.normalized, [
          { key: "agentRegistry", expected: chain?.identityRegistry ? `eip155:${row.chainId}:${canonicalEvmAddress(chain.identityRegistry)}` : null, kind: "registry" },
          { key: "agentId", expected: row.protocolAgentId, kind: "integer" },
          { key: "clientAddress", expected: row.clientAddress, kind: "address" },
          { key: "feedbackIndex", expected: row.feedbackIndex, kind: "integer" },
          { key: "value", expected: row.rawValue, kind: "integer" },
          { key: "valueDecimals", expected: row.valueDecimals, kind: "integer" },
          { key: "tag1", expected: row.tag1, kind: "string" },
          { key: "tag2", expected: row.tag2, kind: "string" },
          { key: "endpoint", expected: row.endpoint, kind: "uri" },
          { key: "responseUri", expected: row.responseUri, kind: "uri" },
          { key: "responseHash", expected: row.responseHash, kind: "string" },
          { key: "responder", expected: row.responder, kind: "address" },
        ]);
        await prisma.evmFeedbackObservation.update({
          where: { id: row.id },
          data: {
            documentRawBytes: Buffer.from(bytes),
            documentRawDigest: decoded.rawDigest,
            documentCommitmentDigest: decoded.commitmentDigest,
            documentHashValid: hashValidity(expected, decoded.commitmentDigest),
            documentFetchedAt: new Date(),
            documentError: null,
            documentParsed: prismaJson(decoded.parsed),
            documentNormalized: prismaJson(decoded.normalized),
            documentDiagnostics: prismaJson(decoded.diagnostics),
            normalizationEvidence: prismaJson({ ...protocolEvidence(row.normalizationEvidence, "fetched-feedback-document", role), documentConsistency: consistency }),
            decoderVersion: "erc8004-reputation/3.1.0",
          },
        });
        counters.updated += 1;
      } catch (error) {
        counters.failed += 1;
        await prisma.evmFeedbackObservation.update({
          where: { id: row.id },
          data: {
            documentFetchedAt: new Date(),
            documentError: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 2_000),
          },
        });
      }
    }
  }
  return counters;
}
async function hydrateMissingValidationDocuments(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  if (!FETCH_MISSING_DOCUMENTS) return counters;
  let cursor: string | undefined;
  while (withinLimit(counters.scanned)) {
    const take = LIMIT === 0 ? BATCH_SIZE : Math.min(BATCH_SIZE, LIMIT - counters.scanned);
    const rows = await prisma.evmValidationObservation.findMany({
      where: {
        documentRawBytes: null,
        OR: [{ requestUri: { not: null } }, { responseUri: { not: null } }],
      },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        protocolAgentId: true,
        eventType: true,
        validatorAddress: true,
        requestUri: true,
        response: true,
        responseUri: true,
        responseHash: true,
        tag: true,
        requestHash: true,
        normalizationEvidence: true,
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      counters.scanned += 1;
      cursor = row.id;
      const role = validationRole(row.eventType);
      const isResponse = role === "validation-response";
      const uri = isResponse ? row.responseUri : row.requestUri;
      const expected = isResponse ? row.responseHash : row.requestHash;
      if (!uri?.trim()) { counters.skipped += 1; continue; }
      try {
        const bytes = await fetchDocument(uri);
        const decoded = decodeProtocolDocument(bytes, role);
        const consistency = protocolDocumentConsistency(decoded.normalized, [
          { key: "agentId", expected: row.protocolAgentId, kind: "integer" },
          { key: "validatorAddress", expected: row.validatorAddress, kind: "address" },
          { key: "requestHash", expected: row.requestHash, kind: "string" },
          { key: "requestUri", expected: row.requestUri, kind: "uri" },
          { key: "response", expected: row.response, kind: "integer" },
          { key: "responseUri", expected: row.responseUri, kind: "uri" },
          { key: "responseHash", expected: row.responseHash, kind: "string" },
          { key: "tag", expected: row.tag, kind: "string" },
        ]);
        await prisma.evmValidationObservation.update({
          where: { id: row.id },
          data: {
            documentRole: role,
            documentUri: uri,
            documentRawBytes: Buffer.from(bytes),
            documentRawDigest: decoded.rawDigest,
            documentCommitmentDigest: decoded.commitmentDigest,
            documentHashValid: hashValidity(expected, decoded.commitmentDigest),
            documentFetchedAt: new Date(),
            documentError: null,
            documentParsed: prismaJson(decoded.parsed),
            documentNormalized: prismaJson(decoded.normalized),
            documentDiagnostics: prismaJson(decoded.diagnostics),
            normalizationEvidence: prismaJson({ ...protocolEvidence(row.normalizationEvidence, "fetched-validation-document", role), documentConsistency: consistency }),
            decoderVersion: "erc8004-validation/3.1.0",
          },
        });
        counters.updated += 1;
      } catch (error) {
        counters.failed += 1;
        await prisma.evmValidationObservation.update({
          where: { id: row.id },
          data: {
            documentRole: role,
            documentUri: uri,
            documentFetchedAt: new Date(),
            documentError: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 2_000),
          },
        });
      }
    }
  }
  return counters;
}
async function backfillRegistrationDocuments(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let cursor: string | undefined;
  while (withinLimit(counters.scanned)) {
    const take = LIMIT === 0 ? BATCH_SIZE : Math.min(BATCH_SIZE, LIMIT - counters.scanned);
    const rows = await prisma.registrationDocumentObservation.findMany({
      where: { decoderVersion: { not: REGISTRATION_DECODER_VERSION } },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, rawBytes: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      counters.scanned += 1;
      cursor = row.id;
      try {
        const decoded = decodeRegistrationDocument(new Uint8Array(row.rawBytes));
        await prisma.registrationDocumentObservation.update({
          where: { id: row.id },
          data: {
            rawDocumentDigest: decoded.rawDocumentDigest,
            normalizedFingerprint: decoded.normalizedFingerprint,
            parsedCore: prismaJson({
              type: decoded.type,
              name: decoded.name,
              description: decoded.description,
              image: decoded.image,
              services: decoded.services,
              registrations: decoded.registrations,
              declaredActive: decoded.declaredActive,
              declaredX402Support: decoded.declaredX402Support,
              supportedTrust: decoded.supportedTrust,
              truncations: decoded.truncations,
              hadBom: decoded.hadBom,
            }),
            extensions: prismaJson(decoded.extensions),
            decoderVersion: REGISTRATION_DECODER_VERSION,
            schemaValidityStatus: "valid",
            jsonValidityStatus: "valid",
          },
        });
        counters.updated += 1;
      } catch (error) {
        counters.failed += 1;
        logger.warn("onchain intelligence registration document backfill failed", { id: row.id, error: error instanceof Error ? error.message : String(error) }, "sync");
      }
    }
  }
  return counters;
}
async function backfillMetadata(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let cursor: string | undefined;
  while (withinLimit(counters.scanned)) {
    const take = LIMIT === 0 ? BATCH_SIZE : Math.min(BATCH_SIZE, LIMIT - counters.scanned);
    const rows = await prisma.evmIdentityMetadataObservation.findMany({
      where: { OR: [{ decoderVersion: { not: "erc8004-identity/3.2.0" } }, { semanticType: null }, { decodedType: null }] },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, metadataKey: true, rawValue: true, normalizationEvidence: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      counters.scanned += 1;
      cursor = row.id;
      try {
        const decoded = decodeOnchainMetadataValue(row.metadataKey, new Uint8Array(row.rawValue));
        await prisma.evmIdentityMetadataObservation.update({
          where: { id: row.id },
          data: {
            decodedType: decoded.decodedType,
            decodedText: decoded.text,
            decodedAddress: decoded.address,
            decodedBoolean: decoded.boolean,
            decodedInteger: decoded.integer,
            decodedUri: decoded.uri,
            decodedBytes32: decoded.bytes32,
            decodedJson: prismaJson(decoded.json),
            semanticType: decoded.semanticType,
            normalizationEvidence: prismaJson({
              ...decoded.evidence,
              priorEvidence: row.normalizationEvidence ?? null,
              backfilledAt: new Date().toISOString(),
            }),
            decoderVersion: "erc8004-identity/3.2.0",
          },
        });
        counters.updated += 1;
      } catch (error) {
        counters.failed += 1;
        logger.warn("onchain intelligence metadata backfill failed", { id: row.id, key: row.metadataKey, error: error instanceof Error ? error.message : String(error) }, "sync");
      }
    }
  }
  return counters;
}
async function backfillFeedbackDocuments(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let cursor: string | undefined;
  while (withinLimit(counters.scanned)) {
    const take = LIMIT === 0 ? BATCH_SIZE : Math.min(BATCH_SIZE, LIMIT - counters.scanned);
    const rows = await prisma.evmFeedbackObservation.findMany({
      where: { documentRawBytes: { not: null }, OR: [{ documentParsed: { equals: Prisma.AnyNull } }, { decoderVersion: { not: "erc8004-reputation/3.1.0" } }] },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        chainId: true,
        protocolAgentId: true,
        eventType: true,
        clientAddress: true,
        feedbackIndex: true,
        rawValue: true,
        valueDecimals: true,
        tag1: true,
        tag2: true,
        endpoint: true,
        feedbackUri: true,
        responseUri: true,
        responder: true,
        documentRawBytes: true,
        feedbackHash: true,
        responseHash: true,
        normalizationEvidence: true,
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      counters.scanned += 1;
      cursor = row.id;
      if (!row.documentRawBytes) { counters.skipped += 1; continue; }
      try {
        const role = feedbackRole(row.eventType);
        const decoded = decodeProtocolDocument(new Uint8Array(row.documentRawBytes), role);
        const expected = role === "feedback-response" ? row.responseHash : row.feedbackHash;
        const chain = getChainByChainId(row.chainId);
        const consistency = protocolDocumentConsistency(decoded.normalized, [
          { key: "agentRegistry", expected: chain?.identityRegistry ? `eip155:${row.chainId}:${canonicalEvmAddress(chain.identityRegistry)}` : null, kind: "registry" },
          { key: "agentId", expected: row.protocolAgentId, kind: "integer" },
          { key: "clientAddress", expected: row.clientAddress, kind: "address" },
          { key: "feedbackIndex", expected: row.feedbackIndex, kind: "integer" },
          { key: "value", expected: row.rawValue, kind: "integer" },
          { key: "valueDecimals", expected: row.valueDecimals, kind: "integer" },
          { key: "tag1", expected: row.tag1, kind: "string" },
          { key: "tag2", expected: row.tag2, kind: "string" },
          { key: "endpoint", expected: row.endpoint, kind: "uri" },
          { key: "responseUri", expected: row.responseUri, kind: "uri" },
          { key: "responseHash", expected: row.responseHash, kind: "string" },
          { key: "responder", expected: row.responder, kind: "address" },
        ]);
        await prisma.evmFeedbackObservation.update({
          where: { id: row.id },
          data: {
            documentRawDigest: decoded.rawDigest,
            documentCommitmentDigest: decoded.commitmentDigest,
            documentHashValid: hashValidity(expected, decoded.commitmentDigest),
            documentParsed: prismaJson(decoded.parsed),
            documentNormalized: prismaJson(decoded.normalized),
            documentDiagnostics: prismaJson(decoded.diagnostics),
            normalizationEvidence: prismaJson({ ...protocolEvidence(row.normalizationEvidence, "stored-feedback-document", role), documentConsistency: consistency }),
            decoderVersion: "erc8004-reputation/3.1.0",
          },
        });
        counters.updated += 1;
      } catch (error) {
        counters.failed += 1;
        logger.warn("onchain intelligence feedback backfill failed", { id: row.id, error: error instanceof Error ? error.message : String(error) }, "sync");
      }
    }
  }
  return counters;
}
async function backfillValidationDocuments(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let cursor: string | undefined;
  while (withinLimit(counters.scanned)) {
    const take = LIMIT === 0 ? BATCH_SIZE : Math.min(BATCH_SIZE, LIMIT - counters.scanned);
    const rows = await prisma.evmValidationObservation.findMany({
      where: { documentRawBytes: { not: null }, OR: [{ documentParsed: { equals: Prisma.AnyNull } }, { decoderVersion: { not: "erc8004-validation/3.1.0" } }] },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        protocolAgentId: true,
        eventType: true,
        validatorAddress: true,
        requestUri: true,
        response: true,
        responseUri: true,
        responseHash: true,
        tag: true,
        requestHash: true,
        documentRawBytes: true,
        normalizationEvidence: true,
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      counters.scanned += 1;
      cursor = row.id;
      if (!row.documentRawBytes) { counters.skipped += 1; continue; }
      try {
        const role = validationRole(row.eventType);
        const decoded = decodeProtocolDocument(new Uint8Array(row.documentRawBytes), role);
        const isResponse = role === "validation-response";
        const expected = isResponse ? row.responseHash : row.requestHash;
        const consistency = protocolDocumentConsistency(decoded.normalized, [
          { key: "agentId", expected: row.protocolAgentId, kind: "integer" },
          { key: "validatorAddress", expected: row.validatorAddress, kind: "address" },
          { key: "requestHash", expected: row.requestHash, kind: "string" },
          { key: "requestUri", expected: row.requestUri, kind: "uri" },
          { key: "response", expected: row.response, kind: "integer" },
          { key: "responseUri", expected: row.responseUri, kind: "uri" },
          { key: "responseHash", expected: row.responseHash, kind: "string" },
          { key: "tag", expected: row.tag, kind: "string" },
        ]);
        await prisma.evmValidationObservation.update({
          where: { id: row.id },
          data: {
            documentRole: role,
            documentUri: isResponse ? row.responseUri : row.requestUri,
            documentRawDigest: decoded.rawDigest,
            documentCommitmentDigest: decoded.commitmentDigest,
            documentHashValid: hashValidity(expected, decoded.commitmentDigest),
            documentParsed: prismaJson(decoded.parsed),
            documentNormalized: prismaJson(decoded.normalized),
            documentDiagnostics: prismaJson(decoded.diagnostics),
            normalizationEvidence: prismaJson({ ...protocolEvidence(row.normalizationEvidence, "stored-validation-document", role), documentConsistency: consistency }),
            decoderVersion: "erc8004-validation/3.1.0",
          },
        });
        counters.updated += 1;
      } catch (error) {
        counters.failed += 1;
        logger.warn("onchain intelligence validation backfill failed", { id: row.id, error: error instanceof Error ? error.message : String(error) }, "sync");
      }
    }
  }
  return counters;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function instructionArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(record(item))) : [];
}
function decodeStoredInstruction(item: Record<string, unknown>): Record<string, unknown> {
  const programId = typeof item.programId === "string" ? item.programId : null;
  const accounts = Array.isArray(item.accounts)
    ? item.accounts.map((value) => typeof value === "string" ? value : null)
    : [];
  const decoded = decodeSolanaAgentInstruction({ programId, accounts, data: item.data, parsed: item.parsed });
  return { ...item, decoded };
}
async function backfillSolanaInstructions(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let cursor: string | undefined;
  while (withinLimit(counters.scanned)) {
    const take = LIMIT === 0 ? BATCH_SIZE : Math.min(BATCH_SIZE, LIMIT - counters.scanned);
    const rows = await prisma.solanaTransactionObservation.findMany({
      where: {
        OR: [
          { instructionDecoderVersion: { not: SOLANA_AGENT_INSTRUCTION_DECODER_VERSION } },
          { decodedInstructions: { equals: Prisma.AnyNull } },
        ],
      },
      orderBy: { signature: "asc" },
      take,
      ...(cursor ? { cursor: { signature: cursor }, skip: 1 } : {}),
      select: { signature: true, outerInstructions: true, innerInstructions: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      counters.scanned += 1;
      cursor = row.signature;
      try {
        const outer = instructionArray(row.outerInstructions).map(decodeStoredInstruction);
        const inner = instructionArray(row.innerInstructions).map(decodeStoredInstruction);
        if (outer.length === 0 && inner.length === 0) { counters.skipped += 1; continue; }
        await prisma.solanaTransactionObservation.update({
          where: { signature: row.signature },
          data: {
            outerInstructions: prismaJson(outer),
            innerInstructions: prismaJson(inner),
            decodedInstructions: prismaJson(summarizeDecodedSolanaInstructions(outer, inner)),
            instructionDecoderVersion: SOLANA_AGENT_INSTRUCTION_DECODER_VERSION,
          },
        });
        counters.updated += 1;
      } catch (error) {
        counters.failed += 1;
        logger.warn("onchain intelligence Solana instruction backfill failed", { signature: row.signature, error: error instanceof Error ? error.message : String(error) }, "sync");
      }
    }
  }
  return counters;
}
function serviceIdentity(value: Record<string, unknown>): string {
  const name = String(value.normalizedType ?? value.sourceName ?? value.name ?? "").toLowerCase();
  const endpoint = String(value.normalizedEndpoint ?? value.sourceEndpoint ?? value.endpoint ?? "");
  const version = String(value.sourceVersion ?? value.version ?? "");
  return `${name}\0${endpoint}\0${version}`;
}
function inferredServiceSourceKind(input: {
  sourceKind: string | null;
  listingRegistrySource: string | null;
  sapVerified: boolean;
  metaplexVerified: boolean;
}): string {
  if (input.sourceKind?.trim()) return input.sourceKind.trim();
  const listing = input.listingRegistrySource?.trim().toLowerCase() ?? "";
  if (input.sapVerified || listing.includes("sap") || listing.includes("synapse")) return "sap";
  if (input.metaplexVerified || listing.includes("metaplex")) return "metaplex-registration";
  return "application";
}
async function normalizeStoredServices(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let cursor: number | undefined;
  while (withinLimit(counters.scanned)) {
    const take = LIMIT === 0 ? BATCH_SIZE : Math.min(BATCH_SIZE, LIMIT - counters.scanned);
    const rows = await prisma.agentService.findMany({
      where: {
        OR: [
          { sourceName: null },
          { normalizedType: null },
          { sourceEndpoint: null },
          { endpointKind: null },
          { endpointValid: null },
          { sourceKind: null },
        ],
      },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        endpoint: true,
        version: true,
        sourceName: true,
        normalizedType: true,
        sourceEndpoint: true,
        endpointKind: true,
        endpointValid: true,
        sourceVersion: true,
        sourceDigest: true,
        sourceKind: true,
        skills: true,
        domains: true,
        capabilities: true,
        extensions: true,
        agent: {
          select: {
            listingRegistrySource: true,
            sapVerified: true,
            metaplexVerified: true,
          },
        },
      },
    });
    if (rows.length === 0) break;
    const updates: AgentServiceUpdate[] = [];
    for (const row of rows) {
      counters.scanned += 1;
      cursor = row.id;
      try {
        const sourceKind = inferredServiceSourceKind({
          sourceKind: row.sourceKind,
          listingRegistrySource: row.agent.listingRegistrySource,
          sapVerified: row.agent.sapVerified,
          metaplexVerified: row.agent.metaplexVerified,
        });
        const normalized = normalizedAgentServiceData({
          name: row.sourceName?.trim() || row.name,
          endpoint: row.sourceEndpoint?.trim() || row.endpoint,
          version: row.sourceVersion?.trim() || row.version,
          skills: stringArray(row.skills),
          domains: stringArray(row.domains),
          capabilities: stringArray(row.capabilities),
          extensions: record(row.extensions),
        }, { sourceKind, sourceDigest: row.sourceDigest });
        updates.push({
          id: row.id,
          data: normalized,
        });
      } catch (error) {
        counters.failed += 1;
        logger.warn("stored agent service normalization failed", { serviceId: row.id, error: error instanceof Error ? error.message : String(error) }, "sync");
      }
    }
    if (updates.length > 0) {
      try {
        await prisma.$transaction((tx) => updateAgentServicesInBulk(tx, updates));
        counters.updated += updates.length;
      } catch (error) {
        counters.failed += updates.length;
        logger.warn("stored agent service normalization batch failed", {
          count: updates.length,
          error: error instanceof Error ? error.message : String(error),
        }, "sync");
      }
    }
  }
  return counters;
}
async function enrichRegistrationServiceSemantics(): Promise<Counters> {
  const counters: Counters = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let cursor: number | undefined;
  while (withinLimit(counters.scanned)) {
    const take = LIMIT === 0 ? BATCH_SIZE : Math.min(BATCH_SIZE, LIMIT - counters.scanned);
    const agents = await prisma.agent.findMany({
      where: { agentURI: { not: "" }, services: { some: { sourceKind: "registration" } } },
      orderBy: { id: "asc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        agentURI: true,
        registrationNormalizedUri: true,
        services: {
          where: { sourceKind: "registration" },
          select: {
            id: true,
            name: true,
            endpoint: true,
            version: true,
            sourceName: true,
            normalizedType: true,
            sourceEndpoint: true,
            endpointKind: true,
            endpointValid: true,
            sourceVersion: true,
            sourceDigest: true,
            sourceKind: true,
            skills: true,
            domains: true,
            capabilities: true,
            extensions: true,
          },
        },
      },
    });
    if (agents.length === 0) break;
    const normalizedUris = [...new Set(agents.flatMap((agent) =>
      agent.registrationNormalizedUri ? [agent.registrationNormalizedUri] : [],
    ))];
    const sourceUris = [...new Set(agents.map((agent) => agent.agentURI).filter(Boolean))];
    type RegistrationDocumentLookup = {
      normalizedUri: string;
      sourceUri: string;
      fetchedAt: Date;
      parsedCore: unknown;
    };
    const latestDocumentQueries: Prisma.Sql[] = [];
    if (normalizedUris.length > 0) {
      latestDocumentQueries.push(Prisma.sql`(
        SELECT DISTINCT ON (observation.normalized_uri)
          observation.normalized_uri AS "normalizedUri",
          observation.source_uri AS "sourceUri",
          observation.fetched_at AS "fetchedAt",
          observation.parsed_core AS "parsedCore"
        FROM registration_document_observations AS observation
        WHERE observation.normalized_uri IN (${Prisma.join(normalizedUris)})
        ORDER BY observation.normalized_uri, observation.fetched_at DESC
      )`);
    }
    if (sourceUris.length > 0) {
      latestDocumentQueries.push(Prisma.sql`(
        SELECT DISTINCT ON (observation.source_uri)
          observation.normalized_uri AS "normalizedUri",
          observation.source_uri AS "sourceUri",
          observation.fetched_at AS "fetchedAt",
          observation.parsed_core AS "parsedCore"
        FROM registration_document_observations AS observation
        WHERE observation.source_uri IN (${Prisma.join(sourceUris)})
        ORDER BY observation.source_uri, observation.fetched_at DESC
      )`);
    }
    const documents = latestDocumentQueries.length === 0
      ? []
      : await prisma.$queryRaw<RegistrationDocumentLookup[]>(
          Prisma.join(latestDocumentQueries, " UNION ALL "),
        );
    const documentByNormalizedUri = new Map<string, (typeof documents)[number]>();
    const documentBySourceUri = new Map<string, (typeof documents)[number]>();
    for (const document of documents) {
      const normalizedDocument = documentByNormalizedUri.get(document.normalizedUri);
      if (!normalizedDocument || document.fetchedAt > normalizedDocument.fetchedAt) {
        documentByNormalizedUri.set(document.normalizedUri, document);
      }
      const sourceDocument = documentBySourceUri.get(document.sourceUri);
      if (!sourceDocument || document.fetchedAt > sourceDocument.fetchedAt) {
        documentBySourceUri.set(document.sourceUri, document);
      }
    }
    const updates: AgentServiceUpdate[] = [];
    for (const agent of agents) {
      counters.scanned += 1;
      cursor = agent.id;
      try {
        const candidates = [
          agent.registrationNormalizedUri
            ? documentByNormalizedUri.get(agent.registrationNormalizedUri)
            : undefined,
          documentBySourceUri.get(agent.agentURI),
        ].filter((document): document is (typeof documents)[number] => document != null);
        const document = candidates.reduce<(typeof documents)[number] | null>(
          (latest, candidate) => !latest || candidate.fetchedAt > latest.fetchedAt ? candidate : latest,
          null,
        );
        const core = record(document?.parsedCore);
        const decodedServices = Array.isArray(core?.services)
          ? core.services.map(record).filter((item): item is Record<string, unknown> => item != null)
          : [];
        if (decodedServices.length === 0) { counters.skipped += 1; continue; }
        const byIdentity = new Map(decodedServices.map((service) => [serviceIdentity(service), service]));
        let changed = 0;
        for (const service of agent.services) {
          const source = byIdentity.get(serviceIdentity(service as unknown as Record<string, unknown>));
          if (!source) continue;
          updates.push({
            id: service.id,
            data: {
              name: service.name,
              endpoint: service.endpoint,
              version: service.version,
              sourceName: service.sourceName,
              normalizedType: service.normalizedType,
              sourceEndpoint: service.sourceEndpoint,
              endpointKind: service.endpointKind,
              endpointValid: service.endpointValid,
              sourceVersion: service.sourceVersion,
              sourceDigest: service.sourceDigest,
              sourceKind: service.sourceKind,
              skills: source.skills ?? [],
              domains: source.domains ?? [],
              capabilities: source.capabilities ?? [],
              extensions: prismaJson(source.extensions ?? {}),
            },
          });
          changed += 1;
        }
        if (changed > 0) counters.updated += changed;
        else counters.skipped += 1;
      } catch (error) {
        counters.failed += 1;
        logger.warn("registration service enrichment failed", { agentId: agent.id, error: error instanceof Error ? error.message : String(error) }, "sync");
      }
    }
    if (updates.length > 0) {
      try {
        await prisma.$transaction((tx) => updateAgentServicesInBulk(tx, updates));
      } catch (error) {
        counters.failed += updates.length;
        counters.updated -= updates.length;
        logger.warn("registration service enrichment batch failed", {
          count: updates.length,
          error: error instanceof Error ? error.message : String(error),
        }, "sync");
      }
    }
  }
  return counters;
}
async function backfillServiceSemantics(): Promise<Counters> {
  if (!INCLUDE_SERVICES) return { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  const normalized = await normalizeStoredServices();
  const enriched = await enrichRegistrationServiceSemantics();
  return {
    scanned: normalized.scanned + enriched.scanned,
    updated: normalized.updated + enriched.updated,
    skipped: normalized.skipped + enriched.skipped,
    failed: normalized.failed + enriched.failed,
  };
}
async function main(): Promise<void> {
  logger.info("onchain intelligence backfill started", {
    batchSize: BATCH_SIZE,
    limitPerStage: LIMIT === 0 ? null : LIMIT,
    decoderVersion: ONCHAIN_VALUE_DECODER_VERSION,
    includeServices: INCLUDE_SERVICES,
    fetchMissingDocuments: FETCH_MISSING_DOCUMENTS,
  }, "sync");
  const result = {
    registrationDocuments: await backfillRegistrationDocuments(),
    metadata: await backfillMetadata(),
    hydratedFeedbackDocuments: await hydrateMissingFeedbackDocuments(),
    feedbackDocuments: await backfillFeedbackDocuments(),
    hydratedValidationDocuments: await hydrateMissingValidationDocuments(),
    validationDocuments: await backfillValidationDocuments(),
    solanaInstructions: await backfillSolanaInstructions(),
    serviceSemantics: await backfillServiceSemantics(),
  };
  logger.info("onchain intelligence backfill completed", result, "sync");
}
void main()
  .catch((error) => {
    logger.error("onchain intelligence backfill failed", { error: error instanceof Error ? error.message : String(error) }, "sync");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
