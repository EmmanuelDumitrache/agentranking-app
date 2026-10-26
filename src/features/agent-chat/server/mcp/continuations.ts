import "server-only";

import { randomUUID } from "node:crypto";
import {
  fromJsonSchema,
  isInputRequiredResult,
} from "@modelcontextprotocol/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
} from "@/lib/secret-envelope";
import { validateMcpJsonSchema } from "./catalog-validation";
import { validatePublicMcpOAuthUrl } from "./endpoint-policy";
import { McpConfigurationError, McpRuntimeError } from "./errors";
import { schemaRequestsWalletSecret } from "./risk";
import type {
  McpConnectionRecord,
  McpInputRequiredToolResult,
  McpJsonSchema,
  McpToolDefinition,
} from "./types";

const CONTINUATION_TTL_MS = 30 * 60_000;
const MAX_CONTINUATION_BYTES = 512 * 1024;
const MAX_INPUT_REQUESTS_BYTES = 56 * 1024;
const MAX_REQUEST_KEY_CHARS = 1_024;
const MAX_REQUEST_METHOD_CHARS = 256;
const MAX_ROUNDS = 8;
const SECRET_NAMESPACE = "mcp-continuation";

export type McpContinuationMethod = "tools/call" | "resources/read" | "prompts/get";

export type McpContinuationResponse = {
  requestKey: string;
  action: "accept" | "decline" | "cancel";
  content?: Record<
    string,
    string | number | boolean | string[] | number[] | boolean[]
  >;
};

type ContinuationPayload = {
  method: McpContinuationMethod;
  params: Record<string, unknown>;
  /** Exact original definition used for MCP tools/call structured-output validation. */
  toolDefinition?: McpToolDefinition;
  requestState?: string;
  inputRequests: Record<string, unknown>;
  source?: Record<string, unknown>;
};

type ContinuationRecord = {
  id: string;
  appAccountId: string;
  agentDbId: number;
  bindingId: string;
  connectionId: string;
  method: string;
  encryptedRequest: string;
  encryptionKeyId: string;
  encryptionVersion: number;
  inputRequestsJson: unknown;
  fingerprint: string;
  rounds: number;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type ClaimedMcpContinuation = {
  record: ContinuationRecord;
  payload: ContinuationPayload;
  responses: Record<string, unknown>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function serialized(value: unknown, label: string, maxBytes: number): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new McpConfigurationError(`MCP ${label} is not JSON serializable`, { cause: error });
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new McpConfigurationError(`MCP ${label} exceeds the ${maxBytes}-byte continuation limit`);
  }
  return text;
}

function continuationContext(
  id: string,
  appAccountId: string,
  connectionId: string,
  bindingId: string,
): readonly string[] {
  return [id, appAccountId, connectionId, bindingId];
}

function inputRequestsFromResult(value: unknown): Record<string, unknown> {
  if (!isInputRequiredResult(value)) return {};
  return isObject(value.inputRequests) ? value.inputRequests : {};
}

function requestMethod(request: unknown): string {
  return isObject(request) && typeof request.method === "string"
    ? request.method
    : "unknown";
}

function safeElicitationMessage(value: unknown): string {
  if (typeof value !== "string") return "The MCP server requires additional input.";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .slice(0, 8_000)
    || "The MCP server requires additional input.";
}

function schemaRequestsCredential(schema: unknown): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(schema);
  } catch {
    return true;
  }
  return schemaRequestsWalletSecret(schema)
    || /(?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization|bearer[_ -]?token|card[_ -]?number|cvv|cvc)/i.test(serialized);
}

