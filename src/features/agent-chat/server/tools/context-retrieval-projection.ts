import "server-only";

function headTailValue(value: unknown, maxChars = 1_500): unknown {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return value;
  const marker = "\n...[retrieved content omitted; re-run the source retrieval tool for exact detail]...\n";
  const half = Math.max(1, Math.floor((maxChars - marker.length) / 2));
  return {
    truncatedForPersistence: true,
    preview: `${text.slice(0, half)}${marker}${text.slice(-half)}`,
  };
}

function compactAttachmentReferences(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.messageId !== "string" || typeof item.partIndex !== "number") return [];
    return [{
      ...(typeof item.conversationId === "string" ? { conversationId: item.conversationId } : {}),
      messageId: item.messageId,
      partIndex: item.partIndex,
      ...(typeof item.mediaType === "string" ? { mediaType: item.mediaType } : {}),
      ...(typeof item.filename === "string" ? { filename: item.filename.slice(0, 255) } : {}),
      readTool: "read_conversation_attachment",
    }];
  });
}

/**
 * Collapse a context-retrieval result back to the identifiers needed to
 * reproduce it. Retrieval tools are projections over canonical artifacts or
 * messages, so persisting their full excerpts would create a second history
 * copy without improving recoverability.
 */
export function compactContextRetrievalResult(
  toolName: string,
  value: unknown,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return headTailValue(value);
  }
  const record = value as Record<string, unknown>;
  const base = {
    ...(record.ok === undefined ? {} : { ok: record.ok }),
    ...(typeof record.status === "string" ? { status: record.status } : {}),
  };

  if (toolName === "read_tool_result") {
    const matches = Array.isArray(record.matches)
      ? record.matches.slice(0, 8).flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          return [{ ...(typeof item.offset === "number" ? { offset: item.offset } : {}) }];
        })
      : undefined;
    return {
      ...base,
      ...(typeof record.artifactId === "string" ? { artifactId: record.artifactId } : {}),
      ...(typeof record.toolName === "string" ? { toolName: record.toolName } : {}),
      ...(typeof record.estimatedTokens === "number" ? { estimatedTokens: record.estimatedTokens } : {}),
      ...(record.stateChanging === true ? { stateChanging: true } : {}),
      ...(typeof record.offset === "number" ? { offset: record.offset } : {}),
      ...(typeof record.nextOffset === "number" || record.nextOffset === null
        ? { nextOffset: record.nextOffset }
        : {}),
      ...(typeof record.totalChars === "number" ? { totalChars: record.totalChars } : {}),
      ...(matches ? { matches } : {}),
      retrieval: "Re-run read_tool_result for this artifactId when exact content is needed again.",
    };
  }

  if (toolName === "search_tool_results") {
    const results = Array.isArray(record.results)
      ? record.results.slice(0, 12).flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          const artifactId = typeof item.artifactId === "string" ? item.artifactId : undefined;
          if (!artifactId) return [];
          return [{
            artifactId,
            ...(typeof item.toolName === "string" ? { toolName: item.toolName } : {}),
            ...(item.stateChanging === true ? { stateChanging: true } : {}),
            ...(typeof item.runId === "string" ? { runId: item.runId } : {}),
          }];
        })
      : [];
    return {
      ...base,
      ...(typeof record.query === "string" ? { query: record.query } : {}),
      results,
      retrieval: "Re-run search_tool_results or read a returned artifactId for exact content.",
    };
  }

  if (toolName === "read_conversation_history") {
    const message = record.message && typeof record.message === "object" && !Array.isArray(record.message)
      ? record.message as Record<string, unknown>
      : null;
    const messages = Array.isArray(record.messages)
      ? record.messages.slice(0, 24).flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          if (typeof item.id !== "string") return [];
          const attachments = compactAttachmentReferences(item.attachments);
          return [{
            id: item.id,
            ...(typeof item.sequence === "number" ? { sequence: item.sequence } : {}),
            ...(typeof item.role === "string" ? { role: item.role } : {}),
            ...(attachments.length > 0 ? { attachments } : {}),
          }];
        })
      : undefined;
    const messageAttachments = compactAttachmentReferences(message?.attachments);
    return {
      ...base,
      ...(typeof record.conversationId === "string" ? { conversationId: record.conversationId } : {}),
      ...(message
        ? {
            message: {
              ...(typeof message.id === "string" ? { id: message.id } : {}),
              ...(typeof message.sequence === "number" ? { sequence: message.sequence } : {}),
              ...(typeof message.role === "string" ? { role: message.role } : {}),
              ...(typeof message.offset === "number" ? { offset: message.offset } : {}),
              ...(typeof message.nextOffset === "number" || message.nextOffset === null
                ? { nextOffset: message.nextOffset }
                : {}),
              ...(typeof message.totalChars === "number" ? { totalChars: message.totalChars } : {}),
              ...(messageAttachments.length > 0 ? { attachments: messageAttachments } : {}),
            },
          }
        : {}),
      ...(messages ? { messages } : {}),
      ...(typeof record.nextBeforeSequence === "number" || record.nextBeforeSequence === null
        ? { nextBeforeSequence: record.nextBeforeSequence }
        : {}),
      retrieval: "Re-run read_conversation_history with a messageId/query when exact older thread content is needed again.",
    };
  }

  if (toolName === "read_conversation_attachment") {
    return {
      ...base,
      ...(typeof record.conversationId === "string" ? { conversationId: record.conversationId } : {}),
      ...(typeof record.messageId === "string" ? { messageId: record.messageId } : {}),
      ...(typeof record.partIndex === "number" ? { partIndex: record.partIndex } : {}),
      ...(typeof record.mediaType === "string" ? { mediaType: record.mediaType } : {}),
      ...(typeof record.filename === "string" ? { filename: record.filename.slice(0, 255) } : {}),
      retrieval: "Re-run read_conversation_attachment for this conversationId/messageId/partIndex when the exact file content is needed again.",
    };
  }

  if (toolName === "search_previous_threads") {
    const results = Array.isArray(record.results)
      ? record.results.slice(0, 12).flatMap((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
          const item = entry as Record<string, unknown>;
          if (typeof item.conversationId !== "string") return [];
          return [{
            conversationId: item.conversationId,
            ...(typeof item.source === "string" ? { source: item.source } : {}),
            ...(typeof item.messageId === "string" ? { messageId: item.messageId } : {}),
            ...(typeof item.title === "string" ? { title: item.title.slice(0, 240) } : {}),
            ...(typeof item.sequence === "number" ? { sequence: item.sequence } : {}),
          }];
        })
      : [];
    return {
      ...base,
      ...(typeof record.query === "string" ? { query: record.query } : {}),
      results,
      retrieval: "Re-run search_previous_threads for matching excerpts, then use read_conversation_history with a returned conversationId/messageId to recover exact prior-thread content.",
    };
  }

  return headTailValue(value);
}
