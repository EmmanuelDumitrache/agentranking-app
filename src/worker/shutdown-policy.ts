export const WORKER_SHUTDOWN_POLICY = {
  pgBossGracefulTimeoutMs: 30_000,
  pgBossForcedCloseTimeoutMs: 5_000,
  resourceDrainTimeoutMs: 5_000,
  cacheInvalidationCloseTimeoutMs: 20_000,
  prismaDisconnectTimeoutMs: 5_000,
  forceExitTimeoutMs: 80_000,
} as const;
