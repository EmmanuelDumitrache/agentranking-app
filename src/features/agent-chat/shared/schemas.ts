import { z } from "zod";
import type { AgentChatUIMessage } from "./ui-message";

const idSchema = z.string().trim().min(1).max(128);
export const entityIdSchema = idSchema;
const nullableText = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]);
const inboundUserMessageSchema = z.custom<AgentChatUIMessage>(
  (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  "Message must be an object",
);
const agentChatUserMessageRequestSchema = z
  .object({
    kind: z.literal("message").optional(),
    conversationId: idSchema,
    requestId: idSchema,
    triggerKind: z.enum(["USER_MESSAGE", "REGENERATE"]).optional(),
    modelKey: z.string().trim().min(1).max(256),
    message: inboundUserMessageSchema,
    uiMode: z.enum(["chat", "terminal"]).optional(),
  })
  .strict();

const toolApprovalResponseSchema = z
  .object({
    id: idSchema,
    approved: z.boolean(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const agentChatToolApprovalRequestSchema = z
  .object({
    kind: z.literal("tool-approval"),
    conversationId: idSchema,
    requestId: idSchema,
    modelKey: z.string().trim().min(1).max(256),
    assistantUiMessageId: idSchema,
    approvals: z.array(toolApprovalResponseSchema).min(1).max(32),
    uiMode: z.enum(["chat", "terminal"]).optional(),
  })
  .strict();

const mcpContinuationPrimitiveSchema = z.union([
  z.string().max(32_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(32_000)).max(100),
  z.array(z.number().finite()).max(100),
  z.array(z.boolean()).max(100),
]);

export const mcpContinuationResponseSchema = z
  .object({
    // MCP input-required request keys are opaque protocol/application values,
    // not AgentRanking entity IDs. Keep them bounded without imposing the
    // shorter entity-id envelope used by conversation/run identifiers.
    requestKey: z.string().min(1).max(1_024),
    action: z.enum(["accept", "decline", "cancel"]),
    content: z.record(z.string().max(1_024), mcpContinuationPrimitiveSchema).optional(),
  })
  .strict();

const agentChatMcpContinuationRequestSchema = z
  .object({
    kind: z.literal("mcp-continuation"),
    conversationId: idSchema,
    requestId: idSchema,
    modelKey: z.string().trim().min(1).max(256),
    continuationId: idSchema,
    responses: z.array(mcpContinuationResponseSchema).min(1).max(32),
    uiMode: z.enum(["chat", "terminal"]).optional(),
  })
  .strict();

export const agentChatStreamRequestSchema = z.union([
  agentChatUserMessageRequestSchema,
  agentChatToolApprovalRequestSchema,
  agentChatMcpContinuationRequestSchema,
]);
export const createConversationSchema = z
  .object({
    modelKey: z.string().trim().min(1).max(256),
    titleSeed: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.status !== undefined, {
    message: "At least one update is required",
  });
export const updateSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    persona: nullableText(2_000).optional(),
    systemInstructions: nullableText(8_000).optional(),
    greeting: nullableText(1_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting is required",
  });
export const conversationListQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const messageListQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const agentDbIdSchema = z.coerce.number().int().positive();