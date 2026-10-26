import "server-only";

import { randomUUID } from "node:crypto";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import type { AgentChatMessageMetadata } from "../../shared/ui-message";
import type { AppliedMcpContinuation } from "./mcp-continuation";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function containsContinuationId(value: unknown, continuationId: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsContinuationId(entry, continuationId));
  }
  const record = asRecord(value);
  if (!record) return false;
  if (record.continuationId === continuationId) return true;
  return Object.values(record).some((entry) =>
    containsContinuationId(entry, continuationId),
  );
}

function findPendingToolPart(
  parts: readonly unknown[],
  continuationId: string,
): Record<string, unknown> | null {
  for (const part of parts) {
    const record = asRecord(part);
    if (!record || !containsContinuationId(record.output, continuationId)) {
      continue;
    }
    return record;
  }
  return null;
}

function toolName(part: Record<string, unknown>): string {
  if (typeof part.toolName === "string" && part.toolName) return part.toolName;
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }
  return "mcp_operation";
}

/**
 * Return a successful UI stream without invoking an LLM when an MCP operation
 * immediately asks for another round of human input. The durable canonical
 * assistant UIMessage has already been patched; this response mirrors that
 * pending tool card to the active browser so the agent remains stopped.
 */
export function createMcpInputRequiredResponse(params: {
  applied: AppliedMcpContinuation;
  modelKey: string;
}): Response {
  const pendingPart = findPendingToolPart(
    params.applied.parts,
    params.applied.result &&
      typeof params.applied.result === "object" &&
      !Array.isArray(params.applied.result) &&
      typeof (params.applied.result as Record<string, unknown>).continuationId === "string"
      ? ((params.applied.result as Record<string, unknown>).continuationId as string)
      : "",
  );
  const output = pendingPart?.output ?? params.applied.result;
  const toolCallId =
    typeof pendingPart?.toolCallId === "string"
      ? pendingPart.toolCallId
      : `mcp-continuation:${randomUUID()}`;
  const name = pendingPart ? toolName(pendingPart) : "mcp_operation";
  const input = pendingPart?.input ?? {};
  const now = new Date().toISOString();
  const metadata: AgentChatMessageMetadata = {
    modelKey: params.modelKey,
    createdAt: now,
    completedAt: now,
  };

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({
        type: "start",
        messageId: params.applied.id,
        messageMetadata: metadata,
      });
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: name,
        input,
        dynamic: true,
      });
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output,
        dynamic: true,
      });
      writer.write({ type: "finish", messageMetadata: metadata });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
