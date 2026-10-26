import { SOLANA_8004_MAINNET_PROGRAM_ID, SOLANA_8004_PINNED_IDL_SHA256 } from "./sync/solana-8004/constants.js";
import { z } from "zod";
const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();
const fractionalDecrease = z.coerce.number().gt(0).lt(1);
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  WORKER_LOOP_INTERVAL_MS: positiveInt.default(2500),
  WORKER_MAX_ATTEMPTS: positiveInt.default(6),
  WORKER_RETRY_BASE_MS: positiveInt.default(8000),
  INDEXER_BOOTSTRAP_STRICT: z.string().default("0"),
  INDEXER_BOOTSTRAP_SOURCE_GRACE_MS: positiveInt.default(900_000),
  INDEXER_BOOTSTRAP_METADATA_GRACE_MS: positiveInt.default(1_800_000),
  CATCHUP_CRON: z.string().min(1).default("*/15 * * * *"),
  VALIDATION_SYNC_CRON: z.string().min(1).default("2,17,32,47 * * * *"),
  CATCHUP_MAX_BLOCKS: positiveInt.default(5000),
  CATCHUP_GETLOGS_CHUNK_MAX: positiveInt.default(2500),
  WORKER_AGENT_SYNC_BACKLOG_TARGET: positiveInt.default(500),
  WORKER_AGENT_SYNC_CHAIN_BACKLOG_TARGET: positiveInt.default(100),
  WORKER_MAX_BLOCK_CHUNKS_PER_JOB: positiveInt.default(4),
  WORKER_MAX_VALIDATION_CHUNKS_PER_JOB: positiveInt.default(4),
  EVM_IDENTITY_RANGE_BLOCKS: positiveInt.default(10_000),
  EVM_IDENTITY_RANGE_PREFETCH: positiveInt.max(64).default(4),
  EVM_RANGE_LEASE_TTL_MS: positiveInt.default(900_000),
  EVM_RANGE_LEASE_HEARTBEAT_MS: positiveInt.default(30_000),
  FEEDBACK_SYNC_CRON: z.string().min(1).default("5,20,35,50 * * * *"),
  FEEDBACK_SYNC_BATCH_SIZE: positiveInt.default(250),
  SOLANA_8004_SNAPSHOT_CRON: z.string().min(1).default("*/15 * * * *"),
  SOLANA_8004_TRUST_CRON: z.string().min(1).default("*/5 * * * *"),
  SOLANA_8004_TRUST_START_SLOT: z.string().regex(/^(0|[1-9][0-9]*)$/).default("0"),
  SOLANA_8004_TRUST_PAGE_SIZE: positiveInt.max(1_000).default(1_000),
  SOLANA_8004_TRUST_TX_BATCH_SIZE: positiveInt.max(1_000).default(100),
  SOLANA_8004_PROGRAM_ID: z.string().min(32).default(SOLANA_8004_MAINNET_PROGRAM_ID),
  SOLANA_8004_IDL_SHA256: z.string().regex(/^[0-9a-f]{64}$/).default(SOLANA_8004_PINNED_IDL_SHA256),
  SOLANA_8004_RPC_URLS: z.string().optional(),
  METAPLEX_SNAPSHOT_CRON: z.string().min(1).default("47 */6 * * *"),
  METAPLEX_RPC_COMMITMENT: z.literal("finalized").default("finalized"),
  METAPLEX_DISCOVERY_MODE: z.literal("program_accounts").default("program_accounts"),
  METAPLEX_DAS_ENABLED: z.string().default("false"),
  METAPLEX_DAS_BATCH_ENABLED: z.string().default("true"),
  METAPLEX_DAS_BATCH_SIZE: positiveInt.max(1000).default(1000),
  RPC_ADAPTIVE_MIN_INFLIGHT: positiveInt.default(1),
  RPC_AIMD_SUCCESS_WINDOW: positiveInt.default(32),
  RPC_AIMD_DECREASE_FACTOR: fractionalDecrease.default(0.5),
  EVM_RPC_DEFAULT_MAX_INFLIGHT: positiveInt.default(8),
  SOLANA_RPC_DEFAULT_MAX_INFLIGHT: positiveInt.default(8),
  METADATA_ORIGIN_DEFAULT_MAX_INFLIGHT: positiveInt.default(4),
  RESOURCE_LEASE_TTL_MS: positiveInt.default(30_000),
  RESOURCE_LEASE_HEARTBEAT_MS: positiveInt.default(10_000),
  RESOURCE_LEASE_ACQUIRE_POLL_MS: positiveInt.default(100),
  RPC_WEIGHTED_INTERVAL_CAP: positiveInt.default(64),
  RPC_RETRY_MAX_PROVIDER_SWITCHES: nonNegativeInt.default(64),
  RPC_RETRY_MAX_ELAPSED_MS: positiveInt.default(300_000),
  RPC_RETRY_MAX_CUMULATIVE_DELAY_MS: positiveInt.default(300_000),
  RPC_RETRY_MAX_CUMULATIVE_WEIGHT: positiveInt.default(50_000),
  RPC_REQUEST_TIMEOUT_MS: positiveInt.default(30_000),
  INFURA_RPC_INTERVAL_CAP: positiveInt.default(8),
  INFURA_RPC_INTERVAL_MS: positiveInt.default(1_000),
  PUBLIC_RPC_INTERVAL_CAP: nonNegativeInt.default(12),
  PUBLIC_RPC_INTERVAL_MS: positiveInt.default(1_000),
  PUBLIC_RPC_PROVIDERS_ENABLED: z.string().default("true"),
  PUBLIC_RPC_MAX_PER_CHAIN: nonNegativeInt.default(0),
  RPC_HEALTH_PROBE_INTERVAL_MS: positiveInt.default(300_000),
  RPC_HEALTH_PROBE_TIMEOUT_MS: positiveInt.default(10_000),
  RPC_HEALTH_PROBE_ARCHIVE: z.string().default("true"),
  RPC_FINALITY_MAX_PROVIDERS: positiveInt.default(5),
  IPFS_API_URL: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "IPFS_API_URL must use http:// or https://").optional(),
  IPFS_API_BEARER_TOKEN: z.string().min(1).optional(),
  IPFS_API_ALLOW_PRIVATE_HTTP_TUNNEL: z.string().default("false"),
  IPFS_RPC_READ_TIMEOUT_MS: positiveInt.max(120_000).default(22_000),
  IPFS_RPC_MAX_RESPONSE_BYTES: positiveInt.max(16_777_216).default(1_048_576),
  REGISTRATION_CACHE_MAX_BYTES: positiveInt.max(536_870_912).default(67_108_864),
  METADATA_DNS_CACHE_TTL_MS: positiveInt.default(60_000),
});
const env = schema.parse(process.env);
if (env.RESOURCE_LEASE_HEARTBEAT_MS >= env.RESOURCE_LEASE_TTL_MS) {
  throw new Error("RESOURCE_LEASE_HEARTBEAT_MS must be less than RESOURCE_LEASE_TTL_MS");
}
if (env.EVM_RANGE_LEASE_HEARTBEAT_MS >= env.EVM_RANGE_LEASE_TTL_MS) {
  throw new Error("EVM_RANGE_LEASE_HEARTBEAT_MS must be less than EVM_RANGE_LEASE_TTL_MS");
}
if (env.RPC_ADAPTIVE_MIN_INFLIGHT > env.EVM_RPC_DEFAULT_MAX_INFLIGHT) {
  throw new Error("RPC_ADAPTIVE_MIN_INFLIGHT cannot exceed EVM_RPC_DEFAULT_MAX_INFLIGHT");
}
if (env.RPC_ADAPTIVE_MIN_INFLIGHT > env.SOLANA_RPC_DEFAULT_MAX_INFLIGHT) {
  throw new Error("RPC_ADAPTIVE_MIN_INFLIGHT cannot exceed SOLANA_RPC_DEFAULT_MAX_INFLIGHT");
}
if (
  process.env.NODE_ENV === "production" &&
  env.IPFS_API_URL &&
  (!env.IPFS_API_BEARER_TOKEN || env.IPFS_API_BEARER_TOKEN.length < 32)
) {
  throw new Error(
    "IPFS_API_BEARER_TOKEN must contain at least 32 characters when IPFS_API_URL is configured in production",
  );
}
export const config = {
  loopIntervalMs: env.WORKER_LOOP_INTERVAL_MS,
  maxAttempts: env.WORKER_MAX_ATTEMPTS,
  retryBaseMs: env.WORKER_RETRY_BASE_MS,
  bootstrapStrict: env.INDEXER_BOOTSTRAP_STRICT === "1",
  bootstrapSourceGraceMs: env.INDEXER_BOOTSTRAP_SOURCE_GRACE_MS,
  bootstrapMetadataGraceMs: env.INDEXER_BOOTSTRAP_METADATA_GRACE_MS,
  catchupCron: env.CATCHUP_CRON,
  validationSyncCron: env.VALIDATION_SYNC_CRON,
  catchupMaxBlocks: env.CATCHUP_MAX_BLOCKS,
  catchupGetLogsChunkMax: env.CATCHUP_GETLOGS_CHUNK_MAX,
  agentSyncBacklogTarget: env.WORKER_AGENT_SYNC_BACKLOG_TARGET,
  agentSyncChainBacklogTarget: env.WORKER_AGENT_SYNC_CHAIN_BACKLOG_TARGET,
  maxBlockChunksPerJob: env.WORKER_MAX_BLOCK_CHUNKS_PER_JOB,
  maxValidationChunksPerJob: env.WORKER_MAX_VALIDATION_CHUNKS_PER_JOB,
  evmIdentityRangeBlocks: env.EVM_IDENTITY_RANGE_BLOCKS,
  evmIdentityRangePrefetch: env.EVM_IDENTITY_RANGE_PREFETCH,
  evmRangeLeaseTtlMs: env.EVM_RANGE_LEASE_TTL_MS,
  evmRangeLeaseHeartbeatMs: env.EVM_RANGE_LEASE_HEARTBEAT_MS,
  feedbackSyncCron: env.FEEDBACK_SYNC_CRON,
  feedbackSyncBatchSize: env.FEEDBACK_SYNC_BATCH_SIZE,
  solana8004SnapshotCron: env.SOLANA_8004_SNAPSHOT_CRON,
  solana8004TrustCron: env.SOLANA_8004_TRUST_CRON,
  solana8004TrustStartSlot: BigInt(env.SOLANA_8004_TRUST_START_SLOT),
  solana8004TrustPageSize: env.SOLANA_8004_TRUST_PAGE_SIZE,
  solana8004TrustTxBatchSize: env.SOLANA_8004_TRUST_TX_BATCH_SIZE,
  solana8004ProgramId: env.SOLANA_8004_PROGRAM_ID,
  solana8004IdlSha256: env.SOLANA_8004_IDL_SHA256,
  solana8004RpcUrls: env.SOLANA_8004_RPC_URLS,
  metaplexSnapshotCron: env.METAPLEX_SNAPSHOT_CRON,
  metaplexRpcCommitment: env.METAPLEX_RPC_COMMITMENT,
  metaplexDiscoveryMode: env.METAPLEX_DISCOVERY_MODE,
  metaplexDasEnabled: env.METAPLEX_DAS_ENABLED === "true",
  metaplexDasBatchEnabled: env.METAPLEX_DAS_BATCH_ENABLED !== "false",
  metaplexDasBatchSize: env.METAPLEX_DAS_BATCH_SIZE,
  rpcAdaptiveMinInflight: env.RPC_ADAPTIVE_MIN_INFLIGHT,
  rpcAimdSuccessWindow: env.RPC_AIMD_SUCCESS_WINDOW,
  rpcAimdDecreaseFactor: env.RPC_AIMD_DECREASE_FACTOR,
  evmRpcDefaultMaxInflight: env.EVM_RPC_DEFAULT_MAX_INFLIGHT,
  solanaRpcDefaultMaxInflight: env.SOLANA_RPC_DEFAULT_MAX_INFLIGHT,
  metadataOriginDefaultMaxInflight: env.METADATA_ORIGIN_DEFAULT_MAX_INFLIGHT,
  resourceLeaseTtlMs: env.RESOURCE_LEASE_TTL_MS,
  resourceLeaseHeartbeatMs: env.RESOURCE_LEASE_HEARTBEAT_MS,
  resourceLeaseAcquirePollMs: env.RESOURCE_LEASE_ACQUIRE_POLL_MS,
  rpcWeightedIntervalCap: env.RPC_WEIGHTED_INTERVAL_CAP,
  rpcRetryMaxProviderSwitches: env.RPC_RETRY_MAX_PROVIDER_SWITCHES,
  rpcRetryMaxElapsedMs: env.RPC_RETRY_MAX_ELAPSED_MS,
  rpcRetryMaxCumulativeDelayMs: env.RPC_RETRY_MAX_CUMULATIVE_DELAY_MS,
  rpcRetryMaxCumulativeWeight: env.RPC_RETRY_MAX_CUMULATIVE_WEIGHT,
  rpcRequestTimeoutMs: env.RPC_REQUEST_TIMEOUT_MS,
  infuraRpcIntervalCap: env.INFURA_RPC_INTERVAL_CAP,
  infuraRpcIntervalMs: env.INFURA_RPC_INTERVAL_MS,
  publicRpcIntervalCap: env.PUBLIC_RPC_INTERVAL_CAP,
  publicRpcIntervalMs: env.PUBLIC_RPC_INTERVAL_MS,
  publicRpcProvidersEnabled: env.PUBLIC_RPC_PROVIDERS_ENABLED !== "false",
  publicRpcMaxPerChain: env.PUBLIC_RPC_MAX_PER_CHAIN,
  rpcHealthProbeIntervalMs: env.RPC_HEALTH_PROBE_INTERVAL_MS,
  rpcHealthProbeTimeoutMs: env.RPC_HEALTH_PROBE_TIMEOUT_MS,
  rpcHealthProbeArchive: env.RPC_HEALTH_PROBE_ARCHIVE !== "false",
  rpcFinalityMaxProviders: env.RPC_FINALITY_MAX_PROVIDERS,
  ipfsApiUrl: env.IPFS_API_URL,
  ipfsApiBearerToken: env.IPFS_API_BEARER_TOKEN,
  ipfsApiAllowPrivateHttpTunnel: env.IPFS_API_ALLOW_PRIVATE_HTTP_TUNNEL === "true",
  ipfsRpcReadTimeoutMs: env.IPFS_RPC_READ_TIMEOUT_MS,
  ipfsRpcMaxResponseBytes: env.IPFS_RPC_MAX_RESPONSE_BYTES,
  registrationCacheMaxBytes: env.REGISTRATION_CACHE_MAX_BYTES,
  metadataDnsCacheTtlMs: env.METADATA_DNS_CACHE_TTL_MS,
};
