import { Prisma } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "../db.js";
import { throwIfAborted } from "../lib/abort.js";
import type { ResourceKey } from "./resource-key.js";
export type DistributedResourceLease = {
  resourceKey: ResourceKey;
  slot: number;
  holder: string;
  signal: AbortSignal;
  release(): Promise<void>;
};
type DistributedAvailability = { capacity: number; waitMs: number };
type AcquireOptions = {
  resourceKey: ResourceKey;
  capacity: number | (() => Promise<DistributedAvailability>);
  enforceDistributedState?: boolean;
  leaseTtlMs: number;
  heartbeatMs: number;
  pollMs: number;
  signal?: AbortSignal;
};
const PROCESS_HOLDER_PREFIX = `${hostname()}:${process.pid}`;
type LocalSlotClaimGate = {
  tail: Promise<void>;
  notBefore: number;
  failureStreak: number;
};
const localSlotClaimGates = new Map<ResourceKey, LocalSlotClaimGate>();
async function tryClaimSlot(
  resourceKey: ResourceKey,
  capacity: number,
  holder: string,
  leaseTtlMs: number,
  enforceDistributedState: boolean,
): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ slot: number }>>(Prisma.sql`
    WITH candidate AS MATERIALIZED (
      SELECT available.slot
      FROM generate_series(0, ${capacity}::integer - 1) AS available(slot)
      WHERE (
          NOT ${enforceDistributedState}::boolean
          OR available.slot < COALESCE((
            SELECT state."capacity"
            FROM "worker_resource_states" AS state
            WHERE state."resource_key" = ${resourceKey}::text
              AND COALESCE(state."rate_limited_until", '-infinity'::timestamptz) <= CURRENT_TIMESTAMP
              AND COALESCE(state."cooling_until", '-infinity'::timestamptz) <= CURRENT_TIMESTAMP
          ), 0)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_resource_leases" AS lease
          WHERE lease."resource_key" = ${resourceKey}::text
            AND lease."slot" = available.slot
            AND lease."lease_until" > CURRENT_TIMESTAMP
        )
        AND pg_try_advisory_xact_lock(
          hashtextextended(${resourceKey}::text || ':' || available.slot::text, 0)
        )
      ORDER BY available.slot ASC
      LIMIT 1
    )
    INSERT INTO "worker_resource_leases" (
      "resource_key", "slot", "holder", "lease_until", "heartbeat_at"
    )
    SELECT ${resourceKey}::text, candidate.slot, ${holder}::text,
           CURRENT_TIMESTAMP + (${leaseTtlMs}::bigint * INTERVAL '1 millisecond'),
           CURRENT_TIMESTAMP
    FROM candidate
    ON CONFLICT ("resource_key", "slot") DO UPDATE
      SET "holder" = EXCLUDED."holder",
          "lease_until" = EXCLUDED."lease_until",
          "heartbeat_at" = EXCLUDED."heartbeat_at"
      WHERE "worker_resource_leases"."lease_until" <= CURRENT_TIMESTAMP
    RETURNING "slot"
  `);
  return rows[0]?.slot ?? null;
}
async function tryClaimSlotLocallyCoalesced(input: {
  resourceKey: ResourceKey;
  capacity: number;
  holder: string;
  leaseTtlMs: number;
  enforceDistributedState: boolean;
  basePollMs: number;
}): Promise<{ slot: number | null; waitMs: number }> {
  let gate = localSlotClaimGates.get(input.resourceKey);
  if (!gate) {
    gate = { tail: Promise.resolve(), notBefore: 0, failureStreak: 0 };
    localSlotClaimGates.set(input.resourceKey, gate);
  }
  const predecessor = gate.tail;
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  gate.tail = predecessor.catch(() => undefined).then(() => turn);
  await predecessor.catch(() => undefined);
  try {
    const now = Date.now();
    if (gate.notBefore > now) return { slot: null, waitMs: gate.notBefore - now };
    const slot = await tryClaimSlot(
      input.resourceKey,
      input.capacity,
      input.holder,
      input.leaseTtlMs,
      input.enforceDistributedState,
    );
    if (slot != null) {
      gate.failureStreak = 0;
      gate.notBefore = 0;
      return { slot, waitMs: 0 };
    }
    gate.failureStreak += 1;
    const backoffMs = Math.min(
      2_000,
      input.basePollMs * 2 ** Math.min(5, gate.failureStreak - 1),
    );
    const waitMs = Math.max(
      input.basePollMs,
      Math.round(backoffMs * (0.75 + Math.random() * 0.5)),
    );
    gate.notBefore = Date.now() + waitMs;
    return { slot: null, waitMs };
  } finally {
    release();
  }
}
async function heartbeatLease(
  resourceKey: ResourceKey,
  slot: number,
  holder: string,
  leaseTtlMs: number,
): Promise<boolean> {
  const updated = await prisma.$executeRaw(Prisma.sql`
    UPDATE "worker_resource_leases"
       SET "lease_until" = CURRENT_TIMESTAMP + (${leaseTtlMs}::bigint * INTERVAL '1 millisecond'),
           "heartbeat_at" = CURRENT_TIMESTAMP
     WHERE "resource_key" = ${resourceKey}::text
       AND "slot" = ${slot}::integer
       AND "holder" = ${holder}::text
  `);
  return updated === 1;
}
async function releaseLease(resourceKey: ResourceKey, slot: number, holder: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "worker_resource_leases"
       SET "lease_until" = CURRENT_TIMESTAMP,
           "heartbeat_at" = CURRENT_TIMESTAMP
     WHERE "resource_key" = ${resourceKey}::text
       AND "slot" = ${slot}::integer
       AND "holder" = ${holder}::text
  `);
  const gate = localSlotClaimGates.get(resourceKey);
  if (gate) {
    gate.failureStreak = 0;
    gate.notBefore = 0;
  }
}
export async function acquireDistributedResourceSlot(options: AcquireOptions): Promise<DistributedResourceLease> {
  if (typeof options.capacity === "number" && (!Number.isSafeInteger(options.capacity) || options.capacity <= 0)) {
    throw new Error("distributed resource capacity must be a positive safe integer");
  }
  const holder = `${PROCESS_HOLDER_PREFIX}:${randomUUID()}`;
  const basePollMs = Math.max(1, Math.trunc(options.pollMs));
  for (;;) {
    throwIfAborted(options.signal);
    const availability = typeof options.capacity === "function"
      ? await options.capacity()
      : { capacity: options.capacity, waitMs: 0 };
    if (!Number.isSafeInteger(availability.capacity) || availability.capacity <= 0) {
      throw new Error("distributed resource availability returned an invalid capacity");
    }
    if (availability.waitMs > 0) {
      await sleep(Math.max(basePollMs, availability.waitMs), undefined, { signal: options.signal });
      continue;
    }
    const claim = await tryClaimSlotLocallyCoalesced({
      resourceKey: options.resourceKey,
      capacity: availability.capacity,
      holder,
      leaseTtlMs: options.leaseTtlMs,
      enforceDistributedState: options.enforceDistributedState === true,
      basePollMs,
    });
    const slot = claim.slot;
    if (slot != null) {
      const lostController = new AbortController();
      let released = false;
      let heartbeatTimer: NodeJS.Timeout | null = null;
      const heartbeat = async (): Promise<void> => {
        if (released) return;
        try {
          const retained = await heartbeatLease(
            options.resourceKey,
            slot,
            holder,
            options.leaseTtlMs,
          );
          if (!retained && !lostController.signal.aborted) {
            lostController.abort(new Error(`Distributed resource lease lost for ${options.resourceKey} slot ${slot}`));
            return;
          }
        } catch (error) {
          if (!lostController.signal.aborted) lostController.abort(error);
          return;
        }
        if (!released) {
          heartbeatTimer = setTimeout(() => void heartbeat(), options.heartbeatMs);
          heartbeatTimer.unref?.();
        }
      };
      heartbeatTimer = setTimeout(() => void heartbeat(), options.heartbeatMs);
      heartbeatTimer.unref?.();
      return {
        resourceKey: options.resourceKey,
        slot,
        holder,
        signal: lostController.signal,
        async release(): Promise<void> {
          if (released) return;
          released = true;
          if (heartbeatTimer) clearTimeout(heartbeatTimer);
          await releaseLease(options.resourceKey, slot, holder);
        },
      };
    }
    await sleep(Math.max(basePollMs, claim.waitMs), undefined, { signal: options.signal });
  }
}
