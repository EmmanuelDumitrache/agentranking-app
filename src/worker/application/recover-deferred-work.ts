import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { prisma } from "@/lib/db";
import { forEachWithConcurrency } from "@/lib/async-pool";
import { JOB_QUEUES } from "../../jobs/queues";
import { DOMAIN_DELIVERY_STALE_MS, GITHUB_PROCESSING_STALE_MS } from "../../jobs/domain-lease";
const PAGE_SIZE = 5_000;
const STALE_RECOVERY_BATCH = 10_000;
const RECOVERY_UPSERT_CONCURRENCY = 8;
type Counts = {
  bounties: number;
  deposits: number;
  orders: number;
  openRouterAttempts: number;
  postActivations: number;
  notifications: number;
  meshDeliveries: number;
  alertDeliveries: number;
  feeDistributionAttempts: number;
};
async function recoverStaleDomainClaims(deliveryStaleBefore: Date, githubStaleBefore: Date): Promise<void> {
  const drain = async (recoverBatch: () => Promise<number>): Promise<void> => {
    while (await recoverBatch() === STALE_RECOVERY_BATCH) {
      // Keep each claim-recovery transaction bounded. The await between pages
      // also prevents five large domain updates from competing at startup.
    }
  };
  const deliveryError = "Recovered stale delivery claim during worker startup";
  await drain(() => prisma.$executeRaw`
    WITH stale AS (
      SELECT ctid
      FROM order_post_activations
      WHERE status = 'processing' AND updated_at <= ${deliveryStaleBefore}
      ORDER BY updated_at, order_id
      LIMIT ${STALE_RECOVERY_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE order_post_activations AS target
    SET status = 'failed',
        last_error = 'Recovered stale processing claim during worker startup',
        updated_at = NOW()
    FROM stale
    WHERE target.ctid = stale.ctid
  `);
  await drain(() => prisma.$executeRaw`
    WITH stale AS (
      SELECT ctid
      FROM notification_deliveries
      WHERE status = 'delivering' AND updated_at <= ${deliveryStaleBefore}
      ORDER BY updated_at, id
      LIMIT ${STALE_RECOVERY_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_deliveries AS target
    SET status = 'failed', last_error = ${deliveryError}, updated_at = NOW()
    FROM stale
    WHERE target.ctid = stale.ctid
  `);
  await drain(() => prisma.$executeRaw`
    WITH stale AS (
      SELECT ctid
      FROM mesh_signal_deliveries
      WHERE status = 'delivering' AND updated_at <= ${deliveryStaleBefore}
      ORDER BY updated_at, id
      LIMIT ${STALE_RECOVERY_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE mesh_signal_deliveries AS target
    SET status = 'failed', last_error = ${deliveryError}, updated_at = NOW()
    FROM stale
    WHERE target.ctid = stale.ctid
  `);
  await drain(() => prisma.$executeRaw`
    WITH stale AS (
      SELECT ctid
      FROM agent_alert_deliveries
      WHERE status = 'delivering' AND updated_at <= ${deliveryStaleBefore}
      ORDER BY updated_at, id
      LIMIT ${STALE_RECOVERY_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE agent_alert_deliveries AS target
    SET status = 'failed', last_error = ${deliveryError}, updated_at = NOW()
    FROM stale
    WHERE target.ctid = stale.ctid
  `);
  await drain(() => prisma.$executeRaw`
    WITH stale AS (
      SELECT ctid
      FROM webhook_receipts
      WHERE provider = 'github'
        AND status = 'processing'
        AND processing_at <= ${githubStaleBefore}
      ORDER BY processing_at, id
      LIMIT ${STALE_RECOVERY_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE webhook_receipts AS target
    SET status = 'failed',
        last_error = 'Recovered stale GitHub processing claim during worker startup',
        updated_at = NOW()
    FROM stale
    WHERE target.ctid = stale.ctid
  `);
}
type DeferredJob = {
  data: object;
  singletonKey: string;
  startAfter?: Date | number;
};
const queueTableLoads = new Map<string, Promise<string>>();
async function queueTable(boss: PgBoss, name: string): Promise<string> {
  const existing = queueTableLoads.get(name);
  if (existing) return existing;
  const pending = boss.getQueue(name).then((queue) => {
    if (!queue) throw new Error(`pg-boss queue ${name} is unavailable during deferred-work recovery`);
    if (!/^[a-z_][a-z0-9_]*$/i.test(queue.table)) {
      throw new Error(`pg-boss queue ${name} resolved to an unsafe table identifier`);
    }
    return queue.table;
  });
  queueTableLoads.set(name, pending);
  try {
    return await pending;
  } catch (error) {
    if (queueTableLoads.get(name) === pending) queueTableLoads.delete(name);
    throw error;
  }
}
async function updateDeferredJobs(
  boss: PgBoss,
  name: string,
  jobs: readonly DeferredJob[],
): Promise<Set<string>> {
  if (jobs.length === 0) return new Set();
  const table = await queueTable(boss, name);
  const payload = jobs.map((job) => ({
    singletonKey: job.singletonKey,
    data: job.data,
    hasStartAfter: job.startAfter !== undefined,
    ...(job.startAfter !== undefined
      ? { startAfter: job.startAfter instanceof Date ? job.startAfter.toISOString() : String(job.startAfter) }
      : {}),
  }));
  const { rows } = await boss.getDb().executeSql(`
    WITH input AS (
      SELECT *
      FROM jsonb_to_recordset($1::jsonb) AS value(
        "singletonKey" text,
        data jsonb,
        "hasStartAfter" boolean,
        "startAfter" text
      )
    ), target AS (
      SELECT DISTINCT ON (job.singleton_key)
        job.id,
        job.state,
        job.singleton_key AS "singletonKey",
        input.data,
        input."hasStartAfter",
        CASE
          WHEN input."hasStartAfter" THEN CASE
            WHEN right(input."startAfter", 1) = 'Z' THEN input."startAfter"::timestamptz
            ELSE now() + input."startAfter"::interval
          END
          ELSE job.start_after
        END AS "desiredStartAfter"
      FROM pgboss.${table} AS job
      JOIN input ON input."singletonKey" = job.singleton_key
      WHERE job.name = $2
        -- An active job already owns this durable domain item and must count as
        -- recovered even though its payload cannot safely be rewritten. Omitting
        -- it here made startup recovery attempt an insert and then a serial
        -- pg-boss upsert for every currently claimed item.
        AND job.state <= 'active'
      ORDER BY job.singleton_key, job.created_on DESC
    ), updated AS (
      UPDATE pgboss.${table} AS job
      SET
        data = target.data,
        start_after = target."desiredStartAfter",
        keep_until = CASE
          WHEN target."hasStartAfter" THEN target."desiredStartAfter" + (job.keep_until - job.start_after)
          ELSE job.keep_until
        END
      FROM target
      WHERE job.id = target.id
        AND job.state < 'active'
        -- Most jobs found during recovery are already exact. Avoid generating
        -- dead tuples, index maintenance, and notifications for all of them on
        -- every worker restart.
        AND (
          job.data IS DISTINCT FROM target.data
          OR job.start_after IS DISTINCT FROM target."desiredStartAfter"
        )
      RETURNING job.start_after
    ), notified AS (
      SELECT pg_notify(
        ('pgboss_' || left(encode(sha224('pgboss'::bytea), 'hex'), 24)),
        $2
      )
      FROM updated
      WHERE start_after <= now()
      LIMIT 1
    )
    SELECT "singletonKey"
    FROM target
    WHERE (SELECT count(*) FROM notified) >= 0
  `, [JSON.stringify(payload), name]);
  const updatedKeys = new Set<string>();
  for (const row of rows) updatedKeys.add(String(row.singletonKey));
  return updatedKeys;
}
async function upsertDeferredJobs(
  boss: PgBoss,
  name: string,
  jobs: DeferredJob[],
): Promise<void> {
  if (jobs.length === 0) return;
  const jobsBySingletonKey = new Map<string, DeferredJob>();
  for (const job of jobs) jobsBySingletonKey.set(job.singletonKey, job);
  const uniqueJobs = [...jobsBySingletonKey.values()];
  const updatedKeys = await updateDeferredJobs(boss, name, uniqueJobs);
  const missing: Array<DeferredJob & { id: string }> = [];
  for (const job of uniqueJobs) {
    if (!updatedKeys.has(job.singletonKey)) missing.push({ id: randomUUID(), ...job });
  }
  if (missing.length === 0) return;
  const insertedIds = new Set(await boss.insert(name, missing, { returnId: true }) ?? []);
  // A concurrent producer can win the insert race on restrictive queue policies.
  // The exceptional remainder is small and needs pg-boss's atomic retry behavior.
  await forEachWithConcurrency(missing, RECOVERY_UPSERT_CONCURRENCY, async (job) => {
    if (insertedIds.has(job.id)) return;
    await boss.upsert(name, job.data, {
      singletonKey: job.singletonKey,
      ...(job.startAfter === undefined ? {} : { startAfter: job.startAfter }),
    });
  });
}
export async function recoverDeferredWork(boss: PgBoss): Promise<Counts> {
  const now = new Date();
  await recoverStaleDomainClaims(
    new Date(now.getTime() - DOMAIN_DELIVERY_STALE_MS),
    new Date(now.getTime() - GITHUB_PROCESSING_STALE_MS),
  );
  const counts: Counts = {
    bounties: 0,
    deposits: 0,
    orders: 0,
    openRouterAttempts: 0,
    postActivations: 0,
    notifications: 0,
    meshDeliveries: 0,
    alertDeliveries: 0,
    feeDistributionAttempts: 0,
  };
  let stringCursor: string | undefined;
  do {
    const rows: Array<{ id: string; autoReleaseAt: Date | null }> = await prisma.bounty.findMany({
      where: { status: "claimed", autoReleaseAt: { not: null } },
      select: { id: true, autoReleaseAt: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(stringCursor ? { cursor: { id: stringCursor }, skip: 1 } : {}),
    });
    await upsertDeferredJobs(boss, JOB_QUEUES.BOUNTY_AUTO_RELEASE, rows.map((row) => ({
      data: { v: 1, id: row.id },
      singletonKey: row.id,
      startAfter: row.autoReleaseAt ?? now,
    })));
    counts.bounties += rows.length;
    stringCursor = rows.at(-1)?.id;
    if (rows.length < PAGE_SIZE) break;
  } while (stringCursor);
  stringCursor = undefined;
  do {
    const rows: Array<{ id: string; quoteExpiresAt: Date }> = await prisma.llmCreditDeposit.findMany({
      where: { status: { in: ["CREATED", "AWAITING_PAYMENT"] } },
      select: { id: true, quoteExpiresAt: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(stringCursor ? { cursor: { id: stringCursor }, skip: 1 } : {}),
    });
    await Promise.all([
      upsertDeferredJobs(boss, JOB_QUEUES.LLM_DEPOSIT_EXPIRE, rows.map((row) => ({
        data: { v: 1, id: row.id }, singletonKey: row.id, startAfter: row.quoteExpiresAt,
      }))),
      upsertDeferredJobs(boss, JOB_QUEUES.LLM_DEPOSIT_RECONCILE, rows.map((row) => ({
        data: { v: 1, id: row.id }, singletonKey: row.id, startAfter: 15,
      }))),
    ]);
    counts.deposits += rows.length;
    stringCursor = rows.at(-1)?.id;
    if (rows.length < PAGE_SIZE) break;
  } while (stringCursor);
  stringCursor = undefined;
  do {
    const rows: Array<{ id: string; expiresAt: Date }> = await prisma.order.findMany({
      where: { status: "pending" },
      select: { id: true, expiresAt: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(stringCursor ? { cursor: { id: stringCursor }, skip: 1 } : {}),
    });
    await upsertDeferredJobs(boss, JOB_QUEUES.ORDER_EXPIRE, rows.map((row) => ({
      data: { v: 1, id: row.id }, singletonKey: row.id, startAfter: row.expiresAt,
    })));
    counts.orders += rows.length;
    stringCursor = rows.at(-1)?.id;
    if (rows.length < PAGE_SIZE) break;
  } while (stringCursor);
  stringCursor = undefined;
  do {
    const rows: Array<{ id: string }> = await prisma.agentChatRunAttempt.findMany({
      where: { provider: "openrouter", status: "SUCCEEDED", reconciliationStatus: { in: ["PENDING", "RETRYING"] } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(stringCursor ? { cursor: { id: stringCursor }, skip: 1 } : {}),
    });
    await upsertDeferredJobs(boss, JOB_QUEUES.OPENROUTER_RECONCILE, rows.map((row) => ({
      data: { v: 1, id: row.id }, singletonKey: row.id,
    })));
    counts.openRouterAttempts += rows.length;
    stringCursor = rows.at(-1)?.id;
    if (rows.length < PAGE_SIZE) break;
  } while (stringCursor);
  stringCursor = undefined;
  do {
    const rows: Array<{ orderId: string }> = await prisma.orderPostActivation.findMany({
      where: { status: { in: ["pending", "failed"] } },
      select: { orderId: true },
      orderBy: { orderId: "asc" },
      take: PAGE_SIZE,
      ...(stringCursor ? { cursor: { orderId: stringCursor }, skip: 1 } : {}),
    });
    await upsertDeferredJobs(boss, JOB_QUEUES.ORDER_POST_ACTIVATION, rows.map((row) => ({
      data: { v: 1, id: row.orderId }, singletonKey: row.orderId,
    })));
    counts.postActivations += rows.length;
    stringCursor = rows.at(-1)?.orderId;
    if (rows.length < PAGE_SIZE) break;
  } while (stringCursor);
  stringCursor = undefined;
  do {
    const rows: Array<{ id: string }> = await prisma.notificationDelivery.findMany({
      where: { status: { in: ["pending", "failed"] } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(stringCursor ? { cursor: { id: stringCursor }, skip: 1 } : {}),
    });
    await upsertDeferredJobs(boss, JOB_QUEUES.NOTIFICATION_DELIVER, rows.map((row) => ({
      data: { v: 1, id: row.id }, singletonKey: row.id,
    })));
    counts.notifications += rows.length;
    stringCursor = rows.at(-1)?.id;
    if (rows.length < PAGE_SIZE) break;
  } while (stringCursor);
  stringCursor = undefined;
  do {
    const rows: Array<{ id: string }> = await prisma.meshSignalDelivery.findMany({
      where: { status: { in: ["pending", "failed"] } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(stringCursor ? { cursor: { id: stringCursor }, skip: 1 } : {}),
    });
    await upsertDeferredJobs(boss, JOB_QUEUES.MESH_WEBHOOK_DELIVER, rows.map((row) => ({
      data: { v: 1, id: row.id }, singletonKey: row.id,
    })));
    counts.meshDeliveries += rows.length;
    stringCursor = rows.at(-1)?.id;
    if (rows.length < PAGE_SIZE) break;
  } while (stringCursor);
  stringCursor = undefined;
  do {
    const rows: Array<{ id: string }> = await prisma.agentAlertDelivery.findMany({
      where: { status: { in: ["pending", "failed"] } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(stringCursor ? { cursor: { id: stringCursor }, skip: 1 } : {}),
    });
    await upsertDeferredJobs(boss, JOB_QUEUES.ALERT_WEBHOOK_DELIVER, rows.map((row) => ({
      data: { v: 1, id: row.id }, singletonKey: row.id,
    })));
    counts.alertDeliveries += rows.length;
    stringCursor = rows.at(-1)?.id;
    if (rows.length < PAGE_SIZE) break;
  } while (stringCursor);
  stringCursor = undefined;
  do {
    const rows: Array<{ id: string }> = await prisma.agentLaunchFeeDistributionAttempt.findMany({
      where: { status: { in: ["prepared", "submitted"] } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(stringCursor ? { cursor: { id: stringCursor }, skip: 1 } : {}),
    });
    await upsertDeferredJobs(boss, JOB_QUEUES.LAUNCH_FEE_RECONCILE, rows.map((row) => ({
      data: { v: 1, attemptId: row.id }, singletonKey: row.id,
    })));
    counts.feeDistributionAttempts += rows.length;
    stringCursor = rows.at(-1)?.id;
    if (rows.length < PAGE_SIZE) break;
  } while (stringCursor);
  return counts;
}
