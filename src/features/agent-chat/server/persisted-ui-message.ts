import "server-only";

import { redactSensitiveData } from "@/lib/security/sensitive-data-redaction";
import {
  validateAgentChatUIMessages,
  type AgentChatUIMessage,
} from "../shared/ui-message";

/**
 * Redact canonical message content without mutating opaque file transports.
 * Signed URLs and base64 data can contain secret-looking substrings by chance;
 * changing them makes later multimodal rehydration impossible. File metadata
 * is still redacted normally and model-facing projections omit the transport.
 */
export function redactPersistedAgentChatParts(parts: unknown): unknown {
  if (!Array.isArray(parts)) return redactSensitiveData(parts);
  return parts.map((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      return redactSensitiveData(part);
    }
    const record = part as Record<string, unknown>;
    if (record.type !== "file" || typeof record.url !== "string") {
      return redactSensitiveData(part);
    }
    const { url, ...metadata } = record;
    const redactedMetadata = redactSensitiveData(metadata);
    return {
      ...(redactedMetadata && typeof redactedMetadata === "object" && !Array.isArray(redactedMetadata)
        ? redactedMetadata as Record<string, unknown>
        : metadata),
      url,
    };
  });
}

/**
 * Minimal durable transcript shape. The Prisma enum intentionally uses the
 * exact AI SDK UIMessage role strings, so persistence does not need a second
 * role representation or a compatibility mapper.
 */
export type PersistedAgentChatMessageRow = {
  id: string;
  role: AgentChatUIMessage["role"];
  parts: unknown;
  metadata: unknown | null;
};

export function persistedAgentChatMessageInput(
  row: PersistedAgentChatMessageRow,
): unknown {
  return {
    id: row.id,
    role: row.role,
    parts: row.parts,
    ...(row.metadata == null ? {} : { metadata: row.metadata }),
  };
}

/**
 * The single database -> AI SDK boundary for canonical transcript rows.
 * Persisted JSON is never trusted through a cast: every row is validated as an
 * AgentChatUIMessage before application/model code can consume it.
 */
export async function validatePersistedAgentChatMessages(
  rows: readonly PersistedAgentChatMessageRow[],
): Promise<AgentChatUIMessage[]> {
  // A canonical transcript page may legitimately be empty (for example, a
  // newly-created thread before its first user message). AI SDK validates a
  // message *batch* as non-empty, so preserve that invariant for actual
  // messages while treating an empty database result as the valid empty page.
  if (rows.length === 0) return [];
  return validateAgentChatUIMessages(
    rows.map((row) => persistedAgentChatMessageInput(row)),
  );
}

export async function validatePersistedAgentChatMessage(
  row: PersistedAgentChatMessageRow,
): Promise<AgentChatUIMessage> {
  const [message] = await validatePersistedAgentChatMessages([row]);
  if (!message) {
    throw new Error("Persisted agent chat message validation returned no message");
  }
  return message;
}
