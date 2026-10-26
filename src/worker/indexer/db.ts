import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { parseOptionalStrictUnsignedInteger } from "./lib/strict-integer.js";
function isLocalPostgresUrl(url: string): boolean {
  return /^(postgres(ql)?:\/\/)([^@]+@)?(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url.trim());
}
const rawUrl = process.env.DATABASE_URL!.trim();
const isLocal = isLocalPostgresUrl(rawUrl);
const configuredPoolSize = parseOptionalStrictUnsignedInteger(process.env.WORKER_PRISMA_POOL_MAX, "WORKER_PRISMA_POOL_MAX", 0, { allowZero: true, maximum: 1024 });
const derivedPoolSize = isLocal ? 32 : 12;
export const workerPrismaPoolSize = configuredPoolSize > 0
  ? configuredPoolSize
  : derivedPoolSize;
/**
 * Per-queue pg-boss concurrency is multiplied by the number of registered workers; it is
 * not a process-wide cap. Keep each DB-heavy queue deliberately below the Prisma pool so
 * simultaneous indexing lanes cannot turn a 32-connection pool into hundreds of runnable
 * transactions contending on the same Agent graph. RPC-specific schedulers provide their
 * own independent network concurrency.
 */
export const indexerWorkerClaimConcurrency = Math.max(1, Math.min(6, Math.floor(workerPrismaPoolSize / 4)));
export const indexerWriteHeavyConcurrency = Math.max(1, Math.min(4, Math.floor(workerPrismaPoolSize / 6)));
export const indexerRelationWriteConcurrency = Math.max(1, Math.min(3, Math.floor(workerPrismaPoolSize / 8)));
function positiveEnvMs(name: string, fallback: number): number {
  return parseOptionalStrictUnsignedInteger(process.env[name], name, fallback, { maximum: 86_400_000 });
}
const statementTimeoutMs = positiveEnvMs("WORKER_DATABASE_STATEMENT_TIMEOUT_MS", 120_000);
const poolConfig: PoolConfig = {
  connectionString: rawUrl,
  pipeline: true,
  max: workerPrismaPoolSize,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 600_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  statement_timeout: statementTimeoutMs,
  lock_timeout: positiveEnvMs("WORKER_DATABASE_LOCK_TIMEOUT_MS", 10_000),
  idle_in_transaction_session_timeout: positiveEnvMs(
    "WORKER_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
    60_000,
  ),
  ssl: isLocal ? false : { rejectUnauthorized: true },
};
export const prisma = new PrismaClient({ adapter: new PrismaPg(poolConfig) } as ConstructorParameters<typeof PrismaClient>[0]);
/** Direct DB URL for pg-boss and the few remaining raw pg call sites. */
export const resolvedWorkerDatabaseUrl = rawUrl;
