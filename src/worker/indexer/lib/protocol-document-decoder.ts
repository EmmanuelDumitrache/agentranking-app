import { createHash } from "node:crypto";
import { bytesToHex, keccak256 } from "viem";
import { decodeJsonBytes, isLosslessObject, losslessToJsonSafe } from "./lossless-json.js";

export const PROTOCOL_DOCUMENT_DECODER_VERSION = "agent-protocol-document/3";

export type ProtocolDocumentRole =
  | "feedback"
  | "feedback-response"
  | "validation-request"
  | "validation-response";

export type DecodedProtocolDocument = {
  rawDigest: string;
  commitmentDigest: string;
  parsed: unknown | null;
  normalized: Record<string, unknown> | null;
  diagnostics: Record<string, unknown>;
};

function stringField(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return null;
}
function scalarField(value: Record<string, unknown>, ...keys: string[]): unknown | null {
  for (const key of keys) {
    const item = value[key];
    if (item == null) continue;
    if (typeof item === "object" && !Array.isArray(item) && "$number" in item) {
      const token = (item as { $number?: unknown }).$number;
      if (typeof token === "string") return token;
    }
    if (["string", "number", "boolean"].includes(typeof item)) return item;
  }
  return null;
}
function objectField(value: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const item = value[key];
    if (item && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
  }
  return null;
}
function arrayField(value: Record<string, unknown>, ...keys: string[]): unknown[] | null {
  for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[];
  return null;
}
function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null));
}
function unknownFields(value: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> | null {
  const entries = Object.entries(value).filter(([key]) => !known.has(key));
  return entries.length === 0 ? null : Object.fromEntries(entries);
}

const COMMON_FIELDS = new Set([
  "agentRegistry", "agent_registry", "agentId", "agent_id", "clientAddress", "client_address", "client",
  "validatorAddress", "validator_address", "validator", "createdAt", "created_at", "updatedAt", "updated_at", "timestamp",
  "endpoint", "value", "valueDecimals", "value_decimals", "feedbackIndex", "feedback_index", "tag", "tag1", "tag2", "response", "score",
  "requestHash", "request_hash", "requestURI", "requestUri", "request_uri", "responseHash", "response_hash", "responseURI", "responseUri", "response_uri",
  "responder", "method", "validationMethod", "validation_method", "model", "modelHash", "model_hash", "inputHash", "input_hash", "outputHash", "output_hash",
  "proof", "attestation", "verifier", "confidence", "metrics",
  "mcp", "a2a", "oasf", "proofOfPayment", "proof_of_payment", "extensions", "skills", "domains",
  "request", "result", "evidence", "reason", "message", "status", "context", "input", "output", "artifacts",
]);

function normalizeMcp(object: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!object) return null;
  return compact({
    tool: stringField(object, "tool", "toolName", "tool_name"),
    prompt: stringField(object, "prompt", "promptName", "prompt_name"),
    resource: stringField(object, "resource", "resourceUri", "resource_uri"),
    server: stringField(object, "server", "serverName", "server_name"),
    arguments: object.arguments ?? object.params ?? null,
    result: object.result ?? null,
    extensions: unknownFields(object, new Set(["tool", "toolName", "tool_name", "prompt", "promptName", "prompt_name", "resource", "resourceUri", "resource_uri", "server", "serverName", "server_name", "arguments", "params", "result"])),
  });
}
function normalizeA2a(object: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!object) return null;
  return compact({
    skills: arrayField(object, "skills", "skillIds", "skill_ids"),
    contextId: stringField(object, "contextId", "context_id"),
    taskId: stringField(object, "taskId", "task_id"),
    messageId: stringField(object, "messageId", "message_id"),
    status: scalarField(object, "status"),
    artifacts: object.artifacts ?? null,
    extensions: unknownFields(object, new Set(["skills", "skillIds", "skill_ids", "contextId", "context_id", "taskId", "task_id", "messageId", "message_id", "status", "artifacts"])),
  });
}
function normalizeOasf(object: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!object) return null;
  return compact({
    skills: arrayField(object, "skills", "skillIds", "skill_ids"),
    domains: arrayField(object, "domains", "domainIds", "domain_ids"),
    version: stringField(object, "version"),
    extensions: unknownFields(object, new Set(["skills", "skillIds", "skill_ids", "domains", "domainIds", "domain_ids", "version"])),
  });
}
function normalizePayment(object: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!object) return null;
  return compact({
    fromAddress: stringField(object, "fromAddress", "from_address", "from"),
    toAddress: stringField(object, "toAddress", "to_address", "to"),
    chainId: scalarField(object, "chainId", "chain_id"),
    transactionHash: stringField(object, "txHash", "transactionHash", "transaction_hash"),
    amount: scalarField(object, "amount", "value"),
    asset: stringField(object, "asset", "token", "currency"),
    extensions: unknownFields(object, new Set(["fromAddress", "from_address", "from", "toAddress", "to_address", "to", "chainId", "chain_id", "txHash", "transactionHash", "transaction_hash", "amount", "value", "asset", "token", "currency"])),
  });
}

