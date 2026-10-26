import { redactSensitiveData } from "@/lib/security/sensitive-data-redaction";

export type ExternalJsonBounds = {
  maxUtf8Bytes: number;
  maxStringBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxArrayItems: number;
  maxObjectKeys: number;
};

export const DEFAULT_MCP_MODEL_BOUNDS: ExternalJsonBounds = {
  maxUtf8Bytes: 64 * 1024,
  maxStringBytes: 16 * 1024,
  maxDepth: 8,
  maxNodes: 10_000,
  maxArrayItems: 100,
  maxObjectKeys: 100,
};

type Budget = {
  remainingBytes: number;
  remainingNodes: number;
  truncated: boolean;
  bounds: ExternalJsonBounds;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function consume(budget: Budget, bytes: number, nodes = 0): boolean {
  if (budget.remainingBytes < bytes || budget.remainingNodes < nodes) {
    budget.truncated = true;
    return false;
  }
  budget.remainingBytes -= bytes;
  budget.remainingNodes -= nodes;
  return true;
}

function jsonStringBodyByteLength(value: string): number {
  const encoded = JSON.stringify(value);
  return Math.max(0, byteLength(encoded) - 2);
}

function neutralizeExternalText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/gi, "");
}

function boundedString(value: string, budget: Budget): string {
  value = neutralizeExternalText(value);
  const rawBytes = byteLength(value);
  const serializedBytes = 2 + jsonStringBodyByteLength(value);
  if (
    rawBytes <= budget.bounds.maxStringBytes
    && serializedBytes <= budget.remainingBytes
  ) {
    consume(budget, serializedBytes);
    return value;
  }

  budget.truncated = true;
  const suffix = "…";
  const suffixRawBytes = byteLength(suffix);
  const suffixSerializedBytes = jsonStringBodyByteLength(suffix);
  const serializedBudget = Math.max(0, budget.remainingBytes - 2);
  const rawBudget = Math.max(0, budget.bounds.maxStringBytes);
  let result = "";
  let usedRawBytes = 0;
  let usedSerializedBytes = 0;

  for (const char of value) {
    const raw = byteLength(char);
    const encoded = jsonStringBodyByteLength(char);
    const reserveSuffixRaw = rawBudget >= suffixRawBytes ? suffixRawBytes : 0;
    const reserveSuffixSerialized = serializedBudget >= suffixSerializedBytes
      ? suffixSerializedBytes
      : 0;
    if (
      usedRawBytes + raw + reserveSuffixRaw > rawBudget
      || usedSerializedBytes + encoded + reserveSuffixSerialized > serializedBudget
    ) {
      break;
    }
    result += char;
    usedRawBytes += raw;
    usedSerializedBytes += encoded;
  }

  const canAppendSuffix =
    usedRawBytes + suffixRawBytes <= rawBudget
    && usedSerializedBytes + suffixSerializedBytes <= serializedBudget;
  if (canAppendSuffix) {
    result += suffix;
    usedSerializedBytes += suffixSerializedBytes;
  }

  const totalSerializedBytes = Math.min(
    budget.remainingBytes,
    2 + usedSerializedBytes,
  );
  consume(budget, totalSerializedBytes);
  return result;
}

function binaryMetadata(value: Record<string, unknown>): Record<string, unknown> | null {
  const type = value.type;
  if (type !== "image" && type !== "audio" && type !== "blob" && type !== "resource") {
    return null;
  }
  const data = typeof value.data === "string" ? value.data : null;
  const blob = typeof value.blob === "string" ? value.blob : null;
  const encoded = data ?? blob;
  if (!encoded || byteLength(encoded) <= 4_096) return null;
  const mimeType = typeof value.mimeType === "string"
    ? value.mimeType
    : typeof value.mime_type === "string"
      ? value.mime_type
      : undefined;
  return {
    type,
    ...(mimeType ? { mimeType } : {}),
    byteLength: Buffer.byteLength(encoded, "base64"),
    omittedFromModel: true,
  };
}