function elicitationDescriptor(
  requestKey: string,
  request: unknown,
): McpInputRequiredToolResult["requests"][number] | null {
  if (requestKey.length === 0 || requestKey.length > MAX_REQUEST_KEY_CHARS) return null;
  if (!isObject(request) || request.method !== "elicitation/create") return null;
  const params = isObject(request.params) ? request.params : {};
  const mode = params.mode;
  const message = safeElicitationMessage(params.message);
  if (mode === "url") {
    if (typeof params.url !== "string") return null;
    try {
      const url = validatePublicMcpOAuthUrl({
        url: params.url,
        label: "MCP elicitation",
      });
      return {
        requestKey,
        type: "elicitation",
        mode: "url",
        message,
        url: url.url,
      };
    } catch {
      return null;
    }
  }
  if (mode === "form") {
    const requestedSchema = isObject(params.requestedSchema)
      ? params.requestedSchema as McpJsonSchema
      : null;
    if (!requestedSchema || schemaRequestsCredential(requestedSchema)) return null;
    let validatedSchema: McpJsonSchema;
    try {
      validatedSchema = validateMcpJsonSchema(
        requestedSchema,
        "MCP elicitation requested schema",
      );
    } catch {
      return null;
    }
    return {
      requestKey,
      type: "elicitation",
      mode: "form",
      message,
      requestedSchema: validatedSchema,
    };
  }
  return null;
}

function uiRequests(
  inputRequests: Record<string, unknown>,
): {
  supported: McpInputRequiredToolResult["requests"];
  unsupported: Array<{ requestKey: string; method: string }>;
} {
  const supported: McpInputRequiredToolResult["requests"] = [];
  const unsupported: Array<{ requestKey: string; method: string }> = [];
  for (const [requestKey, request] of Object.entries(inputRequests)) {
    const descriptor = elicitationDescriptor(requestKey, request);
    if (descriptor) supported.push(descriptor);
    else unsupported.push({
      requestKey: requestKey.slice(0, MAX_REQUEST_KEY_CHARS),
      method: requestMethod(request).slice(0, MAX_REQUEST_METHOD_CHARS),
    });
  }
  return { supported, unsupported };
}

function continuationResult(params: {
  id: string;
  connection: McpConnectionRecord;
  method: McpContinuationMethod;
  inputRequests: Record<string, unknown>;
  source?: Record<string, unknown>;
}): McpInputRequiredToolResult | Record<string, unknown> {
  const requests = uiRequests(params.inputRequests);
  if (requests.unsupported.length > 0) {
    return {
      ok: false,
      status: "unsupported_input_required",
      source: {
        kind: "mcp",
        connectionId: params.connection.id,
        ...(params.source ?? {}),
        serverName: typeof params.source?.serverName === "string"
          ? params.source.serverName
          : params.connection.displayName,
        operation: params.method,
      },
      untrustedExternalData: true,
      unsupportedRequests: requests.unsupported,
      message: "The MCP server requested a client capability that AgentRanking does not support.",
    };
  }
  return {
    ok: false,
    status: "input_required",
    continuationId: params.id,
    source: {
      kind: "mcp",
      connectionId: params.connection.id,
      ...(params.source ?? {}),
      serverName: typeof params.source?.serverName === "string"
        ? params.source.serverName
        : params.connection.displayName,
      operation: params.method,
    },
    requests: requests.supported,
  };
}

