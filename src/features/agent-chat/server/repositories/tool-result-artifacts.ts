import "server-only";

import {
  isToolUIPart,
  type UIDataTypes,
  type UIMessagePart,
  type UITools,
} from "ai";
import { prisma } from "@/lib/db";
import {
  isAgentCardToolName,
  redactAgentCardPayload,
} from "@/lib/agent-trading/agentcard";
import { redactSensitiveData } from "@/lib/security/sensitive-data-redaction";
import {
  REMOTE_SEMANTIC_MIN_SIMILARITY,
  REMOTE_SEMANTIC_CANDIDATE_LIMIT,
  rankCandidatesSemantically,
} from "@/features/agent-chat/server/semantic-ranking";
import { estimateToolOutputTokens } from "../run/token-budget";
import { searchableContextJson } from "../context-search-text";
import type { ToolContextPolicy } from "../tools/tool-context-policy";
import {
  isContextRetrievalToolName,
  toolResultAppearsError,
} from "../tools/tool-context-policy";
import { distillToolResultArtifact } from "./tool-result-distillation";
import type { AgentChatModelDefinition } from "../../shared/model-registry-types";
import { compactContextRetrievalResult } from "../tools/context-retrieval-projection";

const SEARCH_TEXT_LIMIT = 256_000;
const MODEL_PREVIEW_CHAR_LIMIT = 7_000;
const READ_RESULT_MAX_CHARS = 24_000;
const SEARCH_RESULT_LIMIT = 12;
const IMPORTANT_KEY = /(?:^|_)(?:id|status|signature|tx|transaction|hash|chain|network|amount|recipient|sender|from|to|address|wallet|mint|token|slot|block|receipt|approval|simulation|error|message|code|url)(?:$|_)/i;
const IMPORTANT_STRING_MAX_CHARS = 1_200;

function stratifiedIndexes(length: number, maximum: number): number[] {
  if (length <= 0 || maximum <= 0) return [];
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  if (maximum === 1) return [0];
  const indexes = new Set<number>();
  for (let slot = 0; slot < maximum; slot += 1) {
    indexes.add(Math.round((slot * (length - 1)) / (maximum - 1)));
  }
  return [...indexes].sort((left, right) => left - right);
}

function sanitizeToolValue(toolName: string, value: unknown): unknown {
  const toolRedacted = isAgentCardToolName(toolName)
    ? redactAgentCardPayload(value)
    : value;
  return redactSensitiveData(toolRedacted) ?? null;
}

function serializeStoredPayload(value: unknown): string {
  // PostgreSQL jsonb does not preserve JavaScript object insertion order. Sort
  // object keys at every level so a payload has the same byte representation
  // before and after a database round-trip. Arrays intentionally retain order.
  // Sanitization already constrains values to JSON-compatible data.
  return JSON.stringify(value, (_key, current) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return current;
    }
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0),
    );
  }) ?? "null";
}

function headTail(value: string, maxChars: number): string {
  const limit = Math.max(64, Math.trunc(maxChars));
  if (value.length <= limit) return value;
  const marker = "\n...[middle omitted; full result is retrievable]...\n";
  const half = Math.max(1, Math.floor((limit - marker.length) / 2));
  return `${value.slice(0, half)}${marker}${value.slice(-half)}`;
}

