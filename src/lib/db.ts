import { hash } from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import pgConnectionString from "pg-connection-string";
const globalForDb = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  /** Cache key for DATABASE_URL + generated Prisma client freshness. */
  prismaCacheKey: string | undefined;
};
// Prefer IPv4 on hosts where IPv6 routing to Postgres is broken.
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}
/**
 * Dashboard paste issues: wrapped quotes, newlines inside the URI, duplicated URI.
 * Also strips junk prefixes (e.g. dotenv stdout accidentally captured into the env var).
 */
export function sanitizeDatabaseUrlFromEnv(raw: string): string {
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[\r\n\t]/g, "").replace(/\\n/g, "");
  // If shell/dotenv noise was prepended, keep from the first real postgres URI.
  const firstPostgres = Math.min(
    ...["postgresql://", "postgres://"]
      .map((marker) => {
        const idx = s.indexOf(marker);
        return idx === -1 ? Number.POSITIVE_INFINITY : idx;
      }),
  );
  if (Number.isFinite(firstPostgres) && firstPostgres > 0) {
    s = s.slice(firstPostgres).trim();
  }
  const schemePositions: number[] = [];
  for (const marker of ["postgresql://", "postgres://"] as const) {
    let from = 0;
    let idx = s.indexOf(marker, from);
    while (idx !== -1) {
      schemePositions.push(idx);
      from = idx + marker.length;
      idx = s.indexOf(marker, from);
    }
  }
  schemePositions.sort((a, b) => a - b);
  if (schemePositions.length >= 2) {
    s = s.slice(0, schemePositions[1]).trim();
  }
  return s.trim();
}
function fingerprintDatabaseUrl(sanitizedUrl: string): string {
  if (!sanitizedUrl) return "";
  return hash("sha256", sanitizedUrl, "hex");
}
/** Strip Prisma-only query params (not used by `pg`). */
function normalizeDatabaseUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return u;
  if (u.startsWith("postgres://")) {
    u = `postgresql://${u.slice("postgres://".length)}`;
  }
  u = u.replaceAll(/[?&](connection_limit=\d+|pool_timeout=\d+)/gi, "");
  u = u.replace(/\?&/, "?").replaceAll(/&+/g, "&").replace(/[?&]$/, "");
  return u;
}
function parseDbHostname(connectionString: string): string {
  try {
    return new URL(connectionString.replace(/^postgres:/i, "postgresql:")).hostname;
  } catch {
    return "";
  }
}
function isLocalPostgresHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "127.0.0.1" || h === "localhost";
}
/** Remove URL params that conflict with explicit `Pool` / TLS settings. */
function stripKeysConflictingWithPool(cfg: PoolConfig): void {
  const drop = [
    "connection_limit",
    "pool_timeout",
    "sslmode",
    "statement_timeout",
    "query_timeout",
    "lock_timeout",
    "idle_in_transaction_session_timeout",
  ] as const;
  for (const k of drop) {
    delete (cfg as Record<string, unknown>)[k];
  }
}
/**
 * Connection wait before the pool gives up. Override with DATABASE_POOL_CONNECT_TIMEOUT_MS.
 * Development allows enough time for an SSH tunnel or cold remote PostgreSQL connection while remaining bounded.
 */