function decryptPayload(row: ContinuationRecord): ContinuationPayload {
  const plaintext = decryptSecret(
    row.encryptedRequest,
    row.encryptionKeyId,
    row.encryptionVersion,
    {
      namespace: SECRET_NAMESPACE,
      context: continuationContext(row.id, row.appAccountId, row.connectionId, row.bindingId),
    },
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch (error) {
    throw new McpConfigurationError("Stored MCP continuation payload is invalid", { cause: error });
  }
  if (!isObject(parsed)) throw new McpConfigurationError("Stored MCP continuation payload is invalid");
  const method = parsed.method;
  if (method !== "tools/call" && method !== "resources/read" && method !== "prompts/get") {
    throw new McpConfigurationError("Stored MCP continuation method is invalid");
  }
  if (!isObject(parsed.params) || !isObject(parsed.inputRequests)) {
    throw new McpConfigurationError("Stored MCP continuation request is invalid");
  }
  const toolDefinition =
    method === "tools/call"
    && isObject(parsed.toolDefinition)
    && typeof parsed.toolDefinition.name === "string"
    && isObject(parsed.toolDefinition.inputSchema)
      ? parsed.toolDefinition as McpToolDefinition
      : undefined;
  if (
    toolDefinition
    && typeof parsed.params.name === "string"
    && toolDefinition.name !== parsed.params.name
  ) {
    throw new McpConfigurationError("Stored MCP continuation tool definition does not match its request");
  }
  return {
    method,
    params: parsed.params,
    inputRequests: parsed.inputRequests,
    ...(isObject(parsed.source) ? { source: parsed.source } : {}),
    ...(toolDefinition ? { toolDefinition } : {}),
    ...(typeof parsed.requestState === "string" ? { requestState: parsed.requestState } : {}),
  };
}

async function persistPayload(params: {
  id: string;
  connection: McpConnectionRecord;
  method: McpContinuationMethod;
  requestParams: Record<string, unknown>;
  inputRequests: Record<string, unknown>;
  toolDefinition?: McpToolDefinition;
  requestState?: string;
  rounds: number;
  expiresAt: Date;
  rearm: boolean;
  expectedFingerprint?: string;
  agentDbId: number;
  bindingId: string;
  source?: Record<string, unknown>;
}): Promise<void> {
  const payload: ContinuationPayload = {
    method: params.method,
    params: params.requestParams,
    inputRequests: params.inputRequests,
    ...(params.source ? { source: params.source } : {}),
    ...(params.toolDefinition ? { toolDefinition: params.toolDefinition } : {}),
    ...(params.requestState !== undefined ? { requestState: params.requestState } : {}),
  };
  const plaintext = serialized(payload, "continuation payload", MAX_CONTINUATION_BYTES);
  const cipher = encryptSecret(plaintext, {
    namespace: SECRET_NAMESPACE,
    context: continuationContext(
      params.id,
      params.connection.appAccountId,
      params.connection.id,
      params.bindingId,
    ),
  });
  const descriptors = uiRequests(params.inputRequests).supported;
  // Elicitation descriptors are returned directly as a model tool result rather
  // than through the generic MCP result normalizer. Reject oversized schemas
  // instead of truncating them so the UI receives an exact schema while the
  // public descriptor remains below the normal 64 KiB model-facing envelope.
  serialized(descriptors, "input requests", MAX_INPUT_REQUESTS_BYTES);
  const data = {
    method: params.method,
    encryptedRequest: cipher.encryptedSecret,
    encryptionKeyId: cipher.encryptionKeyId,
    encryptionVersion: cipher.encryptionVersion,
    fingerprint: fingerprintSecret(SECRET_NAMESPACE, plaintext),
    inputRequestsJson: jsonInput(descriptors),
    rounds: params.rounds,
    expiresAt: params.expiresAt,
  };
  await prisma.$transaction(async (tx) => {
    // Connection configuration/deletion and binding enablement take these
    // lifecycle locks in the same order. This closes the race where an in-flight
    // provider response could recreate a capability immediately after disable.
    const connectionAuthority = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT connection."id"
      FROM "agent_mcp_connections" connection
      WHERE connection."id" = ${params.connection.id}
        AND connection."app_account_id" = ${params.connection.appAccountId}
        AND connection."deleted_at" IS NULL
        AND connection."status" IN ('READY', 'DEGRADED')
      FOR UPDATE OF connection
    `);
    if (connectionAuthority.length !== 1) {
      throw new McpRuntimeError(
        "MCP_POLICY_BLOCKED",
        "MCP continuation authority changed before it could be persisted",
      );
    }
    const bindingAuthority = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT binding."id"
      FROM "agent_mcp_bindings" binding
      WHERE binding."connection_id" = ${params.connection.id}
        AND binding."app_account_id" = ${params.connection.appAccountId}
        AND binding."id" = ${params.bindingId}
        AND binding."agent_db_id" = ${params.agentDbId}
        AND binding."enabled" = true
      FOR UPDATE OF binding
    `);
    if (bindingAuthority.length !== 1) {
      throw new McpRuntimeError(
        "MCP_POLICY_BLOCKED",
        "MCP continuation authority changed before it could be persisted",
      );
    }
    if (params.rearm) {
      const rearmed = await tx.agentMcpContinuation.updateMany({
        where: {
          id: params.id,
          appAccountId: params.connection.appAccountId,
          agentDbId: params.agentDbId,
          bindingId: params.bindingId,
          connectionId: params.connection.id,
          rounds: Math.max(1, params.rounds - 1),
          ...(params.expectedFingerprint
            ? { fingerprint: params.expectedFingerprint }
            : {}),
          consumedAt: { not: null },
        },
        data: { ...data, consumedAt: null },
      });
      if (rearmed.count !== 1) {
        throw new McpConfigurationError(
          "MCP continuation could not be re-armed because its durable state changed concurrently",
        );
      }
      return;
    }
    await tx.agentMcpContinuation.create({
      data: {
        id: params.id,
        appAccountId: params.connection.appAccountId,
        agentDbId: params.agentDbId,
        bindingId: params.bindingId,
        connectionId: params.connection.id,
        ...data,
      },
    });
  });
}