function importantProjection(
  value: unknown,
  depth = 0,
  remaining = { nodes: 80 },
): unknown {
  if (remaining.nodes <= 0 || depth > 4) return undefined;
  remaining.nodes -= 1;
  if (typeof value === "string") {
    if (/^data:[^;,]+(?:;[^,]*)?,/i.test(value)) {
      const comma = value.indexOf(",");
      const header = comma > 0 ? value.slice(0, comma) : "data:binary";
      return `${header},[binary payload omitted; exact value is stored in the artifact]`;
    }
    // "Important" fields are model-facing convenience evidence, not the
    // canonical value. A giant error/message/URL must not bypass artifact
    // externalization merely because its key matched IMPORTANT_KEY.
    return headTail(value, IMPORTANT_STRING_MAX_CHARS);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    // Preserve a small cross-section rather than only the first entries. Tool
    // APIs often put terminal status/errors or newest records at the end of a
    // large array, and those are disproportionately useful after virtualization.
    const projected = stratifiedIndexes(value.length, 8)
      .map((index) => importantProjection(value[index], depth + 1, remaining))
      .filter((entry) => entry !== undefined);
    return projected.length > 0 ? projected : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!IMPORTANT_KEY.test(key) && depth > 0) continue;
    const projected = importantProjection(entry, depth + 1, remaining);
    if (projected !== undefined) output[key] = projected;
    if (remaining.nodes <= 0) break;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function makePreview(
  value: unknown,
  policy: ToolContextPolicy,
): string {
  const maxChars = Math.min(
    MODEL_PREVIEW_CHAR_LIMIT,
    Math.max(512, policy.inlineTokenLimit * 4),
  );
  // Preview/search representations are deliberately binary-free even when the
  // canonical artifact contains an opaque media transport. This prevents a
  // data URI from consuming the entire preview budget while preserving exact
  // bytes behind read_tool_result. The shared projection also samples large
  // containers across their extent instead of only their first entries.
  return searchableContextJson(value, maxChars);
}

export type ToolResultArtifactProjection = {
  artifactId?: string;
  modelOutput: unknown;
  /** Smaller durable representation when model-facing output is a rehydratable view. */
  persistenceOutput?: unknown;
  externalized: boolean;
  estimatedTokens: number;
};

/**
 * Replace terminal tool payloads in the durable UI transcript with a bounded
 * canonical-source-backed representation. Ordinary results point at immutable
 * AgentChatArtifact payloads; context-retrieval results collapse to the source
 * artifact/message IDs they can reproduce. Persisting a second giant copy in
 * every assistant message only makes future history hydration more expensive.
 *
 * Agent stream callbacks intentionally expose `UIMessage<..., never, ...>` in
 * AI SDK 7, while durable chat messages use AgentChatDataParts. Keep this
 * adapter generic over the incoming data parts and widen tool I/O to UITools:
 * projected persistence payloads are canonicalized by settleRun before storage.
 */
export function projectToolOutputsForPersistence<
  DATA_PARTS extends UIDataTypes,
>(
  parts: readonly UIMessagePart<DATA_PARTS, UITools>[],
  projectionsByToolCallId: ReadonlyMap<string, unknown>,
): UIMessagePart<DATA_PARTS, UITools>[] {
  if (projectionsByToolCallId.size === 0) return [...parts];
  return parts.map((part) => {
    if (!isToolUIPart(part) || part.state !== "output-available") return part;
    const projection = projectionsByToolCallId.get(part.toolCallId);
    if (projection === undefined) return part;
    return { ...part, output: projection };
  });
}

export async function projectToolResultForModel(params: {
  conversationId: string;
  runId: string;
  responseMessageId: string;
  toolCallId: string;
  toolName: string;
  output: unknown;
  stateChanging: boolean;
  policy: ToolContextPolicy;
  appAccountId: string;
  preferredControlModel: AgentChatModelDefinition;
}): Promise<ToolResultArtifactProjection> {
  // Attachment rehydration must preserve the exact media transport for the
  // AI SDK's toModelOutput conversion. Generic string redaction can mutate an
  // opaque base64 payload and corrupt the file. Its durable projection below
  // strips the URL/data entirely, so the transport exists only for this model
  // step and the canonical conversation message remains the source of truth.
  const sanitized = params.toolName === "read_conversation_attachment"
    ? params.output
    : sanitizeToolValue(params.toolName, params.output);
  const estimatedTokens = estimateToolOutputTokens(sanitized);

  // Context retrieval tools are projections of canonical artifacts/messages,
  // not new source observations. Persisting their full output as another
  // AgentChatArtifact recursively duplicates the same data each time the model
  // rehydrates it. Keep the bounded view inline for the current step. Source
  // IDs remain inside that view; resultArtifactId is intentionally unset because
  // the schema models one producing tool event per canonical artifact.
  if (isContextRetrievalToolName(params.toolName)) {
    return {
      modelOutput: sanitized,
      persistenceOutput: compactContextRetrievalResult(params.toolName, sanitized),
      externalized: false,
      estimatedTokens,
    };
  }

  const serializedPayload = serializeStoredPayload(sanitized);
  const searchText = searchableContextJson(sanitized, SEARCH_TEXT_LIMIT);
  const preview = makePreview(sanitized, params.policy);
  const artifactSelect = {
    id: true,
    estimatedTokens: true,
    previewText: true,
    digestText: true,
    payloadJson: true,
  } as const;
  const currentRunArtifact = await prisma.agentChatArtifact.findUnique({
    where: {
      runId_toolCallId: {
        runId: params.runId,
        toolCallId: params.toolCallId,
      },
    },
    select: artifactSelect,
  });
  // Artifacts are canonical observations of a producing run/tool call. Do not
  // deduplicate them across runs even when payload bytes match: tool-event
  // provenance is one-to-one (`resultArtifactId` is unique), and attaching a
  // historical artifact to a new event would violate that ownership boundary.
  // Same-run recompilation can safely reuse the artifact identified by the
  // existing `(runId, toolCallId)` key.
  let artifact = currentRunArtifact ?? await prisma.agentChatArtifact.create({
    data: {
      conversationId: params.conversationId,
      runId: params.runId,
      responseMessageId: params.responseMessageId,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      payloadJson: sanitized as never,
      previewText: preview,
      searchText,
      estimatedTokens,
      byteLength: Buffer.byteLength(serializedPayload, "utf8"),
      stateChanging: params.stateChanging,
    },
    select: artifactSelect,
  });

  if (params.policy.strategy === "distill" && !artifact.digestText) {
    const digestText = await distillToolResultArtifact({
      artifactId: artifact.id,
      toolName: params.toolName,
      payload: artifact.payloadJson,
      appAccountId: params.appAccountId,
      preferredModel: params.preferredControlModel,
    });
    if (digestText) {
      artifact = await prisma.agentChatArtifact.update({
        where: { id: artifact.id },
        data: { digestText },
        select: artifactSelect,
      });
    }
  }

  const error = toolResultAppearsError(sanitized);
  const mustInline =
    artifact.estimatedTokens <= params.policy.inlineTokenLimit
    || (error && params.policy.preserveOnError && artifact.estimatedTokens <= params.policy.inlineTokenLimit * 2)
    || (params.stateChanging
      && params.policy.preserveIfStateChanging
      && artifact.estimatedTokens <= params.policy.inlineTokenLimit * 2);
  if (mustInline) {
    return {
      artifactId: artifact.id,
      modelOutput: artifact.payloadJson,
      externalized: false,
      estimatedTokens: artifact.estimatedTokens,
    };
  }

  const important = importantProjection(sanitized);
  return {
    artifactId: artifact.id,
    externalized: true,
    estimatedTokens: artifact.estimatedTokens,
    modelOutput: {
      ok: error ? false : true,
      status: error ? "externalized_error" : "externalized",
      toolName: params.toolName,
      artifactId: artifact.id,
      estimatedTokens: artifact.estimatedTokens,
      stateChanging: params.stateChanging,
      ...(important === undefined ? {} : { important }),
      ...(artifact.digestText ? { digest: artifact.digestText } : {}),
      preview: artifact.previewText,
      retrieval: {
        readTool: "read_tool_result",
        searchTool: "search_tool_results",
        instruction: "Use read_tool_result with this artifactId to inspect exact stored result content, optionally with a query and offset.",
      },
    },
  };
}

function boundedRead(text: string, offset: number, limit: number): {
  text: string;
  offset: number;
  nextOffset: number | null;
  totalChars: number;
} {
  const safeOffset = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  const safeLimit = Math.max(256, Math.min(READ_RESULT_MAX_CHARS, Math.trunc(limit)));
  const chunk = text.slice(safeOffset, safeOffset + safeLimit);
  const nextOffset = safeOffset + chunk.length < text.length
    ? safeOffset + chunk.length
    : null;
  return { text: chunk, offset: safeOffset, nextOffset, totalChars: text.length };
}

function artifactQueryTerms(query: string): string[] {
  const stop = new Set([
    "about", "after", "and", "are", "from", "have", "into", "show",
    "that", "the", "this", "tool", "what", "when", "where", "which",
    "with", "you", "your",
  ]);
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_:-]+/)
      .filter((term) => term.length >= 3 && !stop.has(term)),
  )].slice(0, 12);
}

