import { z } from "zod";
export const emptyJobPayloadSchema = z.object({ v: z.literal(1) });
export type EmptyJobPayload = z.infer<typeof emptyJobPayloadSchema>;
export const agentDeactivationDuePayloadSchema = z.object({
  v: z.literal(1),
  agentId: z.number().int().positive(),
  lastActiveAt: z.string().datetime(),
});
export type AgentDeactivationDuePayload = z.infer<typeof agentDeactivationDuePayloadSchema>;
export const idPayloadSchema = z.object({ v: z.literal(1), id: z.string().min(1) });
export const numericIdPayloadSchema = z.object({ v: z.literal(1), id: z.number().int().positive() });
export const endpointCheckPayloadSchema = z.object({
  v: z.literal(1),
  agentId: z.number().int().positive(),
  serviceId: z.number().int().positive(),
});
export const partnerJobSyncPayloadSchema = z.object({
  v: z.literal(1),
  source: z.enum(["earnfi", "wurk"]),
});
export const metaplexIndexPayloadSchema = z.object({
  v: z.literal(1),
  assetAddress: z.string().trim().min(1),
});
export type MetaplexIndexPayload = z.infer<typeof metaplexIndexPayloadSchema>;
export const metaplexDiscoverPayloadSchema = z.object({
  v: z.literal(1),
  limit: z.number().int().positive().max(200).default(50),
  dryRun: z.boolean().default(false),
});
export type MetaplexDiscoverPayload = z.infer<typeof metaplexDiscoverPayloadSchema>;
export const metaplexReindexPayloadSchema = z.object({
  v: z.literal(1),
  limit: z.number().int().positive().max(100).default(100),
  staleHours: z.number().positive().max(24 * 365).default(4),
  dryRun: z.boolean().default(false),
});
export type MetaplexReindexPayload = z.infer<typeof metaplexReindexPayloadSchema>;
export const githubWebhookPayloadSchema = z.object({
  v: z.literal(1),
  deliveryId: z.string().trim().min(1).max(200),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  event: z.string().trim().min(1).max(100),
  action: z.string().trim().max(100).nullable().default(null),
  installationId: z.string().trim().max(100).nullable().default(null),
  repositories: z.array(z.object({
    fullName: z.string().trim().min(1).max(300),
    repoId: z.string().trim().max(100).nullable().default(null),
  })).max(1_000).default([]),
  removedRepositories: z.array(z.object({
    fullName: z.string().trim().min(1).max(300),
    repoId: z.string().trim().max(100).nullable().default(null),
  })).max(1_000).default([]),
  repositoryFullName: z.string().trim().max(300).nullable().default(null),
});
export type GithubWebhookPayload = z.infer<typeof githubWebhookPayloadSchema>;
export const conversionEventPayloadSchema = z.object({
  v: z.literal(1),
  idempotencyKey: z.string().min(1).max(128),
  eventType: z.string().min(1).max(100),
  path: z.string().max(500).default(""),
  productType: z.string().max(200).nullable().optional(),
});
export type ConversionEventPayload = z.infer<typeof conversionEventPayloadSchema>;
export const subscriptionReferralPayloadSchema = z.object({
  v: z.literal(1),
  providerEventId: z.string().min(1),
  wallet: z.string(),
  email: z.string(),
});
export const activityItemSchema = z.object({
  type: z.enum(["buy", "sell", "unknown"]),
  token: z.string(),
  amount: z.number().finite(),
  timestamp: z.string().datetime(),
  success: z.boolean(),
  txSignatureOrHash: z.string(),
  nativeAmount: z.number().finite(),
});
export const agentActivityPersistPayloadSchema = z.object({
  v: z.literal(1),
  agentId: z.number().int().positive(),
  walletChainId: z.number().int(),
  verifiedWallet: z.string().min(1),
  fetchedAt: z.string().datetime(),
  activity: z.array(activityItemSchema).max(100),
});
export type AgentActivityPersistPayload = z.infer<typeof agentActivityPersistPayloadSchema>;
export const launchFeeScanPayloadSchema = z.object({
  v: z.literal(1),
  mode: z.enum(["scheduled", "manual"]),
});
export type LaunchFeeScanPayload = z.infer<typeof launchFeeScanPayloadSchema>;
export const launchFeeDistributionPayloadSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  mode: z.enum(["standard", "recovery"]).default("standard"),
});
export const launchFeeReconcilePayloadSchema = z.object({
  v: z.literal(1),
  attemptId: z.string().min(1),
});
export const fairscaleAssessmentPayloadSchema = z.object({
  v: z.literal(1),
  agentDbId: z.number().int().positive(),
});
export type FairscaleAssessmentPayload = z.infer<typeof fairscaleAssessmentPayloadSchema>;
export const inferenceProviderPayloadSchema = z.object({
  v: z.literal(1),
  providerId: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
});
export type InferenceProviderPayload = z.infer<typeof inferenceProviderPayloadSchema>;
export { memoryExtractPayloadSchema } from "@/features/agent-memory/shared/schemas";
export type { MemoryExtractPayload } from "@/features/agent-memory/shared/schemas";