export async function persistInputRequiredResult(params: {
  connection: McpConnectionRecord;
  agentDbId: number;
  bindingId: string;
  method: McpContinuationMethod;
  requestParams: Record<string, unknown>;
  result: unknown;
  /** Supplied for tools/call so retries retain the exact schema/definition. */
  toolDefinition?: McpToolDefinition;
  source?: Record<string, unknown>;
  existingId?: string;
  rounds?: number;
  expectedFingerprint?: string;
}): Promise<Record<string, unknown> | null> {
  if (!isInputRequiredResult(params.result)) return null;
  const inputRequests = inputRequestsFromResult(params.result);
  const requestState = typeof params.result.requestState === "string"
    ? params.result.requestState
    : undefined;
  if (Object.keys(inputRequests).length === 0) {
    if (requestState === undefined) {
      throw new McpConfigurationError("MCP server returned input_required without inputRequests or requestState");
    }
    return {
      ok: false,
      status: "unsupported_input_required",
      source: {
        kind: "mcp",
        connectionId: params.connection.id,
        ...(params.source ?? {}),
        serverName: typeof params.source?.serverName === "string"
          ? params.source.serverName
          : params.connection.displayName,
        operation: params.method,
      },
      untrustedExternalData: true,
      unsupportedRequests: [{ requestKey: "requestState", method: "input_required" }],
      message: "The MCP server requested additional input without a user-actionable elicitation request.",
    };
  }
  const rounds = params.rounds ?? 1;
  if (rounds > MAX_ROUNDS) {
    throw new McpConfigurationError(`MCP continuation exceeded the ${MAX_ROUNDS}-round limit`);
  }
  const requests = uiRequests(inputRequests);
  if (requests.unsupported.length > 0) {
    return continuationResult({
      id: params.existingId ?? "unsupported",
      connection: params.connection,
      method: params.method,
      inputRequests,
      source: params.source,
    });
  }
  const id = params.existingId ?? randomUUID();
  const expiresAt = new Date(Date.now() + CONTINUATION_TTL_MS);
  if (params.existingId === undefined) {
    await prisma.agentMcpContinuation.deleteMany({
      where: {
        appAccountId: params.connection.appAccountId,
        agentDbId: params.agentDbId,
        expiresAt: { lte: new Date() },
      },
    });
  }
  await persistPayload({
    id,
    connection: params.connection,
    method: params.method,
    requestParams: params.requestParams,
    inputRequests,
    toolDefinition: params.toolDefinition,
    requestState,
    rounds,
    expiresAt,
    rearm: params.existingId !== undefined,
    expectedFingerprint: params.expectedFingerprint,
    agentDbId: params.agentDbId,
    bindingId: params.bindingId,
    source: params.source,
  });
  return continuationResult({
    id,
    connection: params.connection,
    method: params.method,
    inputRequests,
    source: params.source,
  });
}

function primitiveArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const kind = typeof value[0];
  if (kind !== "string" && kind !== "number" && kind !== "boolean") return false;
  return value.every((entry) => typeof entry === kind);
}

function contentUsesAllowedDomain(value: Record<string, unknown>): boolean {
  return Object.values(value).every((entry) =>
    typeof entry === "string"
    || typeof entry === "number"
    || typeof entry === "boolean"
    || primitiveArray(entry),
  );
}

async function validateFormContent(
  request: Record<string, unknown>,
  content: Record<string, unknown>,
): Promise<boolean> {
  const params = isObject(request.params) ? request.params : {};
  if (params.mode !== "form" || !isObject(params.requestedSchema)) return false;
  if (!contentUsesAllowedDomain(content)) return false;
  try {
    const schema = fromJsonSchema<Record<string, unknown>>(
      params.requestedSchema,
    );
    const outcome = await schema["~standard"].validate(content);
    return !("issues" in outcome) || !outcome.issues || outcome.issues.length === 0;
  } catch {
    return false;
  }
}

async function normalizeResponses(
  raw: readonly McpContinuationResponse[],
  inputRequests: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const byKey = new Map(raw.map((response) => [response.requestKey, response] as const));
  if (byKey.size !== raw.length) return null;
  const responses: Record<string, unknown> = {};
  for (const [key, request] of Object.entries(inputRequests)) {
    if (!isObject(request) || request.method !== "elicitation/create") return null;
    const candidate = byKey.get(key);
    if (!candidate) return null;
    if (candidate.action !== "accept" && candidate.action !== "decline" && candidate.action !== "cancel") {
      return null;
    }
    const params = isObject(request.params) ? request.params : {};
    if (candidate.action === "accept" && params.mode === "form") {
      if (!candidate.content || !(await validateFormContent(request, candidate.content))) return null;
      responses[key] = { action: "accept", content: candidate.content };
    } else if (candidate.action === "accept") {
      responses[key] = { action: "accept" };
    } else {
      responses[key] = { action: candidate.action };
    }
  }
  return byKey.size === Object.keys(inputRequests).length ? responses : null;
}

export async function getMcpContinuationConnectionId(params: {
  id: string;
  appAccountId: string;
  agentDbId: number;
}): Promise<string | null> {
  const row = await prisma.agentMcpContinuation.findFirst({
    where: {
      id: params.id,
      appAccountId: params.appAccountId,
      agentDbId: params.agentDbId,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { connectionId: true },
  });
  return row?.connectionId ?? null;
}

export async function claimMcpContinuation(params: {
  id: string;
  appAccountId: string;
  agentDbId: number;
  responses: readonly McpContinuationResponse[];
}): Promise<
  | { ok: true; continuation: ClaimedMcpContinuation }
  | { ok: false; status: "not_found" | "expired" | "already_used" | "invalid_responses" }
> {
  const row = await prisma.agentMcpContinuation.findFirst({
    where: { id: params.id, appAccountId: params.appAccountId, agentDbId: params.agentDbId },
  }) as unknown as ContinuationRecord | null;
  if (!row) return { ok: false, status: "not_found" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, status: "expired" };
  if (row.consumedAt) return { ok: false, status: "already_used" };
  const payload = decryptPayload(row);
  const responses = await normalizeResponses(params.responses, payload.inputRequests);
  if (!responses) return { ok: false, status: "invalid_responses" };

  const claimed = await prisma.agentMcpContinuation.updateMany({
    where: {
      id: row.id,
      appAccountId: params.appAccountId,
      agentDbId: params.agentDbId,
      bindingId: row.bindingId,
      connectionId: row.connectionId,
      rounds: row.rounds,
      fingerprint: row.fingerprint,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, status: "already_used" };
  return { ok: true, continuation: { record: row, payload, responses } };
}