function queryWindows(text: string, query: string, limit: number): Array<{
  offset: number;
  text: string;
}> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const lower = text.toLowerCase();
  const exact: Array<{ offset: number; text: string }> = [];
  let cursor = 0;
  while (exact.length < limit) {
    const index = lower.indexOf(needle, cursor);
    if (index < 0) break;
    const start = Math.max(0, index - 700);
    const end = Math.min(text.length, index + needle.length + 1_300);
    exact.push({ offset: start, text: text.slice(start, end) });
    cursor = Math.max(index + needle.length, end);
  }
  if (exact.length > 0) return exact;

  // Natural-language artifact queries rarely occur verbatim in JSON/log data.
  // Fall back to bounded term windows, rank them by multi-term overlap, and
  // return only the best excerpts rather than forcing the model to page through
  // the entire stored payload.
  const terms = artifactQueryTerms(query);
  if (terms.length === 0) return [];
  const candidates = new Map<number, { offset: number; text: string; score: number }>();
  for (const term of terms) {
    let termCursor = 0;
    let occurrences = 0;
    while (occurrences < 6) {
      const index = lower.indexOf(term, termCursor);
      if (index < 0) break;
      const start = Math.max(0, index - 700);
      const bucket = Math.floor(start / 1_000);
      if (!candidates.has(bucket)) {
        const end = Math.min(text.length, index + term.length + 1_300);
        const excerpt = text.slice(start, end);
        const excerptLower = excerpt.toLowerCase();
        const score = terms.reduce(
          (sum, candidate) => sum + (excerptLower.includes(candidate) ? 1 : 0),
          0,
        );
        candidates.set(bucket, { offset: start, text: excerpt, score });
      }
      occurrences += 1;
      termCursor = index + term.length;
    }
  }
  return [...candidates.values()]
    .sort((left, right) => right.score - left.score || left.offset - right.offset)
    .slice(0, limit)
    .map(({ score: _score, ...entry }) => entry);
}