export function resolveConnectionTimeoutMillis(): number {
  const fromEnv = Number.parseInt(process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  if (process.env.NODE_ENV === "development") return 25_000;
  return 30_000;
}
function resolvePositiveTimeout(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export function resolveDatabaseTimeoutPolicy() {
  const development = process.env.NODE_ENV === "development";
  const statementTimeoutMs = resolvePositiveTimeout(
    "DATABASE_STATEMENT_TIMEOUT_MS",
    development ? 60_000 : 30_000,
  );
  return {
    statementTimeoutMs,
    lockTimeoutMs: resolvePositiveTimeout("DATABASE_LOCK_TIMEOUT_MS", development ? 10_000 : 5_000),
    idleInTransactionTimeoutMs: resolvePositiveTimeout(
      "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
      development ? 60_000 : 30_000,
    ),
  };
}
function isNextProductionBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}
function buildPostgresPoolConfig(connectionString: string): PoolConfig {
  const hostname = parseDbHostname(connectionString);
  const isLocal = isLocalPostgresHost(hostname);
  let urlForParse = connectionString;
  if (!isLocal) {
    const extra: string[] = [];
    if (!/[?&]sslmode=/i.test(urlForParse)) extra.push("sslmode=require");
    if (!/[?&]connect_timeout=/i.test(urlForParse)) extra.push("connect_timeout=15");
    if (extra.length > 0) {
      urlForParse = `${urlForParse}${urlForParse.includes("?") ? "&" : "?"}${extra.join("&")}`;
    }
  }
  const parsed = pgConnectionString.parseIntoClientConfig(urlForParse) as PoolConfig;
  const isBuildFork = isNextProductionBuildPhase();
  const fromEnvPool = Number.parseInt(process.env.DATABASE_PG_POOL_MAX ?? "", 10);
  // Co-located PostgreSQL can sustain a wider bounded client pool; remote DBs stay conservative.
  const defaultMax = isBuildFork ? 1 : isLocal ? 10 : 5;
  const max = isBuildFork
    ? 1
    : Math.min(
        20,
        Math.max(1, Number.isFinite(fromEnvPool) && fromEnvPool > 0 ? fromEnvPool : defaultMax),
      );
  const timeoutPolicy = resolveDatabaseTimeoutPolicy();
  const poolConfig: PoolConfig = {
    ...parsed,
    pipeline: true,
    max,
    connectionTimeoutMillis: resolveConnectionTimeoutMillis(),
    idleTimeoutMillis: isBuildFork ? 10_000 : 600_000,
    allowExitOnIdle: isBuildFork,
    keepAlive: !isBuildFork,
    keepAliveInitialDelayMillis: 10_000,
  };
  stripKeysConflictingWithPool(poolConfig);
  poolConfig.statement_timeout = timeoutPolicy.statementTimeoutMs;
  poolConfig.lock_timeout = timeoutPolicy.lockTimeoutMs;
  poolConfig.idle_in_transaction_session_timeout = timeoutPolicy.idleInTransactionTimeoutMs;
  if (isLocal) {
    poolConfig.ssl = false;
  } else if (
    /sslmode=require/i.test(connectionString) ||
    parsed.ssl === true ||
    (typeof parsed.ssl === "object" && parsed.ssl !== null)
  ) {
    poolConfig.ssl = { rejectUnauthorized: true };
  }
  return poolConfig;
}
function fingerprintGeneratedPrismaClient(): string {
  try {
    const clientPath = path.join(process.cwd(), "src/generated/prisma/client.ts");
    return String(fs.statSync(clientPath).mtimeMs);
  } catch {
    return "missing";
  }
}

function resolvePrismaCacheKey(sanitizedRawUrl: string): string {
  return `${fingerprintDatabaseUrl(sanitizedRawUrl)}:${fingerprintGeneratedPrismaClient()}`;
}

function createPrismaWithSanitized(sanitizedRawUrl: string): PrismaClient {
  if (sanitizedRawUrl.startsWith("file:")) {
    throw new Error("SQLite DATABASE_URL values are unsupported; AgentRanking requires PostgreSQL");
  }
  const connectionString = normalizeDatabaseUrl(sanitizedRawUrl);
  const poolConfig = buildPostgresPoolConfig(connectionString);
  const adapter = new PrismaPg(poolConfig);
  return new PrismaClient({ adapter });
}
function resolvePrismaSingleton(): PrismaClient {
  const raw = process.env.DATABASE_URL?.trim() ?? "";
  if (!raw) throw new Error("DATABASE_URL is required");
  const sanitized = sanitizeDatabaseUrlFromEnv(raw);
  if (!/^postgres(?:ql)?:\/\//i.test(sanitized)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }
  const fp = resolvePrismaCacheKey(sanitized);
  if (globalForDb.prisma && globalForDb.prismaCacheKey !== fp) {
    void globalForDb.prisma.$disconnect().catch(() => undefined);
    globalForDb.prisma = undefined;
  }
  globalForDb.prismaCacheKey = fp;
  if (!globalForDb.prisma) {
    globalForDb.prisma = createPrismaWithSanitized(sanitized);
  }
  return globalForDb.prisma;
}
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = resolvePrismaSingleton();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
