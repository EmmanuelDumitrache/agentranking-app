import type { Prisma } from "@/generated/prisma/client";
import { getChainByChainId } from "../chains.js";
export type ChainFeedbackCounts = {
  onchainFeedbackCount: number;
  siteFeedbackCount: number;
  feedbackCount: number;
};
const POSTGRES_INT_MAX = 2_147_483_647;
function exactDatabaseInt(value: bigint, label: string): number {
  if (value < 0n || value > 2_147_483_647n) {
    throw new Error(`${label} is outside the PostgreSQL integer domain`);
  }
  return Number(value);
}
/**
 * Canonical Chain feedback counters:
 * - onchainFeedbackCount = materialized EVM chain Feedback rows plus exact
 *   sourceFeedbackCount supplied by canonical indexers such as 8004-Solana.
 * - siteFeedbackCount = application-owned Feedback rows.
 * - feedbackCount = their exact sum.
 */
export async function reconcileChainFeedbackCounts(
  tx: Prisma.TransactionClient,
  chainId: number,
): Promise<ChainFeedbackCounts> {
  const [row] = await tx.$queryRaw<Array<{
    onchain: bigint;
    site: bigint;
  }>>`
    WITH feedback_counts AS (
      SELECT
        COUNT(*) FILTER (
          WHERE f."source_registry" IS NOT NULL OR f."feedbackIndex" IS NOT NULL
        )::bigint AS onchain,
        COUNT(*) FILTER (
          WHERE f."source_registry" IS NULL AND f."feedbackIndex" IS NULL
        )::bigint AS site
      FROM "Feedback" f
      INNER JOIN "Agent" a ON a.id = f."agentId"
      WHERE a."chainId" = ${chainId}
        AND f.revoked = FALSE
    ), source_count AS (
      SELECT COALESCE(
        SUM(GREATEST(COALESCE(a."source_feedback_count", 0), 0))::bigint,
        0::bigint
      ) AS total
      FROM "Agent" a
      WHERE a."chainId" = ${chainId}
    )
    SELECT
      feedback_counts.onchain + source_count.total AS onchain,
      feedback_counts.site AS site
    FROM feedback_counts
    CROSS JOIN source_count
  `;
  const onchainFeedbackCount = exactDatabaseInt(row?.onchain ?? 0n, "on-chain feedback count");
  const siteFeedbackCount = exactDatabaseInt(row?.site ?? 0n, "site feedback count");
  const feedbackCount = onchainFeedbackCount + siteFeedbackCount;
  if (feedbackCount > 2_147_483_647) throw new Error("total feedback count is outside the PostgreSQL integer domain");
  const chain = getChainByChainId(chainId);
  if (!chain) throw new Error(`Cannot reconcile feedback counts for unsupported chain ${chainId}`);
  await tx.chain.upsert({
    where: { chainId },
    create: {
      chainId,
      name: chain.name,
      shortName: chain.shortName,
      icon: "",
      color: "#888",
      identityRegistry: chain.identityRegistry,
      reputationRegistry: chain.reputationRegistry,
      validationRegistry: chain.validationRegistry,
      agentCount: 0,
      onchainFeedbackCount,
      siteFeedbackCount,
      feedbackCount,
      indexingEnabled: true,
      isActive: true,
    },
    update: { onchainFeedbackCount, siteFeedbackCount, feedbackCount },
  });
  return { onchainFeedbackCount, siteFeedbackCount, feedbackCount };
}

/** Apply a projection delta without rescanning every feedback row on the chain. */
export async function adjustChainFeedbackCounts(
  tx: Prisma.TransactionClient,
  chainId: number,
  delta: { onchain?: number; site?: number },
): Promise<void> {
  const onchain = delta.onchain ?? 0;
  const site = delta.site ?? 0;
  if (!Number.isSafeInteger(onchain) || !Number.isSafeInteger(site)) {
    throw new Error("feedback count delta is outside the safe integer domain");
  }
  if (onchain === 0 && site === 0) return;
  const changed = await tx.$executeRaw`
    UPDATE "Chain"
    SET
      "onchain_feedback_count" = "onchain_feedback_count" + ${onchain},
      "site_feedback_count" = "site_feedback_count" + ${site},
      "feedbackCount" = "feedbackCount" + ${onchain + site}
    WHERE "chainId" = ${chainId}
      AND "onchain_feedback_count" + ${onchain} BETWEEN 0 AND ${POSTGRES_INT_MAX}
      AND "site_feedback_count" + ${site} BETWEEN 0 AND ${POSTGRES_INT_MAX}
      AND "feedbackCount" + ${onchain + site} BETWEEN 0 AND ${POSTGRES_INT_MAX}
  `;
  if (changed !== 1) {
    // A missing/stale counter or an unexpected domain boundary is exceptional;
    // repair it from canonical rows instead of corrupting the projection.
    await reconcileChainFeedbackCounts(tx, chainId);
  }
}