export async function readToolResultArtifact(params: {
  artifactId: string;
  appAccountId: string;
  agentDbId: number;
  query?: string;
  offset?: number;
  limit?: number;
}): Promise<unknown> {
  const artifact = await prisma.agentChatArtifact.findFirst({
    where: {
      id: params.artifactId,
      conversation: {
        appAccountId: params.appAccountId,
        agentDbId: params.agentDbId,
      },
    },
    select: {
      id: true,
      toolName: true,
      estimatedTokens: true,
      stateChanging: true,
      payloadJson: true,
      createdAt: true,
    },
  });
  if (!artifact) {
    return { ok: false, status: "not_found", artifactId: params.artifactId };
  }
  const fullText = serializeStoredPayload(artifact.payloadJson);
  const query = params.query?.trim();
  if (query) {
    return {
      ok: true,
      artifactId: artifact.id,
      toolName: artifact.toolName,
      estimatedTokens: artifact.estimatedTokens,
      stateChanging: artifact.stateChanging,
      matches: queryWindows(fullText, query, 8),
    };
  }
  return {
    ok: true,
    artifactId: artifact.id,
    toolName: artifact.toolName,
    estimatedTokens: artifact.estimatedTokens,
    stateChanging: artifact.stateChanging,
    ...boundedRead(
      fullText,
      params.offset ?? 0,
      params.limit ?? 12_000,
    ),
  };
}

