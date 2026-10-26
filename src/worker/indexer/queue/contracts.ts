import { z } from "zod";
const positiveInt = z.number().int().positive().safe();
const nonNegativeSafeInt = z.number().int().nonnegative().safe();
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const sourceGenerationFields = {
  registryAddress: evmAddress.optional(),
  registryGeneration: z.string().min(1).max(256).optional(),
  configurationGeneration: z.string().min(1).max(256).optional(),
} as const;
const uint256Decimal = z.string().regex(/^(?:0|[1-9][0-9]*)$/).max(78);
const sourceSnapshotSchema = z.object({
  finality: z.enum(["pending", "observed", "safe", "finalized"]).optional(),
  blockNumber: uint256Decimal.optional(),
  blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  transactionIndex: z.number().int().nonnegative().safe().optional(),
  logIndex: z.number().int().nonnegative().safe().optional(),
  // Event-originated jobs carry the registration provenance already reduced and
  // persisted by the identity scanner. Older/manual jobs omit it and fall back to
  // the durable observation lookup in the consumer.
  registeredOwner: evmAddress.nullable().optional(),
  registryGeneration: z.string().min(1).max(256).optional(),
  configurationGeneration: z.string().min(1).max(256).optional(),
}).strict();
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;
export const bootstrapAdvancePayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  reason: z.string().min(1).max(256),
}).strict();
export type BootstrapAdvancePayload = z.infer<typeof bootstrapAdvancePayloadSchema>;
export const derivedFinalizePayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  epochId: z.string().min(1).max(128),
  topologyHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type DerivedFinalizePayload = z.infer<typeof derivedFinalizePayloadSchema>;
