import { prisma } from "@/lib/db";
import { backgroundJobPausedResult } from "../task-utils";
const RETENTION_HOURS = 24;
const BATCH_SIZE = 1_000;
const MAX_BATCHES = 10;
/**
 * Bounded cleanup for short-lived launch preparations. A preparation remains
 * available for at least 24 hours after expiry/consumption so delayed record
 * retries can still bind to the exact on-chain transaction.
 */
export async function robinhoodPreparationPruneJob() {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const count = await prisma.$executeRaw`
      WITH doomed AS (
        SELECT id
        FROM "robinhood_launch_preparations"
        WHERE "expires_at" < NOW() - (${RETENTION_HOURS} * INTERVAL '1 hour')
          AND (
            "consumed_at" IS NULL
            OR "consumed_at" < NOW() - (${RETENTION_HOURS} * INTERVAL '1 hour')
          )
        -- Keep this sargable on the existing expires_at index. The previous
        -- GREATEST expression forced a full scan and sort for every batch.
        ORDER BY "expires_at" ASC
        LIMIT ${BATCH_SIZE}
      )
      DELETE FROM "robinhood_launch_preparations" AS preparation
      USING doomed
      WHERE preparation.id = doomed.id
    `;
    deleted += count;
    if (count < BATCH_SIZE) break;
  }
  return { ok: true, deleted, bounded: deleted >= BATCH_SIZE * MAX_BATCHES };
}