function requiredFields(role: ProtocolDocumentRole): readonly string[] {
  if (role === "feedback") return ["agentRegistry", "agentId", "clientAddress", "createdAt", "value", "valueDecimals"];
  if (role === "validation-request") return [];
  return [];
}

export function decodeProtocolDocument(bytes: Uint8Array, role: ProtocolDocumentRole): DecodedProtocolDocument {
  const rawDigest = createHash("sha256").update(bytes).digest("hex");
  const commitmentDigest = keccak256(bytesToHex(bytes));
  const diagnostics: Record<string, unknown> = {
    decoderVersion: PROTOCOL_DOCUMENT_DECODER_VERSION,
    role,
    byteLength: bytes.byteLength,
  };
  try {
    const lossless = decodeJsonBytes(bytes).value;
    const parsed = losslessToJsonSafe(lossless);
    if (!isLosslessObject(lossless) || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        rawDigest,
        commitmentDigest,
        parsed,
        normalized: null,
        diagnostics: { ...diagnostics, rootType: Array.isArray(parsed) ? "array" : typeof parsed },
      };
    }
    const object = parsed as Record<string, unknown>;
    const normalized = compact({
      role,
      agentRegistry: stringField(object, "agentRegistry", "agent_registry"),
      agentId: scalarField(object, "agentId", "agent_id"),
      clientAddress: stringField(object, "clientAddress", "client_address", "client"),
      validatorAddress: stringField(object, "validatorAddress", "validator_address", "validator"),
      createdAt: stringField(object, "createdAt", "created_at", "timestamp"),
      updatedAt: stringField(object, "updatedAt", "updated_at"),
      endpoint: stringField(object, "endpoint"),
      feedbackIndex: scalarField(object, "feedbackIndex", "feedback_index"),
      value: scalarField(object, "value"),
      valueDecimals: scalarField(object, "valueDecimals", "value_decimals"),
      tag: stringField(object, "tag"),
      tag1: stringField(object, "tag1"),
      tag2: stringField(object, "tag2"),
      response: scalarField(object, "response", "score"),
      requestHash: stringField(object, "requestHash", "request_hash"),
      requestUri: stringField(object, "requestURI", "requestUri", "request_uri"),
      responseHash: stringField(object, "responseHash", "response_hash"),
      responseUri: stringField(object, "responseURI", "responseUri", "response_uri"),
      responder: stringField(object, "responder"),
      status: scalarField(object, "status"),
      reason: stringField(object, "reason", "message"),
      validationMethod: stringField(object, "validationMethod", "validation_method", "method"),
      model: stringField(object, "model"),
      modelHash: stringField(object, "modelHash", "model_hash"),
      inputHash: stringField(object, "inputHash", "input_hash"),
      outputHash: stringField(object, "outputHash", "output_hash"),
      proof: object.proof ?? null,
      attestation: object.attestation ?? null,
      verifier: object.verifier ?? null,
      confidence: scalarField(object, "confidence"),
      metrics: object.metrics ?? null,
      mcp: normalizeMcp(objectField(object, "mcp")),
      a2a: normalizeA2a(objectField(object, "a2a")),
      oasf: normalizeOasf(objectField(object, "oasf")),
      proofOfPayment: normalizePayment(objectField(object, "proofOfPayment", "proof_of_payment")),
      request: object.request ?? object.input ?? null,
      result: object.result ?? object.output ?? null,
      evidence: object.evidence ?? null,
      artifacts: object.artifacts ?? null,
      context: object.context ?? null,
      skills: arrayField(object, "skills"),
      domains: arrayField(object, "domains"),
      declaredExtensions: object.extensions ?? null,
      extraFields: unknownFields(object, COMMON_FIELDS),
    });
    const required = requiredFields(role);
    const missingRequiredFields = required.filter((key) => normalized[key] == null);
    return {
      rawDigest,
      commitmentDigest,
      parsed,
      normalized,
      diagnostics: {
        ...diagnostics,
        normalizedFieldCount: Object.keys(normalized).length,
        missingRequiredFields,
        schemaStatus: missingRequiredFields.length === 0 ? "compatible" : "incomplete",
      },
    };
  } catch (error) {
    return {
      rawDigest,
      commitmentDigest,
      parsed: null,
      normalized: null,
      diagnostics: {
        ...diagnostics,
        jsonError: error instanceof Error ? error.message : String(error),
        schemaStatus: "invalid-json",
      },
    };
  }
}
