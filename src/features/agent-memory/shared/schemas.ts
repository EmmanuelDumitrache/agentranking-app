import { z } from "zod";
import {
  AGENT_MEMORY_FACT_KINDS,
  AGENT_MEMORY_FACT_STATUSES,
  AGENT_MEMORY_MAX_EXTRACT_PER_TURN,
} from "./types";

export const memoryFactKindSchema = z.enum(AGENT_MEMORY_FACT_KINDS);
export const memoryFactStatusSchema = z.enum(AGENT_MEMORY_FACT_STATUSES);
export const memoryFactIdSchema = z.string().trim().min(1).max(128);
export const memoryKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/, "Memory key must be a lowercase stable dotted identifier");

export const createMemoryFactSchema = z
  .object({
    kind: memoryFactKindSchema.default("preference"),
    content: z.string().trim().min(3).max(500),
    pinned: z.boolean().optional(),
  })
  .strict();

export const updateMemoryFactSchema = z
  .object({
    kind: memoryFactKindSchema.optional(),
    content: z.string().trim().min(3).max(500).optional(),
    status: memoryFactStatusSchema.optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one memory update is required",
  });

export const updateMemorySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    requireApproval: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one memory setting is required",
  });

export const memoryExtractPayloadSchema = z
  .object({
    v: z.literal(2),
    sourceMessageId: z.string().min(1).max(128),
    sourceRunId: z.string().min(1).max(128),
    agentDbId: z.number().int().positive(),
    conversationId: z.string().min(1).max(128),
    appAccountId: z.string().min(1).max(128),
  })
  .strict();
export type MemoryExtractPayload = z.infer<typeof memoryExtractPayloadSchema>;

const memoryOperationSchema = z
  .object({
    action: z.enum(["upsert", "forget"]),
    key: memoryKeySchema,
    kind: memoryFactKindSchema.optional(),
    content: z.string().trim().min(3).max(500).optional(),
    confidence: z.number().min(0).max(1).default(0.8),
    salience: z.number().min(0).max(1).default(0.5),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "upsert" && (!value.kind || !value.content)) {
      ctx.addIssue({
        code: "custom",
        message: "Upsert operations require kind and content",
      });
    }
    if (value.action === "forget" && (value.kind || value.content)) {
      ctx.addIssue({
        code: "custom",
        message: "Forget operations contain only action and key",
      });
    }
  });

export const memoryExtractResultSchema = z
  .object({
    operations: z.array(memoryOperationSchema).max(AGENT_MEMORY_MAX_EXTRACT_PER_TURN),
  })
  .strict();