export async function searchToolResultArtifacts(params: {
  query: string;
  appAccountId: string;
  agentDbId: number;
  runId?: string;
  limit?: number;
  allowPlatformSemanticRanking: boolean;
}): Promise<unknown> {
  const query = params.query.trim();
  if (!query) return { ok: false, status: "invalid_query", results: [] };
  const limit = Math.max(1, Math.min(SEARCH_RESULT_LIMIT, Math.trunc(params.limit ?? 6)));
  const artifactSelect = {
    id: true,
    toolName: true,
    previewText: true,
    digestText: true,
    // Search text is a bounded retrieval index only. It is used locally for
    // term ranking and never copied into the model-facing search result.
    searchText: true,
    estimatedTokens: true,
    stateChanging: true,
    createdAt: true,
    runId: true,
  } as const;
  const scope = {
    conversation: {
      appAccountId: params.appAccountId,
      agentDbId: params.agentDbId,
    },
    ...(params.runId ? { runId: params.runId } : {}),
  };
  const exactLexicalRows = await prisma.agentChatArtifact.findMany({
    where: {
      ...scope,
      OR: [
        { searchText: { contains: query, mode: "insensitive" as const } },
        { previewText: { contains: query, mode: "insensitive" as const } },
        { toolName: { contains: query, mode: "insensitive" as const } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: artifactSelect,
  });
  const terms = artifactQueryTerms(query).slice(0, 8);
  const termRows = exactLexicalRows.length >= limit || terms.length === 0
    ? []
    : await prisma.agentChatArtifact.findMany({
        where: {
          ...scope,
          OR: terms.flatMap((term) => [
            { searchText: { contains: term, mode: "insensitive" as const } },
            { previewText: { contains: term, mode: "insensitive" as const } },
            { toolName: { contains: term, mode: "insensitive" as const } },
          ]),
        },
        orderBy: { createdAt: "desc" },
        take: Math.min(32, Math.max(limit * 4, 16)),
        select: artifactSelect,
      });
  const exactIds = new Set(exactLexicalRows.map((row) => row.id));
  const lexicalRows = [
    ...exactLexicalRows,
    ...termRows
      .filter((row) => !exactIds.has(row.id))
      .map((row) => {
        const text = [row.toolName, row.digestText, row.previewText, row.searchText]
          .filter(Boolean)
          .join("\n")
          .toLowerCase();
        const score = terms.reduce(
          (sum, term) => sum + (text.includes(term) ? 1 : 0),
          0,
        );
        return { row, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) =>
        right.score - left.score
        || right.row.createdAt.getTime() - left.row.createdAt.getTime(),
      )
      .map((entry) => entry.row),
  ].slice(0, limit);

  let rows = lexicalRows;
  if (lexicalRows.length < limit) {
    const [recentRows, importantRows] = await Promise.all([
      prisma.agentChatArtifact.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        take: REMOTE_SEMANTIC_CANDIDATE_LIMIT,
        select: artifactSelect,
      }),
      prisma.agentChatArtifact.findMany({
        where: {
          ...scope,
          OR: [
            { stateChanging: true },
            { previewText: { contains: "error", mode: "insensitive" as const } },
            { previewText: { contains: "failed", mode: "insensitive" as const } },
            { digestText: { contains: "error", mode: "insensitive" as const } },
            { digestText: { contains: "failed", mode: "insensitive" as const } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: Math.max(8, Math.floor(REMOTE_SEMANTIC_CANDIDATE_LIMIT / 3)),
        select: artifactSelect,
      }),
    ]);
    const candidateById = new Map(
      lexicalRows.map((row) => [row.id, row] as const),
    );
    const addCandidates = (
      rowsToAdd: typeof recentRows,
      maximum: number,
    ) => {
      let added = 0;
      for (const row of rowsToAdd) {
        if (candidateById.size >= REMOTE_SEMANTIC_CANDIDATE_LIMIT) break;
        if (candidateById.has(row.id)) continue;
        candidateById.set(row.id, row);
        added += 1;
        if (added >= maximum) break;
      }
    };
    const remainingCandidateSlots = Math.max(
      0,
      REMOTE_SEMANTIC_CANDIDATE_LIMIT - candidateById.size,
    );
    // Reserve semantic coverage for both durable mutation/error evidence and
    // ordinary recent observations. Neither temporal recency nor importance
    // should be able to monopolize the bounded embedding candidate set.
    addCandidates(
      importantRows,
      Math.ceil(remainingCandidateSlots * 0.4),
    );
    addCandidates(
      recentRows,
      Math.max(0, REMOTE_SEMANTIC_CANDIDATE_LIMIT - candidateById.size),
    );
    addCandidates(
      importantRows,
      Math.max(0, REMOTE_SEMANTIC_CANDIDATE_LIMIT - candidateById.size),
    );
    const candidates = [...candidateById.values()];
    const semanticScores = await rankCandidatesSemantically(
      query,
      candidates.map((row) => ({
        id: row.id,
        text: [row.toolName, row.digestText, row.previewText].filter(Boolean).join("\n"),
      })),
      { allowPlatformEmbeddings: params.allowPlatformSemanticRanking },
    );
    const lexicalIds = new Set(lexicalRows.map((row) => row.id));
    rows = candidates
      .map((row) => ({
        row,
        lexical: lexicalIds.has(row.id),
        semantic: semanticScores.get(row.id) ?? -1,
      }))
      .filter((entry) =>
        entry.lexical
        || entry.semantic >= REMOTE_SEMANTIC_MIN_SIMILARITY,
      )
      .sort((left, right) =>
        Number(right.lexical) - Number(left.lexical)
        || right.semantic - left.semantic
        || right.row.createdAt.getTime() - left.row.createdAt.getTime(),
      )
      .slice(0, limit)
      .map((entry) => entry.row);
  }

  return {
    ok: true,
    query,
    results: rows.map((row) => ({
      artifactId: row.id,
      toolName: row.toolName,
      preview: headTail(row.digestText ?? row.previewText, 2_000),
      estimatedTokens: row.estimatedTokens,
      stateChanging: row.stateChanging,
      runId: row.runId,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