function sanitize(
  value: unknown,
  budget: Budget,
  depth = 0,
  key = "",
): unknown {
  if (depth > budget.bounds.maxDepth) {
    budget.truncated = true;
    return "[maximum depth omitted]";
  }
  if (!consume(budget, 1, 1)) return "[truncated]";

  if (value === null) {
    consume(budget, 3);
    return null;
  }
  if (typeof value === "boolean") {
    consume(budget, value ? 3 : 4);
    return value;
  }
  if (typeof value === "number") {
    const text = Number.isFinite(value) ? String(value) : "null";
    consume(budget, byteLength(text));
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") return boundedString(value.toString(), budget);
  if (typeof value === "string") {
    if (/^(data|blob|bytes|base64)$/i.test(key) && byteLength(value) > 4_096) {
      budget.truncated = true;
      return boundedString(
        `[binary payload omitted: ${byteLength(value)} encoded bytes]`,
        budget,
      );
    }
    return boundedString(value, budget);
  }
  if (Array.isArray(value)) {
    consume(budget, 2);
    const limit = Math.min(value.length, budget.bounds.maxArrayItems);
    if (limit < value.length) budget.truncated = true;
    const result: unknown[] = [];
    for (let index = 0; index < limit; index += 1) {
      if (index > 0) consume(budget, 1);
      if (budget.remainingBytes <= 0 || budget.remainingNodes <= 0) {
        budget.truncated = true;
        break;
      }
      result.push(sanitize(value[index], budget, depth + 1));
    }
    return result;
  }
  if (isObject(value)) {
    const media = binaryMetadata(value);
    if (media) {
      budget.truncated = true;
      return sanitize(media, budget, depth + 1);
    }
    consume(budget, 2);
    const entries = Object.entries(value);
    const limit = Math.min(entries.length, budget.bounds.maxObjectKeys);
    if (limit < entries.length) budget.truncated = true;
    const result: Record<string, unknown> = {};
    for (let index = 0; index < limit; index += 1) {
      const [entryKey, entry] = entries[index]!;
      const keyBytes = byteLength(JSON.stringify(entryKey)) + 1;
      if (!consume(budget, keyBytes + (index > 0 ? 1 : 0))) break;
      result[entryKey] = sanitize(entry, budget, depth + 1, entryKey);
      if (budget.remainingBytes <= 0 || budget.remainingNodes <= 0) break;
    }
    return result;
  }
  return boundedString(String(value), budget);
}

export function boundExternalJson(
  value: unknown,
  bounds: ExternalJsonBounds = DEFAULT_MCP_MODEL_BOUNDS,
): { value: unknown; truncated: boolean } {
  const budget: Budget = {
    remainingBytes: Math.max(1, Math.trunc(bounds.maxUtf8Bytes)),
    remainingNodes: Math.max(1, Math.trunc(bounds.maxNodes)),
    truncated: false,
    bounds,
  };
  const sanitized = sanitize(redactSensitiveData(value), budget);
  let serializedBytes = Number.POSITIVE_INFINITY;
  try {
    serializedBytes = byteLength(JSON.stringify(sanitized));
  } catch {
    // Sanitization should already produce JSON-compatible values; retain a
    // fail-closed model envelope if an exotic value still escapes it.
  }
  if (serializedBytes <= Math.max(1, Math.trunc(bounds.maxUtf8Bytes))) {
    return { value: sanitized, truncated: budget.truncated };
  }

  // Structural estimates above intentionally account conservatively, but this
  // final invariant makes the UTF-8 ceiling exact even for punctuation/escape
  // edge cases or extremely small custom bounds.
  const maxBytes = Math.max(1, Math.trunc(bounds.maxUtf8Bytes));
  const fallback: unknown = maxBytes >= 13
    ? "[truncated]"
    : maxBytes >= 4
      ? null
      : maxBytes >= 2
        ? ""
        : 0;
  return { value: fallback, truncated: true };
}


const MCP_ARTIFACT_MAX_DEPTH = 128;

type ArtifactSanitizeState = {
  truncated: boolean;
  binaryOmitted: boolean;
  ancestors: WeakSet<object>;
};

function sanitizeArtifactValue(
  value: unknown,
  state: ArtifactSanitizeState,
  depth = 0,
  key = "",
): unknown {
  if (depth > MCP_ARTIFACT_MAX_DEPTH) {
    state.truncated = true;
    return "[maximum safe depth omitted]";
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && /^(data|blob|bytes|base64)$/i.test(key) && byteLength(value) > 4_096) {
      state.binaryOmitted = true;
      return `[binary payload omitted: ${byteLength(value)} encoded bytes]`;
    }
    return typeof value === "string" ? neutralizeExternalText(value) : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) {
      state.truncated = true;
      return "[circular reference omitted]";
    }
    state.ancestors.add(value);
    try {
      return value.map((entry) =>
        sanitizeArtifactValue(entry, state, depth + 1),
      );
    } finally {
      state.ancestors.delete(value);
    }
  }
  if (isObject(value)) {
    const media = binaryMetadata(value);
    if (media) {
      state.binaryOmitted = true;
      return media;
    }
    if (state.ancestors.has(value)) {
      state.truncated = true;
      return "[circular reference omitted]";
    }
    state.ancestors.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entry]) => [
          entryKey,
          sanitizeArtifactValue(entry, state, depth + 1, entryKey),
        ]),
      );
    } finally {
      state.ancestors.delete(value);
    }
  }
  return String(value);
}

function artifactEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  const state: ArtifactSanitizeState = {
    truncated: false,
    binaryOmitted: false,
    ancestors: new WeakSet(),
  };
  const redacted = redactSensitiveData(envelope);
  const sanitized = sanitizeArtifactValue(redacted, state);
  return isObject(sanitized)
    ? {
        ...sanitized,
        truncated: sanitized.truncated === true || state.truncated,
        ...(state.binaryOmitted ? { binaryOmitted: true } : {}),
      }
    : {
        ok: false,
        status: "invalid_external_result",
        untrustedExternalData: true,
        truncated: state.truncated,
        ...(state.binaryOmitted ? { binaryOmitted: true } : {}),
        content: sanitized,
      };
}

export type McpResultSource = {
  connectionId: string;
  bindingId?: string;
  providerKey?: string | null;
  risk?: string;
  server: string;
  tool: string;
};

function boundModelEnvelope(envelope: Record<string, unknown>): Record<string, unknown> {
  const normalized = boundExternalJson(envelope);
  if (!isObject(normalized.value)) {
    return {
      ok: false,
      status: "truncated",
      untrustedExternalData: true,
      truncated: true,
      content: normalized.value,
    };
  }
  // `truncated` is deliberately placed before model-controlled payload fields
  // in every envelope below. If bounding changes it from false to true, the
  // serialized representation only gets shorter, so the exact byte ceiling
  // established by boundExternalJson remains valid.
  return {
    ...normalized.value,
    truncated: normalized.truncated || normalized.value.truncated === true,
  };
}

export function normalizeMcpToolResult(result: unknown, source: McpResultSource): unknown {
  const object = isObject(result) ? result : null;
  const isError = object?.isError === true;
  const content = object?.content ?? result;
  const structuredContent = object?.structuredContent;
  return boundModelEnvelope({
    ok: !isError,
    status: isError ? "tool_error" : "success",
    source: {
      kind: "mcp",
      connectionId: source.connectionId,
      bindingId: source.bindingId,
      providerKey: source.providerKey,
      risk: source.risk,
      server: source.server,
      tool: source.tool,
    },
    untrustedExternalData: true,
    truncated: false,
    ...(structuredContent === undefined ? {} : { structuredContent }),
    content,
  });
}

export function normalizeMcpMetaResult(
  result: unknown,
  source: Omit<McpResultSource, "tool"> & { operation: string },
): unknown {
  return boundModelEnvelope({
    ok: true,
    status: "success",
    source: {
      kind: "mcp",
      connectionId: source.connectionId,
      bindingId: source.bindingId,
      providerKey: source.providerKey,
      risk: source.risk,
      server: source.server,
      operation: source.operation,
    },
    untrustedExternalData: true,
    truncated: false,
    result,
  });
}


/**
 * Preserve the complete sanitized textual/structured MCP payload for the
 * canonical artifact store. Model-facing token limits are applied later by
 * the tool-result context projector, so this path deliberately does not apply
 * DEFAULT_MCP_MODEL_BOUNDS. Large binary bodies are represented by metadata.
 */
export function normalizeMcpToolResultForExecution(
  result: unknown,
  source: McpResultSource,
): unknown {
  const object = isObject(result) ? result : null;
  const isError = object?.isError === true;
  const content = object?.content ?? result;
  const structuredContent = object?.structuredContent;
  return artifactEnvelope({
    ok: !isError,
    status: isError ? "tool_error" : "success",
    source: {
      kind: "mcp",
      connectionId: source.connectionId,
      bindingId: source.bindingId,
      providerKey: source.providerKey,
      risk: source.risk,
      server: source.server,
      tool: source.tool,
    },
    untrustedExternalData: true,
    truncated: false,
    ...(structuredContent === undefined ? {} : { structuredContent }),
    content,
  });
}

export function normalizeMcpMetaResultForExecution(
  result: unknown,
  source: Omit<McpResultSource, "tool"> & { operation: string },
): unknown {
  return artifactEnvelope({
    ok: true,
    status: "success",
    source: {
      kind: "mcp",
      connectionId: source.connectionId,
      bindingId: source.bindingId,
      providerKey: source.providerKey,
      risk: source.risk,
      server: source.server,
      operation: source.operation,
    },
    untrustedExternalData: true,
    truncated: false,
    result,
  });
}
