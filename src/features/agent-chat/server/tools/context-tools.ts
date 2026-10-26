import "server-only";

import { tool, type ToolSet } from "ai";
import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { postgresAccentInsensitiveContains } from "@/lib/postgres-search";
import { boundedJsonPreview } from "@/lib/bounded-json-preview";
import { redactSensitiveData } from "@/lib/security/sensitive-data-redaction";
import {
  REMOTE_SEMANTIC_MIN_SIMILARITY,
  rankCandidatesSemantically,
} from "@/features/agent-chat/server/semantic-ranking";
import { extractTextContent } from "../../shared/ui-message";
import {
  readToolResultArtifact,
  searchToolResultArtifacts,
} from "../repositories/tool-result-artifacts";
import {
  agentToolContextSchema,
  requireAgentToolContext,
} from "./context";
import { markAgentRuntimeToolMetadata } from "./provider-tools";
import { markToolEffect } from "./tool-effects";
import { searchableContextJson } from "../context-search-text";

const MAX_HISTORY_ROWS = 80;
const MAX_HISTORY_SEARCH_CANDIDATES = 240;
const MAX_HISTORY_RECENT_SEARCH_ROWS = 120;
const MAX_HISTORY_SEARCH_WINDOWS = 5;
const MAX_HISTORY_SQL_LEXICAL_ROWS = 80;
const MAX_THREAD_CANDIDATES = 48;
const MAX_THREAD_SUMMARY_CANDIDATES = 96;
const MAX_THREAD_MESSAGE_SAMPLES = 6;
const MAX_THREAD_OLDER_SAMPLE_WINDOWS = 3;
const MAX_THREAD_OLDER_WINDOW = 12;
const MAX_THREAD_SQL_LEXICAL_ROWS = 80;
const MAX_MESSAGE_PREVIEW_CHARS = 4_000;
const MAX_SEARCH_RESULT_PREVIEW_CHARS = 2_000;
const MAX_EXACT_MESSAGE_CHARS = 24_000;
const VISUAL_HISTORY_QUERY = /\b(?:image|photo|picture|screenshot|chart|graph|diagram|figure|visual)\b/i;
const ATTACHMENT_HISTORY_QUERY = /\b(?:attachment|file|document|pdf|spreadsheet|uploaded)\b/i;
const CONTEXT_SEARCH_STOP_TERMS = new Set([
  "about", "after", "again", "also", "and", "are", "before", "can", "could",
  "did", "does", "for", "from", "have", "into", "last", "me", "our", "please",
  "show", "that", "the", "then", "this", "thread", "tool", "was", "were", "what",
  "when", "where", "which", "with", "you", "your",
]);

function messageText(parts: unknown): string {
  const partList = Array.isArray(parts) ? parts : [];
  let naturalText = "";
  try {
    naturalText = extractTextContent({
      parts: partList as never,
    }).trim();
  } catch {
    // Structural projection below still makes tool/file evidence searchable.
  }
  const structuralParts = partList.filter((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return true;
    return (part as { type?: unknown }).type !== "text";
  });
  const structuralText = structuralParts.length > 0
    ? searchableContextJson(structuralParts, MAX_MESSAGE_PREVIEW_CHARS)
    : "";
  return [naturalText, structuralText].filter(Boolean).join("\n").trim();
}

function boundedMessageText(parts: unknown): string {
  const text = messageText(parts);
  if (text.length <= MAX_MESSAGE_PREVIEW_CHARS) return text;
  const marker = "\n...[message content omitted]...\n";
  const half = Math.max(1, Math.floor((MAX_MESSAGE_PREVIEW_CHARS - marker.length) / 2));
  return `${text.slice(0, half)}${marker}${text.slice(-half)}`;
}

function boundedMessageSearchText(parts: unknown, query: string): string {
  const text = messageText(parts);
  if (text.length <= MAX_MESSAGE_PREVIEW_CHARS) return text;
  const normalized = text.toLowerCase();
  const needles = [query.trim().toLowerCase(), ...queryTerms(query)]
    .filter((value, index, values) => value.length >= 2 && values.indexOf(value) === index)
    .slice(0, 10);
  const windows: Array<{ start: number; end: number }> = [];
  for (const needle of needles) {
    const index = normalized.indexOf(needle);
    if (index < 0) continue;
    const start = Math.max(0, index - 500);
    const end = Math.min(text.length, index + needle.length + 900);
    if (windows.some((window) => start <= window.end && end >= window.start)) continue;
    windows.push({ start, end });
  }
  if (windows.length === 0) return boundedMessageText(parts);
  const marker = "\n...[non-matching message content omitted]...\n";
  const joined = windows
    .sort((left, right) => left.start - right.start)
    .map((window) => text.slice(window.start, window.end))
    .join(marker);
  if (joined.length <= MAX_MESSAGE_PREVIEW_CHARS) return joined;
  const half = Math.max(1, Math.floor((MAX_MESSAGE_PREVIEW_CHARS - marker.length) / 2));
  return `${joined.slice(0, half)}${marker}${joined.slice(-half)}`;
}


