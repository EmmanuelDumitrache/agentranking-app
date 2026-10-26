import {
  isToolUIPart,
  isTextUIPart,
  validateUIMessages,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
  type UITool,
} from "ai";
import { z } from "zod";

export const agentChatMessageMetadataSchema = z
  .object({
    createdAt: z.string().datetime(),
    runId: z.string().trim().min(1).max(128).optional(),
    modelKey: z.string().trim().min(1).max(256).optional(),
    requestedModelKey: z.string().trim().min(1).max(256).optional(),
    fallbackUsed: z.boolean().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export const agentChatRunDataSchema = z
  .object({
    runId: z.string().trim().min(1).max(128),
    modelKey: z.string().trim().min(1).max(256),
    reservedCents: z.number().int().nonnegative(),
  })
  .strict();

export const agentChatNoticeDataSchema = z
  .object({
    level: z.enum(["info", "warning", "error"]),
    code: z.string().trim().min(1).max(128),
    message: z.string().min(1).max(4_000),
  })
  .strict();

export const agentChatDataSchemas = {
  run: agentChatRunDataSchema,
  notice: agentChatNoticeDataSchema,
} as const;

export type AgentChatMessageMetadata = z.infer<
  typeof agentChatMessageMetadataSchema
>;
export type AgentChatDataParts = {
  run: z.infer<typeof agentChatRunDataSchema>;
  notice: z.infer<typeof agentChatNoticeDataSchema>;
};
export type AgentChatUITool = UITool;
export type AgentChatUITools = Record<string, AgentChatUITool>;
export type AgentChatUIMessage = UIMessage<
  AgentChatMessageMetadata,
  AgentChatDataParts,
  AgentChatUITools
>;
export type AgentChatUIPart = AgentChatUIMessage["parts"][number];
export type AgentChatToolUIPart =
  | ToolUIPart<AgentChatUITools>
  | DynamicToolUIPart;

export async function validateAgentChatUIMessages(
  messages: unknown[],
): Promise<AgentChatUIMessage[]> {
  return validateUIMessages<AgentChatUIMessage>({
    messages: messages as AgentChatUIMessage[],
    metadataSchema: agentChatMessageMetadataSchema,
    dataSchemas: agentChatDataSchemas,
  });
}

/** Extract all user-visible text parts from a typed AI SDK UI message. */
export function extractTextContent(
  message: Pick<AgentChatUIMessage, "parts">,
): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");
}

function containsMcpInputRequired(value: unknown, budget: { nodes: number }): boolean {
  if (budget.nodes <= 0) return false;
  budget.nodes -= 1;
  if (Array.isArray(value)) {
    return value.some((entry) => containsMcpInputRequired(entry, budget));
  }
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    record.status === "input_required" &&
    typeof record.continuationId === "string" &&
    record.continuationId.length > 0
  ) {
    return true;
  }
  return Object.values(record).some((entry) =>
    containsMcpInputRequired(entry, budget),
  );
}

/**
 * Whether this canonical assistant UI message still represents an incomplete
 * human-in-the-loop turn. Such a message must remain verbatim model context
 * and must not finalize turn-scoped memory extraction yet.
 */
export function messageRequiresContinuation(
  message: Pick<AgentChatUIMessage, "role" | "parts">,
): boolean {
  if (message.role !== "assistant") return false;
  for (const part of message.parts) {
    if (!isToolUIPart(part)) continue;
    if (part.state === "approval-requested") return true;
    if (
      "output" in part &&
      containsMcpInputRequired(part.output, { nodes: 2_000 })
    ) {
      return true;
    }
  }
  return false;
}