export const indexerScanPayloadSchema = z.union([
  z.object({ v: z.literal(1) }).strict().transform(() => ({ v: 2 as const, generation: undefined })),
  z.object({ v: z.literal(2), semanticGeneration: z.string().min(1).max(128).optional(), generation: uint256Decimal.optional() }).strict(),
]);
export type IndexerScanPayload = z.infer<typeof indexerScanPayloadSchema>;
export const agentSyncPayloadSchema = z.union([
  z.object({
    v: z.literal(1),
    chainId: positiveInt,
    agentId: nonNegativeSafeInt,
    source: z.string().min(1).max(80).optional(),
  }).strict().transform((value) => ({ ...value, v: 2 as const, agentId: String(value.agentId), sourceSnapshot: undefined, executionKey: undefined })),
  z.object({
    v: z.literal(2),
    semanticGeneration: z.string().min(1).max(128).optional(),
    chainId: positiveInt,
    agentId: uint256Decimal,
    source: z.string().min(1).max(80).optional(),
    sourceSnapshot: sourceSnapshotSchema.optional(),
    executionKey: z.string().min(1).max(128).optional(),
  }).strict(),
]);
export type AgentSyncPayload = z.infer<typeof agentSyncPayloadSchema>;
export const chainCatchupPayloadSchema = z.union([
  z.object({ v: z.literal(1), chainId: positiveInt, maxBlocks: positiveInt.optional() }).strict()
    .transform((value) => ({ ...value, v: 2 as const, requestedGeneration: undefined, continuationFromBlock: undefined, registryAddress: undefined, registryGeneration: undefined, configurationGeneration: undefined })),
  z.object({
    v: z.literal(2),
    semanticGeneration: z.string().min(1).max(128).optional(),
    chainId: positiveInt,
    maxBlocks: positiveInt.optional(),
    requestedGeneration: uint256Decimal.optional(),
    continuationFromBlock: uint256Decimal.optional(),
    ...sourceGenerationFields,
  }).strict(),
]);
export type ChainCatchupPayload = z.infer<typeof chainCatchupPayloadSchema>;
export const identityRangePayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  leaseId: z.string().min(1).max(128),
  revision: z.number().int().nonnegative().safe(),
  sourceKey: z.string().min(1).max(512),
  chainId: positiveInt,
  registryAddress: evmAddress,
  registryGeneration: z.string().min(1).max(256),
  configurationGeneration: z.string().min(1).max(256),
  requestedGeneration: uint256Decimal.optional(),
  fromBlock: uint256Decimal,
  toBlock: uint256Decimal,
  targetBlock: uint256Decimal,
  finalityPolicy: z.string().min(1).max(128),
}).strict();
export type IdentityRangePayload = z.infer<typeof identityRangePayloadSchema>;
export const feedbackSyncPayloadSchema = z.union([
  z.object({ v: z.literal(1), chainId: positiveInt }).strict()
    .transform((value) => ({ ...value, v: 2 as const, requestedGeneration: undefined, registryAddress: undefined, registryGeneration: undefined, configurationGeneration: undefined })),
  z.object({ v: z.literal(2), semanticGeneration: z.string().min(1).max(128).optional(), chainId: positiveInt, requestedGeneration: uint256Decimal.optional(), ...sourceGenerationFields }).strict(),
]);
export type FeedbackSyncPayload = z.infer<typeof feedbackSyncPayloadSchema>;
export const validationSyncPayloadSchema = z.union([
  z.object({ v: z.literal(1), chainId: positiveInt, maxBlocks: positiveInt.optional() }).strict()
    .transform((value) => ({ ...value, v: 2 as const, requestedGeneration: undefined, continuationFromBlock: undefined, registryAddress: undefined, registryGeneration: undefined, configurationGeneration: undefined })),
  z.object({
    v: z.literal(2),
    semanticGeneration: z.string().min(1).max(128).optional(),
    chainId: positiveInt,
    maxBlocks: positiveInt.optional(),
    requestedGeneration: uint256Decimal.optional(),
    continuationFromBlock: uint256Decimal.optional(),
    ...sourceGenerationFields,
  }).strict(),
]);
export type ValidationSyncPayload = z.infer<typeof validationSyncPayloadSchema>;
export const solana8004SnapshotPayloadSchema = z.union([
  z.object({ v: z.literal(1) }).strict().transform(() => ({ v: 2 as const, requestedGeneration: undefined })),
  z.object({
    v: z.literal(2),
    semanticGeneration: z.string().min(1).max(128).optional(),
    requestedGeneration: uint256Decimal.optional(),
  }).strict(),
]);
export type Solana8004SnapshotPayload = z.infer<typeof solana8004SnapshotPayloadSchema>;
export const solana8004TrustScanPayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  requestedGeneration: uint256Decimal.optional(),
  executionKey: z.string().min(1).max(256).optional(),
}).strict();
export type Solana8004TrustScanPayload = z.infer<typeof solana8004TrustScanPayloadSchema>;
export const solana8004TrustSyncPayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  signature: z.string().min(64).max(100),
  slot: uint256Decimal,
}).strict();
export type Solana8004TrustSyncPayload = z.infer<typeof solana8004TrustSyncPayloadSchema>;
export const metaplexSnapshotPayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
}).strict();
export type MetaplexSnapshotPayload = z.infer<typeof metaplexSnapshotPayloadSchema>;
export const clusterReconcilePayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  chainId: positiveInt,
  agentId: positiveInt,
  sourceObservationKey: z.string().min(1).max(512).optional(),
}).strict();
export type ClusterReconcilePayload = z.infer<typeof clusterReconcilePayloadSchema>;
export const solanaMetadataPayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  asset: z.string().min(32).max(64),
  uri: z.string().min(1).max(4_096),
}).strict();
export type SolanaMetadataPayload = z.infer<typeof solanaMetadataPayloadSchema>;
export const agentMetadataPayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  chainId: positiveInt,
  agentId: uint256Decimal,
  uri: z.string().min(1).max(4_096),
}).strict();
export type AgentMetadataPayload = z.infer<typeof agentMetadataPayloadSchema>;
export const registrationRefreshScanPayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
}).strict();
export type RegistrationRefreshScanPayload = z.infer<typeof registrationRefreshScanPayloadSchema>;
export const scoreRecalculatePayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  agentId: positiveInt,
  requestedVersion: uint256Decimal.optional(),
}).strict();
export type ScoreRecalculatePayload = z.infer<typeof scoreRecalculatePayloadSchema>;
export const scoreRepairScanPayloadSchema = z.object({
  v: z.literal(1),
  semanticGeneration: z.string().min(1).max(128).optional(),
  afterAgentId: nonNegativeSafeInt.optional(),
}).strict();
export type ScoreRepairScanPayload = z.infer<typeof scoreRepairScanPayloadSchema>;