function modelFacingSearchPreview(text: string, query?: string): string {
  if (text.length <= MAX_SEARCH_RESULT_PREVIEW_CHARS) return text;
  const normalized = text.toLowerCase();
  const needles = query
    ? [query.trim().toLowerCase(), ...queryTerms(query)]
        .filter((value, index, values) => value.length >= 2 && values.indexOf(value) === index)
        .slice(0, 8)
    : [];
  for (const needle of needles) {
    const index = normalized.indexOf(needle);
    if (index < 0) continue;
    const prefix = index > 0 ? "...[earlier preview content omitted]...\n" : "";
    const suffix = "\n...[later preview content omitted]...";
    const contentBudget = Math.max(
      256,
      MAX_SEARCH_RESULT_PREVIEW_CHARS - prefix.length - suffix.length,
    );
    const half = Math.floor(contentBudget / 2);
    const start = Math.max(0, Math.min(text.length - contentBudget, index - half));
    const end = Math.min(text.length, start + contentBudget);
    const actualPrefix = start > 0 ? prefix : "";
    const actualSuffix = end < text.length ? suffix : "";
    const adjustedBudget = Math.max(
      256,
      MAX_SEARCH_RESULT_PREVIEW_CHARS - actualPrefix.length - actualSuffix.length,
    );
    const adjustedEnd = Math.min(text.length, start + adjustedBudget);
    return `${actualPrefix}${text.slice(start, adjustedEnd)}${adjustedEnd < text.length ? actualSuffix : ""}`;
  }
  const marker = "\n...[preview middle omitted; exact message is retrievable]...\n";
  const half = Math.max(1, Math.floor((MAX_SEARCH_RESULT_PREVIEW_CHARS - marker.length) / 2));
  return `${text.slice(0, half)}${marker}${text.slice(-half)}`;
}

type ConversationAttachmentReference = {
  conversationId: string;
  messageId: string;
  partIndex: number;
  mediaType: string;
  filename?: string;
  readTool: "read_conversation_attachment";
};

function conversationAttachmentReferences(
  parts: unknown,
  conversationId: string,
  messageId: string,
): ConversationAttachmentReference[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap((part, partIndex) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const record = part as Record<string, unknown>;
    const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
    if (record.type !== "file" || mediaType.length === 0) return [];
    return [{
      conversationId,
      messageId,
      partIndex,
      mediaType,
      ...(typeof record.filename === "string" ? { filename: record.filename } : {}),
      readTool: "read_conversation_attachment" as const,
    }];
  });
}

function exactHistoryParts(
  parts: unknown,
  conversationId: string,
  messageId: string,
): unknown {
  if (!Array.isArray(parts)) return redactSensitiveData(parts);
  return parts.map((part, partIndex) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      return redactSensitiveData(part);
    }
    const record = part as Record<string, unknown>;
    const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
    if (record.type !== "file" || mediaType.length === 0) {
      return redactSensitiveData(part);
    }
    return {
      type: "file",
      mediaType,
      ...(typeof record.filename === "string" ? { filename: record.filename } : {}),
      attachmentReference: {
        conversationId,
        messageId,
        partIndex,
        readTool: "read_conversation_attachment",
      },
      note: "Attachment bytes/URL omitted from textual history. Use read_conversation_attachment to restore the file input when needed.",
    };
  });
}

function exactMessageText(
  parts: unknown,
  conversationId: string,
  messageId: string,
): string {
  const projected = exactHistoryParts(parts, conversationId, messageId);
  try {
    return JSON.stringify(projected) ?? "null";
  } catch {
    return boundedJsonPreview(projected, {
      maxChars: 256_000,
      maxDepth: 16,
      maxEntriesPerContainer: 1_000,
      maxNodes: 100_000,
      maxStringChars: 100_000,
      indent: 0,
    }).text;
  }
}

function exactMessageOrPartText(
  parts: unknown,
  conversationId: string,
  messageId: string,
  partIndex?: number,
): { text: string; partIndex: number | null } | null {
  if (partIndex == null) {
    return {
      text: exactMessageText(parts, conversationId, messageId),
      partIndex: null,
    };
  }
  const projected = exactHistoryParts(parts, conversationId, messageId);
  if (!Array.isArray(projected) || partIndex < 0 || partIndex >= projected.length) {
    return null;
  }
  const part = projected[partIndex];
  try {
    return { text: JSON.stringify(part) ?? "null", partIndex };
  } catch {
    return {
      text: boundedJsonPreview(part, {
        maxChars: 256_000,
        maxDepth: 16,
        maxEntriesPerContainer: 1_000,
        maxNodes: 100_000,
        maxStringChars: 100_000,
        indent: 0,
      }).text,
      partIndex,
    };
  }
}

function attachmentToolModelOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { type: "json", value: output };
  }
  const record = output as Record<string, unknown>;
  if (record.ok !== true || typeof record.url !== "string") {
    return { type: "json", value: output };
  }
  const mediaType = typeof record.mediaType === "string"
    ? record.mediaType
    : "image/png";
  const metadata = [
    `Conversation attachment ${String(record.messageId ?? "unknown")}:${String(record.partIndex ?? "unknown")}.`,
    `Media type: ${mediaType}.`,
    typeof record.filename === "string" ? `Filename: ${record.filename}.` : "",
  ].filter(Boolean).join(" ");
  const isImage = mediaType.startsWith("image/");
  if (record.url.startsWith("https://")) {
    return {
      type: "content",
      value: [
        { type: "text", text: metadata },
        isImage
          ? { type: "image-url", url: record.url }
          : { type: "file-url", url: record.url, mediaType },
      ],
    };
  }
  if (!record.url.startsWith("data:")) {
    return { type: "json", value: { ok: false, status: "unsupported_attachment_url" } };
  }
  const comma = record.url.indexOf(",");
  const header = comma > 5 ? record.url.slice(5, comma) : "";
  const encoded = comma >= 0 ? record.url.slice(comma + 1) : "";
  const headerParts = header.split(";").map((part) => part.trim()).filter(Boolean);
  if (!encoded || !headerParts.some((part) => part.toLowerCase() === "base64")) {
    return { type: "json", value: { ok: false, status: "invalid_attachment_data_url" } };
  }
  return {
    type: "content",
    value: [
      { type: "text", text: metadata },
      isImage
        ? { type: "image-data", data: encoded, mediaType }
        : { type: "file-data", data: encoded, mediaType },
    ],
  };
}

function pagedExactMessage(text: string, offset: number, limit: number) {
  const safeOffset = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  const safeLimit = Math.max(256, Math.min(MAX_EXACT_MESSAGE_CHARS, Math.trunc(limit)));
  const chunk = text.slice(safeOffset, safeOffset + safeLimit);
  return {
    text: chunk,
    offset: safeOffset,
    nextOffset: safeOffset + chunk.length < text.length ? safeOffset + chunk.length : null,
    totalChars: text.length,
  };
}

function queryTerms(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 2 && !CONTEXT_SEARCH_STOP_TERMS.has(term)),
  )];
}

function lexicalScore(query: string, text: string): number {
  const normalized = text.toLowerCase();
  const terms = queryTerms(query);
  if (terms.length === 0) return 0;
  let score = normalized.includes(query.toLowerCase().trim()) ? 50 : 0;
  for (const term of terms) {
    const index = normalized.indexOf(term);
    if (index >= 0) score += 5 + Math.max(0, 3 - Math.floor(index / 1_000));
  }
  return score;
}

