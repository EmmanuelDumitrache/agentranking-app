import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { NOTIFICATION_KINDS } from "@/lib/notification-delivery";
import { enqueueApplicationJobsInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
const SCAN_BATCH_SIZE = 5_000;
const SCAN_MAX_PAGES_PER_RUN = 4;
const EXPIRY_UPDATE_BATCH_SIZE = 10_000;
const SCAN_CURSOR_PREFIX = "application:subscription-notifications";
type NotificationCandidate = {
  id: number;
  email: string | null;
  subscriptionExpiresAt: Date | null;
};
type NotificationScanRow = NotificationCandidate & { alreadyQueued: boolean };
type NotificationScanCursor = { expiry: Date; id: number };

function parseNotificationScanCursor(raw: string | null | undefined): NotificationScanCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { v?: unknown; expiry?: unknown; id?: unknown };
    if (value.v !== 1 || typeof value.expiry !== "string" || !Number.isSafeInteger(value.id)) {
      return null;
    }
    const expiry = new Date(value.expiry);
    return Number.isFinite(expiry.getTime()) && (value.id as number) > 0
      ? { expiry, id: value.id as number }
      : null;
  } catch {
    return null;
  }
}
function lapsedKey(profile: NotificationCandidate): string | null {
  if (!profile.subscriptionExpiresAt) return null;
  return `${profile.id}:${profile.subscriptionExpiresAt.toISOString()}:subscription-lapsed`;
}
function expiringKey(profile: NotificationCandidate): string | null {
  if (!profile.subscriptionExpiresAt) return null;
  return `${profile.id}:${profile.subscriptionExpiresAt.toISOString()}:subscription-expiring-7d`;
}
async function queueMissingNotifications(
  profiles: NotificationCandidate[],
  keyFor: (profile: NotificationCandidate) => string | null,
  kind: typeof NOTIFICATION_KINDS.SUBSCRIPTION_LAPSED | typeof NOTIFICATION_KINDS.SUBSCRIPTION_EXPIRING,
): Promise<number> {
  const candidates = profiles.flatMap((profile) => {
    const key = keyFor(profile);
    return profile.email && profile.subscriptionExpiresAt && key ? [{ profile, key }] : [];
  });
  if (candidates.length === 0) return 0;
  return prisma.$transaction(async (tx) => {
    const deliveries = await tx.notificationDelivery.createManyAndReturn({
      data: candidates.map(({ profile, key }) => ({
        idempotencyKey: key,
        kind,
        recipient: profile.email!,
        payload: { profileId: profile.id, expiryIso: profile.subscriptionExpiresAt!.toISOString() },
      })),
      skipDuplicates: true,
      select: { id: true },
    });
    await enqueueApplicationJobsInTx(
      tx,
      JOB_QUEUES.NOTIFICATION_DELIVER,
      deliveries.map((delivery) => ({
        data: { v: 1 as const, id: delivery.id },
        singletonKey: delivery.id,
      })),
      { returnIds: false },
    );
    return deliveries.length;
  }, { maxWait: 10_000, timeout: 30_000 });
}
export async function subscriptionRemindersJob() {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);
  let expired = 0;
  for (;;) {
    const changed = await prisma.$executeRaw`
      WITH candidates AS (
        SELECT ctid
        FROM "UserProfile"
        WHERE "subscriptionStatus" = 'active'
          AND "subscriptionExpiresAt" < ${now}
        ORDER BY "subscriptionExpiresAt", id
        LIMIT ${EXPIRY_UPDATE_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "UserProfile" AS profile
      SET "subscriptionStatus" = 'expired', "updatedAt" = ${now}
      FROM candidates
      WHERE profile.ctid = candidates.ctid
    `;
    expired += changed;
    if (changed < EXPIRY_UPDATE_BATCH_SIZE) break;
  }
  // Correctness is receipt-based rather than schedule-window-based. The indexed
  // anti-join keeps historical recipients out of the application result set while
  // primary-key pagination prevents old rows from starving newer subscriptions.
  async function scanCandidates(
    predicate: Prisma.Sql,
    receiptSuffix: string,
    keyFor: (profile: NotificationCandidate) => string | null,
    kind: typeof NOTIFICATION_KINDS.SUBSCRIPTION_LAPSED | typeof NOTIFICATION_KINDS.SUBSCRIPTION_EXPIRING,
  ): Promise<number> {
    const sourceKey = `${SCAN_CURSOR_PREFIX}:${receiptSuffix}`;
    const stored = await prisma.indexerSourceCursor.findUnique({
      where: { sourceKey },
      select: { opaqueCursor: true },
    });
    let cursor = parseNotificationScanCursor(stored?.opaqueCursor);
    let queued = 0;
    for (let pageNumber = 0; pageNumber < SCAN_MAX_PAGES_PER_RUN; pageNumber += 1) {
      const cursorPredicate = cursor == null
        ? Prisma.sql``
        : Prisma.sql`AND (profile."subscriptionExpiresAt", profile.id) > (${cursor.expiry}, ${cursor.id})`;
      const page = await prisma.$queryRaw<NotificationScanRow[]>(Prisma.sql`
        SELECT
          profile.id,
          profile.email,
          profile."subscriptionExpiresAt",
          EXISTS (
            SELECT 1
            FROM notification_deliveries AS delivery
            WHERE delivery.idempotency_key = (
              profile.id::text || ':' ||
              TO_CHAR(
                profile."subscriptionExpiresAt" AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              ) || ':' || ${receiptSuffix}
            )
          ) AS "alreadyQueued"
        FROM "UserProfile" AS profile
        WHERE profile.email IS NOT NULL
          AND profile."subscriptionExpiresAt" IS NOT NULL
          AND ${predicate}
          ${cursorPredicate}
        ORDER BY profile."subscriptionExpiresAt" ASC, profile.id ASC
        LIMIT ${SCAN_BATCH_SIZE}
      `);
      const passComplete = page.length < SCAN_BATCH_SIZE;
      if (page.length > 0) {
        queued += await queueMissingNotifications(
          page.filter((profile) => !profile.alreadyQueued),
          keyFor,
          kind,
        );
      }
      const last = page.at(-1);
      cursor = passComplete || !last
        ? null
        : { expiry: last.subscriptionExpiresAt!, id: last.id };
      const advancedAt = new Date();
      const opaqueCursor = cursor == null
        ? null
        : JSON.stringify({ v: 1, expiry: cursor.expiry.toISOString(), id: cursor.id });
      await prisma.indexerSourceCursor.upsert({
        where: { sourceKey },
        create: {
          sourceKey,
          domain: "subscription-notification-scan",
          opaqueCursor,
          reconciliationGeneration: passComplete ? 1n : 0n,
          lastAdvancedAt: advancedAt,
        },
        update: {
          opaqueCursor,
          lastAdvancedAt: advancedAt,
          ...(passComplete ? { reconciliationGeneration: { increment: 1n } } : {}),
        },
      });
      if (passComplete) break;
    }
    return queued;
  }
  const lapsedQueued = await scanCandidates(
    Prisma.sql`profile."subscriptionStatus" = 'expired' AND profile."subscriptionExpiresAt" < ${now}`,
    "subscription-lapsed",
    lapsedKey,
    NOTIFICATION_KINDS.SUBSCRIPTION_LAPSED,
  );
  const reminderQueued = await scanCandidates(
    Prisma.sql`profile."subscriptionStatus" = 'active'
      AND profile."subscriptionExpiresAt" >= ${now}
      AND profile."subscriptionExpiresAt" <= ${in7Days}`,
    "subscription-expiring-7d",
    expiringKey,
    NOTIFICATION_KINDS.SUBSCRIPTION_EXPIRING,
  );
  return {
    ok: true,
    expired,
    lapsed_notifications_queued: lapsedQueued,
    reminder_notifications_queued: reminderQueued,
  };
}
