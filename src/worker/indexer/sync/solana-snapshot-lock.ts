import { createHash } from "node:crypto";
import { Client } from "pg";
import { throwIfAborted } from "../lib/abort";
const SNAPSHOT_LOCK_HEARTBEAT_MS = 15_000;
async function settleHeartbeat(pending: Promise<void> | null): Promise<void> {
  if (pending == null) return;
  await pending;
}
function snapshotDatabaseUrl(): string {
  return process.env.DATABASE_URL!.trim();
}
function snapshotAdvisoryLock(sourceKey: string): string {
  const normalized = sourceKey.normalize("NFC").trim();
  if (!normalized) throw new Error("Solana snapshot source key is required");
  return createHash("sha256").update(`agentranking:solana-snapshot:${normalized}`).digest().readBigInt64BE(0).toString(10);
}
export class SolanaSnapshotBusyError extends Error {
  readonly sourceKey: string;
  constructor(sourceKey: string) {
    super(`another ${sourceKey} snapshot is already running`);
    this.name = "SolanaSnapshotBusyError";
    this.sourceKey = sourceKey;
  }
}
/**
 * Cross-process mutex for one exact Solana registry source.
 *
 * A dedicated PostgreSQL session owns the advisory lock for the entire
 * operation. Different registry sources have independent locks and may run
 * concurrently; the same source remains serialized across every process and
 * host. PostgreSQL releases the lock automatically if the worker or connection
 * dies. Per-Agent transactions retain their separate canonicalization fence.
 */
export async function withSolanaSnapshotLock<T>(
  sourceKey: string,
  signal: AbortSignal | undefined,
  operation: (lockedSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  const connectionFailure = new AbortController();
  const lockedSignal = signal
    ? AbortSignal.any([signal, connectionFailure.signal])
    : connectionFailure.signal;
  const databaseUrl = snapshotDatabaseUrl();
  const advisoryLock = snapshotAdvisoryLock(sourceKey);
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    application_name: `agentranking-solana-snapshot-${createHash("sha256").update(sourceKey).digest("hex").slice(0, 12)}`,
  });
  let acquired = false;
  let stoppingHeartbeat = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatInFlight: Promise<void> | null = null;
  const abortForConnectionFailure = (error: unknown): void => {
    if (!connectionFailure.signal.aborted) connectionFailure.abort(error);
  };
  const scheduleHeartbeat = (): void => {
    if (stoppingHeartbeat || connectionFailure.signal.aborted) return;
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null;
      heartbeatInFlight = client.query("SELECT 1")
        .then(() => undefined)
        .catch((error) => abortForConnectionFailure(error))
        .finally(() => {
          heartbeatInFlight = null;
          scheduleHeartbeat();
        });
    }, SNAPSHOT_LOCK_HEARTBEAT_MS);
    heartbeatTimer.unref?.();
  };
  client.on("error", abortForConnectionFailure);

  let value: T | undefined;
  let primaryError: unknown;
  try {
    await client.connect();
    throwIfAborted(lockedSignal);
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [advisoryLock],
    );
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) throw new SolanaSnapshotBusyError(sourceKey);
    scheduleHeartbeat();
    value = await operation(lockedSignal);
    throwIfAborted(lockedSignal);
  } catch (error) {
    primaryError = error;
  }

  stoppingHeartbeat = true;
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  const cleanupErrors: unknown[] = [];
  try {
    await settleHeartbeat(heartbeatInFlight);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (acquired) {
    try {
      const result = await client.query<{ released: boolean }>(
        "SELECT pg_advisory_unlock($1::bigint) AS released",
        [advisoryLock],
      );
      if (result.rows[0]?.released !== true) {
        cleanupErrors.push(new Error(`Solana snapshot advisory lock was lost for ${sourceKey}`));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await client.end();
  } catch (error) {
    cleanupErrors.push(error);
  }

  const errors = primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors];
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, `Solana snapshot lock operation failed for ${sourceKey}`);
  }
  return value as T;
}
