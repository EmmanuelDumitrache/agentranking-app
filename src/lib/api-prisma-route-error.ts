import { isPrismaStatementTimeoutMessage } from "@/lib/db-prisma-error";
import { isTransientPoolRetryMessage } from "@/lib/db-transient-retry";

const VPS_DB_HINT = "Inspect PostgreSQL pool pressure and the affected query plan.";

export function maxConnectionsInfo(message: string): { code: string; hint: string; retryAfterSec: number } | null {
  if (!/max client connections reached|too many connections|remaining connection slots are reserved/i.test(message)) {
    return null;
  }
  return {
    code: "DB_MAX_CONNECTIONS",
    hint: `Too many simultaneous PostgreSQL clients. Lower application concurrency or raise PostgreSQL capacity deliberately. ${VPS_DB_HINT}`,
    retryAfterSec: 5,
  };
}

export function databaseQueryTimeoutInfo(message: string): { code: string; hint: string; retryAfterSec: number } | null {
  if (!isPrismaStatementTimeoutMessage(message)) return null;
  return {
    code: "DB_QUERY_TIMEOUT",
    hint: `PostgreSQL cancelled a query that exceeded the configured statement deadline. Inspect the query plan and indexes before raising DATABASE_STATEMENT_TIMEOUT_MS. ${VPS_DB_HINT}`,
    retryAfterSec: 2,
  };
}

export type PrismaApiRouteErrorResponse = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

export function prismaApiRouteErrorResponse(message: string): PrismaApiRouteErrorResponse {
  const maxConn = maxConnectionsInfo(message);
  const queryTimeout = databaseQueryTimeoutInfo(message);
  const poolCheckoutTimeout = isTransientPoolRetryMessage(message);
  const classified = maxConn ?? queryTimeout;

  if (poolCheckoutTimeout && !classified) {
    return {
      status: 503,
      body: {
        error: "The database connection pool is saturated.",
        code: "DB_POOL_TIMEOUT",
        hint: VPS_DB_HINT,
      },
      headers: { "Retry-After": "2", "Cache-Control": "no-store" },
    };
  }

  if (classified) {
    return {
      status: 503,
      body: { error: message, code: classified.code, hint: classified.hint },
      headers: {
        "Retry-After": String(classified.retryAfterSec),
        "Cache-Control": "no-store",
      },
    };
  }

  return {
    status: 500,
    body: { error: message },
    headers: { "Cache-Control": "no-store" },
  };
}

export function prismaApiErrorLogFields(message: string): Record<string, unknown> {
  const maxConn = maxConnectionsInfo(message);
  if (maxConn) return { prismaErrorCode: maxConn.code };
  const queryTimeout = databaseQueryTimeoutInfo(message);
  return queryTimeout ? { prismaErrorCode: queryTimeout.code } : {};
}