async function findLexicalHistoryMessageIds(params: {
  conversationId: string;
  query: string;
  beforeSequence?: number;
  afterSequence?: number;
  limit?: number;
}): Promise<string[]> {
  const phrase = params.query.trim();
  const needles = [...new Set([
    ...(phrase.length >= 3 ? [phrase] : []),
    ...queryTerms(params.query).filter((term) => term.length >= 3),
  ])].slice(0, 10);
  if (needles.length === 0) return [];
  const predicates = needles.map((needle) =>
    postgresAccentInsensitiveContains(Prisma.sql`message."search_text"`, needle),
  );
  const visualAttachmentQuery = VISUAL_HISTORY_QUERY.test(params.query);
  if (visualAttachmentQuery || ATTACHMENT_HISTORY_QUERY.test(params.query)) {
    predicates.push(visualAttachmentQuery
      ? Prisma.sql`message."has_image_file" = true`
      : Prisma.sql`message."has_file" = true`);
  }
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT message."id"
    FROM "agent_chat_messages" AS message
    WHERE message."conversation_id" = ${params.conversationId}
      ${params.beforeSequence == null
        ? Prisma.sql``
        : Prisma.sql`AND message."sequence" < ${params.beforeSequence}`}
      ${params.afterSequence == null
        ? Prisma.sql``
        : Prisma.sql`AND message."sequence" > ${params.afterSequence}`}
      AND (${Prisma.join(predicates, " OR ")})
    ORDER BY
      CASE WHEN ${phrase.length >= 3}
        AND ${postgresAccentInsensitiveContains(Prisma.sql`message."search_text"`, phrase)}
        THEN 0 ELSE 1 END,
      message."sequence" DESC
    LIMIT ${Math.max(1, Math.min(MAX_HISTORY_SQL_LEXICAL_ROWS, params.limit ?? MAX_HISTORY_SQL_LEXICAL_ROWS))}
  `);
  return rows.map((row) => row.id);
}

type LexicalPreviousThreadMessage = {
  id: string;
  conversationId: string;
  sequence: number;
  role: string;
  parts: unknown;
  createdAt: Date;
  title: string;
};

async function findLexicalPreviousThreadMessages(params: {
  appAccountId: string;
  agentDbId: number;
  currentConversationId?: string;
  query: string;
}): Promise<LexicalPreviousThreadMessage[]> {
  const phrase = params.query.trim();
  const needles = [...new Set([
    ...(phrase.length >= 3 ? [phrase] : []),
    ...queryTerms(params.query).filter((term) => term.length >= 3),
  ])].slice(0, 10);
  if (needles.length === 0) return [];
  const predicates = needles.map((needle) =>
    postgresAccentInsensitiveContains(Prisma.sql`message."search_text"`, needle),
  );
  const visualAttachmentQuery = VISUAL_HISTORY_QUERY.test(params.query);
  if (visualAttachmentQuery || ATTACHMENT_HISTORY_QUERY.test(params.query)) {
    predicates.push(visualAttachmentQuery
      ? Prisma.sql`message."has_image_file" = true`
      : Prisma.sql`message."has_file" = true`);
  }
  return prisma.$queryRaw<LexicalPreviousThreadMessage[]>(Prisma.sql`
    SELECT
      message."id",
      message."conversation_id" AS "conversationId",
      message."sequence",
      message."role"::text AS "role",
      message."parts",
      message."created_at" AS "createdAt",
      conversation."title"
    FROM "agent_chat_messages" AS message
    INNER JOIN "agent_chat_conversations" AS conversation
      ON conversation."id" = message."conversation_id"
    WHERE conversation."app_account_id" = ${params.appAccountId}
      AND conversation."agent_db_id" = ${params.agentDbId}
      AND conversation."deleted_at" IS NULL
      ${params.currentConversationId == null
        ? Prisma.sql``
        : Prisma.sql`AND conversation."id" <> ${params.currentConversationId}`}
      AND message."role"::text IN ('user', 'assistant')
      AND (${Prisma.join(predicates, " OR ")})
    ORDER BY
      CASE WHEN ${phrase.length >= 3}
        AND ${postgresAccentInsensitiveContains(Prisma.sql`message."search_text"`, phrase)}
        THEN 0 ELSE 1 END,
      message."created_at" DESC
    LIMIT ${MAX_THREAD_SQL_LEXICAL_ROWS}
  `);
}

function boundedWorkingStateText(value: unknown): string {
  if (value == null) return "";
  return boundedJsonPreview(redactSensitiveData(value), {
    maxChars: 2_000,
    maxDepth: 6,
    maxEntriesPerContainer: 40,
    maxNodes: 1_000,
    maxStringChars: 800,
    indent: 0,
  }).text;
}

function markContextTool<T extends ToolSet[string]>(value: T): T {
  if (typeof value === "object" && value !== null) {
    markAgentRuntimeToolMetadata(value, { source: "local" });
  }
  return markToolEffect(value, { stateChanging: false });
}

export function buildAgentContextTools(): ToolSet {
  const read_tool_result = markContextTool(tool({
    description:
      "Read an exact stored tool-result artifact by ID. Use this after a tool result was externalized; optionally search within it or page through the complete sanitized result.",
    inputSchema: z.object({
      artifactId: z.string().min(1),
      query: z.string().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(256).max(24_000).optional(),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context: executionContext }) => {
      const context = requireAgentToolContext(executionContext);
      return readToolResultArtifact({
        artifactId: input.artifactId,
        appAccountId: context.appAccountId,
        agentDbId: context.agentDbId,
        query: input.query,
        offset: input.offset,
        limit: input.limit,
      });
    },
  }));

  const search_tool_results = markContextTool(tool({
    description:
      "Search stored full tool-result artifacts for this agent by text, tool name, identifiers, addresses, signatures, errors, or other result content. Returns compact previews and artifact IDs for exact re-reading.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      runId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context: executionContext }) => {
      const context = requireAgentToolContext(executionContext);
      return searchToolResultArtifacts({
        query: input.query,
        appAccountId: context.appAccountId,
        agentDbId: context.agentDbId,
        runId: input.runId,
        limit: input.limit,
        allowPlatformSemanticRanking: context.allowPlatformSemanticRanking,
      });
    },
  }));

  const read_conversation_history = markContextTool(tool({
    description:
      "Search/list messages from the current conversation or a previous conversationId returned by search_previous_threads, including compacted history. Chronological reads return nextBeforeSequence for older-page retrieval. Page through one message's exact sanitized textual/structured parts by messageId, optionally restricting to one partIndex; file attachments are returned as canonical references and can be restored on demand with read_conversation_attachment.",
    inputSchema: z.object({
      conversationId: z.string().min(1).max(256).optional(),
      messageId: z.string().min(1).max(256).optional(),
      partIndex: z.number().int().min(0).max(10_000).optional(),
      query: z.string().min(1).max(500).optional(),
      beforeSequence: z.number().int().positive().optional(),
      afterSequence: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(MAX_HISTORY_ROWS).optional(),
      offset: z.number().int().min(0).optional(),
      charLimit: z.number().int().min(256).max(MAX_EXACT_MESSAGE_CHARS).optional(),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context: executionContext }) => {
      const context = requireAgentToolContext(executionContext);
      const run = await prisma.agentChatRun.findFirst({
        where: {
          id: context.runId,
          appAccountId: context.appAccountId,
          agentDbId: context.agentDbId,
        },
        select: { conversationId: true },
      });
      if (!run) return { ok: false, status: "run_not_found", messages: [] };
      if (input.partIndex != null && !input.messageId) {
        return {
          ok: false,
          status: "message_id_required_for_part_index",
          partIndex: input.partIndex,
          messages: [],
        };
      }
      const targetConversationId = input.conversationId ?? run.conversationId;
      if (targetConversationId !== run.conversationId) {
        const targetConversation = await prisma.agentChatConversation.findFirst({
          where: {
            id: targetConversationId,
            appAccountId: context.appAccountId,
            agentDbId: context.agentDbId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!targetConversation) {
          return {
            ok: false,
            status: "conversation_not_found",
            conversationId: targetConversationId,
            messages: [],
          };
        }
      }

      if (input.messageId) {
        const row = await prisma.agentChatMessage.findFirst({
          where: {
            id: input.messageId,
            conversationId: targetConversationId,
          },
          select: {
            id: true,
            sequence: true,
            role: true,
            parts: true,
            createdAt: true,
          },
        });
        if (!row) {
          return { ok: false, status: "message_not_found", messageId: input.messageId };
        }
        const exact = exactMessageOrPartText(
          row.parts,
          targetConversationId,
          row.id,
          input.partIndex,
        );
        if (!exact) {
          return {
            ok: false,
            status: "message_part_not_found",
            messageId: row.id,
            partIndex: input.partIndex,
          };
        }
        return {
          ok: true,
          conversationId: targetConversationId,
          message: {
            id: row.id,
            sequence: row.sequence,
            role: row.role,
            createdAt: row.createdAt.toISOString(),
            ...(exact.partIndex == null ? {} : { partIndex: exact.partIndex }),
            attachments: conversationAttachmentReferences(row.parts, targetConversationId, row.id),
            ...pagedExactMessage(
              exact.text,
              input.offset ?? 0,
              input.charLimit ?? 12_000,
            ),
          },
        };
      }

      const query = input.query?.trim();
      const requestedHistoryLimit = Math.min(
        MAX_HISTORY_ROWS,
        Math.max(input.limit ?? 24, 1),
      );
      const historyWhere = {
        conversationId: targetConversationId,
        ...(input.beforeSequence == null ? {} : { sequence: { lt: input.beforeSequence } }),
        ...(input.afterSequence == null
          ? {}
          : input.beforeSequence == null
            ? { sequence: { gt: input.afterSequence } }
            : { sequence: { gt: input.afterSequence, lt: input.beforeSequence } }),
      };
      const historySelect = {
        id: true,
        sequence: true,
        role: true,
        parts: true,
        createdAt: true,
      } as const;
      const rows = query
        ? await (async () => {
            const [recentRows, totalRows, lexicalIds] = await Promise.all([
              prisma.agentChatMessage.findMany({
                where: historyWhere,
                orderBy: { sequence: "desc" },
                take: MAX_HISTORY_RECENT_SEARCH_ROWS,
                select: historySelect,
              }),
              prisma.agentChatMessage.count({ where: historyWhere }),
              findLexicalHistoryMessageIds({
                conversationId: targetConversationId,
                query,
                beforeSequence: input.beforeSequence,
                afterSequence: input.afterSequence,
              }),
            ]);
            const lexicalRows = lexicalIds.length > 0
              ? await prisma.agentChatMessage.findMany({
                  where: { ...historyWhere, id: { in: lexicalIds } },
                  select: historySelect,
                })
              : [];
            if (totalRows <= recentRows.length) {
              return [...new Map(
                [...recentRows, ...lexicalRows].map((row) => [row.id, row] as const),
              ).values()];
            }

            // Spend database work rather than context tokens: preserve a strong
            // recency slice, then sample bounded windows across the remaining
            // chronology so semantic retrieval can find synonym-only details
            // deep inside a very long compacted thread.
            const remainingBudget = MAX_HISTORY_SEARCH_CANDIDATES - recentRows.length;
            const windowSize = Math.max(
              1,
              Math.floor(remainingBudget / MAX_HISTORY_SEARCH_WINDOWS),
            );
            const olderRows = Math.max(0, totalRows - recentRows.length);
            const offsets = Array.from({ length: MAX_HISTORY_SEARCH_WINDOWS }, (_, index) =>
              recentRows.length
              + Math.max(
                0,
                Math.floor(((index + 1) * olderRows) / (MAX_HISTORY_SEARCH_WINDOWS + 1))
                  - Math.floor(windowSize / 2),
              ),
            );
            const windows = await Promise.all(offsets.map((skip) =>
              prisma.agentChatMessage.findMany({
                where: historyWhere,
                orderBy: { sequence: "desc" },
                skip,
                take: windowSize,
                select: historySelect,
              }),
            ));
            const byId = new Map(
              [...recentRows, ...lexicalRows, ...windows.flat()]
                .map((row) => [row.id, row] as const),
            );
            return [...byId.values()]
              .sort((left, right) => right.sequence - left.sequence)
              .slice(0, MAX_HISTORY_SEARCH_CANDIDATES);
          })()
        : await prisma.agentChatMessage.findMany({
            where: historyWhere,
            orderBy: { sequence: "desc" },
            take: requestedHistoryLimit,
            select: historySelect,
          });
      let filtered: Array<{ row: (typeof rows)[number]; text: string; score: number }>;
      if (query) {
        const ranked = rows
          .map((row) => ({ row, text: boundedMessageSearchText(row.parts, query) }))
          .map((entry) => ({ ...entry, lexical: lexicalScore(query, entry.text) }))
          .sort((left, right) => right.lexical - left.lexical || right.row.sequence - left.row.sequence);
        const candidateLimit = Math.min(MAX_THREAD_CANDIDATES, ranked.length);
        const lexicalCandidates = ranked
          .filter((entry) => entry.lexical > 0)
          .slice(0, Math.floor(candidateLimit * 0.75));
        const candidateIds = new Set(lexicalCandidates.map((entry) => entry.row.id));
        const candidates = [...lexicalCandidates];
        const remaining = ranked.filter((entry) => !candidateIds.has(entry.row.id));
        const semanticSlots = candidateLimit - candidates.length;
        if (semanticSlots > 0 && remaining.length > 0) {
          // Sample across the entire bounded sequence range rather than filling
          // every zero-overlap embedding slot from the newest messages. This
          // gives synonym-only queries a path to older exact history.
          for (let slot = 0; slot < semanticSlots; slot += 1) {
            const index = Math.min(
              remaining.length - 1,
              Math.floor((slot * remaining.length) / semanticSlots),
            );
            const entry = remaining[index];
            if (!entry || candidateIds.has(entry.row.id)) continue;
            candidateIds.add(entry.row.id);
            candidates.push(entry);
          }
        }
        const semanticScores = await rankCandidatesSemantically(
          query,
          candidates.map((entry) => ({ id: entry.row.id, text: entry.text })),
          { allowPlatformEmbeddings: context.allowPlatformSemanticRanking },
        );
        filtered = candidates
          .map((entry) => ({
            row: entry.row,
            text: entry.text,
            score: entry.lexical + (semanticScores.get(entry.row.id) ?? 0) * 25,
            semantic: semanticScores.get(entry.row.id) ?? 0,
            lexical: entry.lexical,
          }))
          .filter((entry) =>
            entry.lexical > 0
            || entry.semantic >= REMOTE_SEMANTIC_MIN_SIMILARITY,
          )
          .sort((left, right) => right.score - left.score || right.row.sequence - left.row.sequence)
          .slice(0, input.limit ?? 12);
      } else {
        filtered = rows
          .slice(0, input.limit ?? 24)
          .map((row) => ({ row, text: boundedMessageText(row.parts), score: 0 }));
      }

      const resultMessages = filtered
        .map(({ row, text }) => ({
          id: row.id,
          sequence: row.sequence,
          role: row.role,
          createdAt: row.createdAt.toISOString(),
          text: modelFacingSearchPreview(text, query),
          attachments: conversationAttachmentReferences(row.parts, targetConversationId, row.id),
        }))
        .sort((left, right) => left.sequence - right.sequence);
      return {
        ok: true,
        conversationId: targetConversationId,
        messages: resultMessages,
        ...(!query && rows.length >= requestedHistoryLimit && resultMessages.length > 0
          ? { nextBeforeSequence: resultMessages[0]!.sequence }
          : { nextBeforeSequence: null }),
      };
    },
  }));

  const read_conversation_attachment = markContextTool(tool({
    description:
      "Restore one canonical file attachment from conversation history as model input. Use conversationId/messageId/partIndex references returned by read_conversation_history or historical attachment markers; do not call it unless the file content is needed.",
    inputSchema: z.object({
      conversationId: z.string().min(1).max(256).optional(),
      messageId: z.string().min(1).max(256),
      partIndex: z.number().int().min(0).max(64),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context: executionContext }) => {
      const context = requireAgentToolContext(executionContext);
      const run = await prisma.agentChatRun.findFirst({
        where: {
          id: context.runId,
          appAccountId: context.appAccountId,
          agentDbId: context.agentDbId,
        },
        select: { conversationId: true },
      });
      if (!run) return { ok: false, status: "run_not_found" };
      const targetConversationId = input.conversationId ?? run.conversationId;
      if (targetConversationId !== run.conversationId) {
        const targetConversation = await prisma.agentChatConversation.findFirst({
          where: {
            id: targetConversationId,
            appAccountId: context.appAccountId,
            agentDbId: context.agentDbId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!targetConversation) {
          return {
            ok: false,
            status: "conversation_not_found",
            conversationId: targetConversationId,
          };
        }
      }
      const row = await prisma.agentChatMessage.findFirst({
        where: {
          id: input.messageId,
          conversationId: targetConversationId,
        },
        select: { id: true, parts: true },
      });
      if (!row || !Array.isArray(row.parts)) {
        return { ok: false, status: "message_not_found", messageId: input.messageId };
      }
      const part = row.parts[input.partIndex];
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        return { ok: false, status: "attachment_not_found", messageId: row.id, partIndex: input.partIndex };
      }
      const record = part as Record<string, unknown>;
      const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
      const url = typeof record.url === "string" ? record.url : "";
      if (record.type !== "file" || mediaType.length === 0 || !url) {
        return { ok: false, status: "attachment_not_found", messageId: row.id, partIndex: input.partIndex };
      }
      if (!url.startsWith("data:") && !url.startsWith("https://")) {
        return { ok: false, status: "unsupported_attachment_url", messageId: row.id, partIndex: input.partIndex };
      }
      return {
        ok: true,
        readTool: "read_conversation_attachment" as const,
        conversationId: targetConversationId,
        messageId: row.id,
        partIndex: input.partIndex,
        mediaType,
        ...(typeof record.filename === "string" ? { filename: record.filename } : {}),
        url,
      };
    },
    toModelOutput: ({ output }) => attachmentToolModelOutput(output) as never,
  }));

  const search_previous_threads = markContextTool(tool({
    description:
      "Search this agent's previous conversation threads for relevant past discussion without loading whole transcripts. Uses compacted thread summaries/working state plus bounded message excerpts, and returns thread/message references for exact follow-up reads.",
    inputSchema: z.object({
      query: z.string().min(1).max(2_000),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context: executionContext }) => {
      const context = requireAgentToolContext(executionContext);
      const currentRun = await prisma.agentChatRun.findFirst({
        where: {
          id: context.runId,
          appAccountId: context.appAccountId,
          agentDbId: context.agentDbId,
        },
        select: { conversationId: true },
      });
      const conversationScope = {
        appAccountId: context.appAccountId,
        agentDbId: context.agentDbId,
        deletedAt: null,
        ...(currentRun ? { id: { not: currentRun.conversationId } } : {}),
      } as const;
      const [rows, sampledThreads, threadCount, lexicalThreadMessages] = await Promise.all([
        prisma.agentChatMessage.findMany({
          where: {
            conversation: conversationScope,
            role: { in: ["user", "assistant"] },
          },
          orderBy: { createdAt: "desc" },
          take: 240,
          select: {
            id: true,
            conversationId: true,
            sequence: true,
            role: true,
            parts: true,
            createdAt: true,
            conversation: { select: { title: true } },
          },
        }),
        prisma.agentChatConversation.findMany({
          where: conversationScope,
          orderBy: { lastMessageAt: "desc" },
          take: MAX_THREAD_SUMMARY_CANDIDATES,
          select: {
            id: true,
            title: true,
            contextSummary: true,
            workingState: true,
            summaryThroughSequence: true,
            summaryUpdatedAt: true,
            lastMessageAt: true,
            messages: {
              where: { role: { in: ["user", "assistant"] } },
              orderBy: { sequence: "desc" },
              take: MAX_THREAD_MESSAGE_SAMPLES,
              select: {
                id: true,
                sequence: true,
                role: true,
                parts: true,
                createdAt: true,
              },
            },
          },
        }),
        prisma.agentChatConversation.count({ where: conversationScope }),
        findLexicalPreviousThreadMessages({
          appAccountId: context.appAccountId,
          agentDbId: context.agentDbId,
          currentConversationId: currentRun?.conversationId,
          query: input.query,
        }),
      ]);
      const olderThreadWindows = threadCount <= sampledThreads.length
        ? []
        : await (async () => {
            const olderCount = threadCount - sampledThreads.length;
            const windowSize = Math.min(MAX_THREAD_OLDER_WINDOW, olderCount);
            const maxOlderOffset = Math.max(0, olderCount - windowSize);
            const offsets = new Set<number>();
            for (let index = 0; index < MAX_THREAD_OLDER_SAMPLE_WINDOWS; index += 1) {
              const denominator = Math.max(1, MAX_THREAD_OLDER_SAMPLE_WINDOWS - 1);
              offsets.add(
                sampledThreads.length
                + Math.floor((maxOlderOffset * index) / denominator),
              );
            }
            return Promise.all([...offsets].map((skip) =>
              prisma.agentChatConversation.findMany({
                where: conversationScope,
                orderBy: { lastMessageAt: "desc" },
                skip,
                take: windowSize,
                select: {
                  id: true,
                  title: true,
                  contextSummary: true,
                  workingState: true,
                  summaryThroughSequence: true,
                  summaryUpdatedAt: true,
                  lastMessageAt: true,
                  messages: {
                    where: { role: { in: ["user", "assistant"] } },
                    orderBy: { sequence: "desc" },
                    take: MAX_THREAD_MESSAGE_SAMPLES,
                    select: {
                      id: true,
                      sequence: true,
                      role: true,
                      parts: true,
                      createdAt: true,
                    },
                  },
                },
              }),
            ));
          })();
      const threadCandidates = [...new Map(
        [...sampledThreads, ...olderThreadWindows.flat()]
          .map((thread) => [thread.id, thread] as const),
      ).values()];
      type ThreadSearchCandidate = {
        id: string;
        source: "message" | "thread_summary";
        conversationId: string;
        title: string;
        messageId?: string;
        sequence?: number;
        role?: string;
        createdAt: Date;
        text: string;
      };
      const candidates: ThreadSearchCandidate[] = [];
      const candidateIds = new Set<string>();
      const addCandidate = (candidate: ThreadSearchCandidate) => {
        if (candidateIds.has(candidate.id)) return;
        candidateIds.add(candidate.id);
        candidates.push(candidate);
      };
      for (const row of lexicalThreadMessages) {
        addCandidate({
          id: `message:${row.id}`,
          source: "message",
          conversationId: row.conversationId,
          title: row.title,
          messageId: row.id,
          sequence: row.sequence,
          role: row.role,
          createdAt: row.createdAt,
          text: boundedMessageSearchText(row.parts, input.query),
        });
      }
      for (const row of rows) {
        addCandidate({
          id: `message:${row.id}`,
          source: "message",
          conversationId: row.conversationId,
          title: row.conversation.title,
          messageId: row.id,
          sequence: row.sequence,
          role: row.role,
          createdAt: row.createdAt,
          text: boundedMessageSearchText(row.parts, input.query),
        });
      }
      for (const thread of threadCandidates) {
        for (const row of thread.messages) {
          addCandidate({
            id: `message:${row.id}`,
            source: "message",
            conversationId: thread.id,
            title: thread.title,
            messageId: row.id,
            sequence: row.sequence,
            role: row.role,
            createdAt: row.createdAt,
            text: boundedMessageSearchText(row.parts, input.query),
          });
        }
        const summaryText = [
          thread.title,
          thread.contextSummary ?? "",
          boundedWorkingStateText(thread.workingState),
          thread.summaryThroughSequence == null
            ? ""
            : `Summary covers messages through sequence ${thread.summaryThroughSequence}.`,
        ].filter(Boolean).join("\n");
        if (thread.contextSummary || thread.workingState != null) {
          addCandidate({
            id: `summary:${thread.id}`,
            source: "thread_summary",
            conversationId: thread.id,
            title: thread.title,
            ...(thread.summaryThroughSequence == null
              ? {}
              : { sequence: thread.summaryThroughSequence }),
            createdAt: thread.summaryUpdatedAt ?? thread.lastMessageAt,
            text: summaryText,
          });
        }
      }
      const rankedCandidates = candidates
        .map((entry) => ({ ...entry, lexical: lexicalScore(input.query, entry.text) }))
        .sort((left, right) => right.lexical - left.lexical || right.createdAt.getTime() - left.createdAt.getTime());
      const lexicalCandidates = rankedCandidates
        .filter((entry) => entry.lexical > 0)
        .slice(0, Math.floor(MAX_THREAD_CANDIDATES * 0.5));
      const semanticCandidateIds = new Set(lexicalCandidates.map((entry) => entry.id));
      const semanticCandidates = [...lexicalCandidates];
      const addSemanticCandidate = (entry: (typeof rankedCandidates)[number]) => {
        if (semanticCandidates.length >= MAX_THREAD_CANDIDATES) return;
        if (semanticCandidateIds.has(entry.id)) return;
        semanticCandidateIds.add(entry.id);
        semanticCandidates.push(entry);
      };

      // Compacted thread summaries are dense semantic representations of old
      // context, so reserve some embedding slots for them before recent raw
      // messages can consume the entire candidate set.
      for (const entry of rankedCandidates) {
        if (entry.source !== "thread_summary") continue;
        addSemanticCandidate(entry);
        if (semanticCandidates.length >= Math.floor(MAX_THREAD_CANDIDATES * 0.75)) break;
      }

      // Then round-robin across conversations. This prevents one verbose recent
      // thread from monopolizing the zero-overlap semantic fallback.
      const byConversation = new Map<string, Array<(typeof rankedCandidates)[number]>>();
      for (const entry of rankedCandidates) {
        if (semanticCandidateIds.has(entry.id)) continue;
        const group = byConversation.get(entry.conversationId);
        if (group) group.push(entry);
        else byConversation.set(entry.conversationId, [entry]);
      }
      const conversationGroups = [...byConversation.entries()]
        .sort(([leftId, left], [rightId, right]) =>
          (right[0]?.createdAt.getTime() ?? 0) - (left[0]?.createdAt.getTime() ?? 0)
          || leftId.localeCompare(rightId),
        )
        .map(([, entries]) => entries);
      let depth = 0;
      while (semanticCandidates.length < MAX_THREAD_CANDIDATES) {
        let added = false;
        for (const group of conversationGroups) {
          const entry = group[depth];
          if (!entry) continue;
          addSemanticCandidate(entry);
          added = true;
          if (semanticCandidates.length >= MAX_THREAD_CANDIDATES) break;
        }
        if (!added) break;
        depth += 1;
      }
      const semanticScores = await rankCandidatesSemantically(
        input.query,
        semanticCandidates.map((entry) => ({ id: entry.id, text: entry.text })),
        { allowPlatformEmbeddings: context.allowPlatformSemanticRanking },
      );
      const results = semanticCandidates
        .map((entry) => ({
          ...entry,
          semantic: semanticScores.get(entry.id) ?? 0,
        }))
        .filter((entry) =>
          entry.lexical > 0
          || entry.semantic >= REMOTE_SEMANTIC_MIN_SIMILARITY,
        )
        .sort((left, right) =>
          (right.lexical + right.semantic * 25) - (left.lexical + left.semantic * 25)
          || right.createdAt.getTime() - left.createdAt.getTime(),
        )
        .slice(0, input.limit ?? 8)
        .map(({ source, conversationId, title, messageId, sequence, role, createdAt, text }) => ({
          source,
          conversationId,
          title,
          ...(messageId ? { messageId } : {}),
          ...(sequence == null ? {} : { sequence }),
          ...(role ? { role } : {}),
          createdAt: createdAt.toISOString(),
          text: modelFacingSearchPreview(text, input.query),
        }));
      return { ok: true, query: input.query, results };
    },
  }));

  return {
    read_tool_result,
    search_tool_results,
    read_conversation_history,
    read_conversation_attachment,
    search_previous_threads,
  };
}
