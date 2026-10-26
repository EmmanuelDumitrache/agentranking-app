import { Prisma } from "@/generated/prisma/client";
import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "../db.js";
import { throwIfAborted } from "../lib/abort.js";
import type { ResourceKey, ResourceRateBudgetDimension } from "./resource-key.js";
import { resourceRateBudgetKey } from "./resource-key.js";
type DistributedWeightedRateBudgetOptions = {
  resourceKey: ResourceKey;
  dimension: ResourceRateBudgetDimension;
  capacity: number;
  intervalMs: number;
  minimumPollMs?: number;
};
type AcquireResult = {
  acquired: boolean;
  wait_ms: bigint | number | string | null;
};
function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}
async function waitForTurn(predecessor: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await predecessor.catch(() => undefined);
    return;
  }
  throwIfAborted(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([predecessor.catch(() => undefined), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
/**
 * PostgreSQL-coordinated weighted GCRA budget. Every acquisition is atomic at the physical
 * resource key, so workers on separate processes and hosts share one aggregate rate contract.
 * PostgreSQL time is authoritative; process clock skew cannot create extra provider capacity.
 */
export class DistributedWeightedRateBudget {
  readonly #budgetKey: string;
  readonly #dimension: ResourceRateBudgetDimension;
  readonly #capacity: number;
  readonly #intervalMs: number;
  readonly #minimumPollMs: number;
  #acquireTail: Promise<void> | null = null;
  constructor(options: DistributedWeightedRateBudgetOptions) {
    this.#dimension = options.dimension;
    this.#capacity = positiveSafeInteger(options.capacity, "distributed rate capacity");
    this.#intervalMs = positiveSafeInteger(options.intervalMs, "distributed rate interval");
    this.#minimumPollMs = positiveSafeInteger(options.minimumPollMs ?? 5, "distributed rate poll interval");
    this.#budgetKey = resourceRateBudgetKey(
      options.resourceKey,
      options.dimension,
      this.#capacity,
      this.#intervalMs,
    );
  }
  get capacity(): number {
    return this.#capacity;
  }
  get intervalMs(): number {
    return this.#intervalMs;
  }
  async acquire(requestedWeight: number, signal?: AbortSignal): Promise<void> {
    // PostgreSQL is the cross-process authority, but concurrent callers in this
    // process do not need to race the same GCRA row. A FIFO local turn converts
    // a thundering herd of short failed acquisitions into one exact DB-clock
    // waiter while still releasing the next request immediately on success.
    const predecessor = this.#acquireTail ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.catch(() => undefined).then(() => turn);
    this.#acquireTail = tail;
    try {
      await waitForTurn(predecessor, signal);
      await this.#acquireUnserialized(requestedWeight, signal);
    } finally {
      release();
      if (this.#acquireTail === tail) this.#acquireTail = null;
    }
  }
  async #acquireUnserialized(requestedWeight: number, signal?: AbortSignal): Promise<void> {
    const weight = Math.max(1, Math.min(this.#capacity, Math.ceil(requestedWeight)));
    for (;;) {
      throwIfAborted(signal);
      const result = await this.#tryAcquire(weight);
      if (result.acquired) return;
      await sleep(Math.max(this.#minimumPollMs, result.waitMs), undefined, { signal });
    }
  }
  async #tryAcquire(weight: number): Promise<{ acquired: boolean; waitMs: number }> {
    // Bind each prepared-statement parameter to one PostgreSQL type exactly once. Reusing an
    // uncast parameter as both an INTEGER insert value and a DOUBLE PRECISION interval operand
    // makes PostgreSQL reject the statement with 42P08 (inconsistent parameter types). The final
    // CROSS JOIN exposes capacity/interval_ms from both CTEs, so those references must also stay
    // explicitly qualified or PostgreSQL rejects the statement with 42702 (ambiguous column).
    const rows = await prisma.$queryRaw<AcquireResult[]>(Prisma.sql`
      WITH input AS (
        SELECT
          ${this.#budgetKey}::text AS "resource_key",
          ${this.#capacity}::integer AS "capacity",
          ${this.#intervalMs}::integer AS "interval_ms",
          ${weight}::integer AS "weight"
      ), attempted AS (
        INSERT INTO "worker_resource_rate_budgets" (
          "resource_key", "capacity", "interval_ms", "theoretical_arrival_at", "updated_at"
        )
        SELECT
          input."resource_key",
          input."capacity",
          input."interval_ms",
          CURRENT_TIMESTAMP + (
            input."weight"::double precision
            * input."interval_ms"::double precision
            / input."capacity"::double precision
            * INTERVAL '1 millisecond'
          ),
          CURRENT_TIMESTAMP
        FROM input
        ON CONFLICT ("resource_key") DO UPDATE
          SET "theoretical_arrival_at" =
                GREATEST("worker_resource_rate_budgets"."theoretical_arrival_at", CURRENT_TIMESTAMP)
                + (EXCLUDED."theoretical_arrival_at" - CURRENT_TIMESTAMP),
              "updated_at" = CURRENT_TIMESTAMP
        WHERE GREATEST("worker_resource_rate_budgets"."theoretical_arrival_at", CURRENT_TIMESTAMP)
                + (EXCLUDED."theoretical_arrival_at" - CURRENT_TIMESTAMP)
              <= CURRENT_TIMESTAMP + (EXCLUDED."interval_ms" * INTERVAL '1 millisecond')
        RETURNING "capacity", "interval_ms", "theoretical_arrival_at"
      ), state AS (
        SELECT TRUE AS acquired, "capacity", "interval_ms", "theoretical_arrival_at"
        FROM attempted
        UNION ALL
        SELECT FALSE, budget."capacity", budget."interval_ms", budget."theoretical_arrival_at"
        FROM "worker_resource_rate_budgets" AS budget
        WHERE budget."resource_key" = ${this.#budgetKey}::text
          AND NOT EXISTS (SELECT 1 FROM attempted)
        LIMIT 1
      )
      SELECT
        acquired,
        CASE WHEN acquired THEN 0 ELSE GREATEST(
          1,
          CEIL(EXTRACT(EPOCH FROM (
            "theoretical_arrival_at"
            + ((input."weight"::double precision * state."interval_ms"::double precision / state."capacity"::double precision) * INTERVAL '1 millisecond')
            - (CURRENT_TIMESTAMP + (state."interval_ms"::bigint * INTERVAL '1 millisecond'))
          )) * 1000)
        )::bigint END AS "wait_ms"
      FROM state
      CROSS JOIN input
    `);
    const row = rows[0];
    if (!row) return { acquired: false, waitMs: this.#minimumPollMs };
    if (row.acquired) return { acquired: true, waitMs: 0 };
    const raw = row.wait_ms;
    if (raw == null) return { acquired: false, waitMs: this.#minimumPollMs };
    const parsed = typeof raw === "bigint" ? Number(raw) : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { acquired: false, waitMs: this.#minimumPollMs };
    }
    return {
      acquired: false,
      waitMs: Math.min(this.#intervalMs, Math.max(this.#minimumPollMs, Math.ceil(parsed))),
    };
  }
}
