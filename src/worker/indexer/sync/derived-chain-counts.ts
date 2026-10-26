import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db.js";
import { CHAINS } from "../chains.js";
import { logger } from "../logger.js";

export type DerivedChainCountResult = {
  chainsWithAgents: number;
  totalAgents: number;
};

/** Rebuild persisted per-chain agent and feedback counters from canonical tables. */
export async function refreshDerivedChainCounts(): Promise<DerivedChainCountResult> {
  const snapshot = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      chainId: number;
      agentCount: bigint;
      onchainFeedbackCount: bigint;
      siteFeedbackCount: bigint;
    }>>`
      WITH agent_counts AS (
        SELECT
          a."chainId" AS "chainId",
          COUNT(*)::bigint AS "agentCount",
          COALESCE(SUM(GREATEST(COALESCE(a."source_feedback_count", 0), 0)), 0)::bigint AS "sourceFeedbackCount"
        FROM "Agent" a
        GROUP BY a."chainId"
      ), feedback_counts AS (
        SELECT
          a."chainId" AS "chainId",
          COUNT(*) FILTER (
            WHERE f.revoked = FALSE
              AND (f."source_registry" IS NOT NULL OR f."feedbackIndex" IS NOT NULL)
          )::bigint AS "eventFeedbackCount",
          COUNT(*) FILTER (
            WHERE f.revoked = FALSE
              AND f."source_registry" IS NULL
              AND f."feedbackIndex" IS NULL
          )::bigint AS "siteFeedbackCount"
        FROM "Agent" a
        INNER JOIN "Feedback" f ON f."agentId" = a.id
        GROUP BY a."chainId"
      )
      SELECT
        c."chainId" AS "chainId",
        COALESCE(ac."agentCount", 0)::bigint AS "agentCount",
        (COALESCE(fc."eventFeedbackCount", 0) + COALESCE(ac."sourceFeedbackCount", 0))::bigint AS "onchainFeedbackCount",
        COALESCE(fc."siteFeedbackCount", 0)::bigint AS "siteFeedbackCount"
      FROM "Chain" c
      LEFT JOIN agent_counts ac ON ac."chainId" = c."chainId"
      LEFT JOIN feedback_counts fc ON fc."chainId" = c."chainId"
      ORDER BY c."chainId" ASC
    `;
    const known = new Set(rows.map((row) => row.chainId));
    const missingChains = CHAINS.filter((cfg) => !known.has(cfg.chainId));
    if (missingChains.length > 0) {
      await tx.chain.createMany({
        data: missingChains.map((cfg) => ({
          chainId: cfg.chainId,
          name: cfg.name,
          shortName: cfg.shortName,
          icon: "",
          color: "#888",
          identityRegistry: cfg.identityRegistry,
          reputationRegistry: cfg.reputationRegistry,
          validationRegistry: cfg.validationRegistry,
          agentCount: 0,
          feedbackCount: 0,
          onchainFeedbackCount: 0,
          siteFeedbackCount: 0,
        })),
        skipDuplicates: true,
      });
    }
    for (const cfg of missingChains) {
      rows.push({
        chainId: cfg.chainId,
        agentCount: 0n,
        onchainFeedbackCount: 0n,
        siteFeedbackCount: 0n,
      });
    }
    let totalAgents = 0;
    let chainsWithAgents = 0;
    const updates: Array<{
      chainId: number;
      agentCount: number;
      onchainFeedbackCount: number;
      siteFeedbackCount: number;
    }> = [];
    for (const row of rows) {
      const agentCount = Number(row.agentCount);
      const onchainFeedbackCount = Number(row.onchainFeedbackCount);
      const siteFeedbackCount = Number(row.siteFeedbackCount);
      for (const [label, value] of Object.entries({ agentCount, onchainFeedbackCount, siteFeedbackCount })) {
        if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
          throw new Error(`${label} is outside the database integer domain`);
        }
      }
      updates.push({ chainId: row.chainId, agentCount, onchainFeedbackCount, siteFeedbackCount });
      totalAgents += agentCount;
      if (agentCount > 0) chainsWithAgents += 1;
    }
    if (updates.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Chain" AS target SET
          "agentCount" = incoming."agentCount",
          "onchain_feedback_count" = incoming."onchainFeedbackCount",
          "site_feedback_count" = incoming."siteFeedbackCount",
          "feedbackCount" = incoming."onchainFeedbackCount" + incoming."siteFeedbackCount"
        FROM (VALUES ${Prisma.join(updates.map((update) => Prisma.sql`(
          ${update.chainId}::integer,
          ${update.agentCount}::integer,
          ${update.onchainFeedbackCount}::integer,
          ${update.siteFeedbackCount}::integer
        )`))}) AS incoming(
          "chainId", "agentCount", "onchainFeedbackCount", "siteFeedbackCount"
        )
        WHERE target."chainId" = incoming."chainId"
          AND (
            target."agentCount",
            target."onchain_feedback_count",
            target."site_feedback_count",
            target."feedbackCount"
          ) IS DISTINCT FROM (
            incoming."agentCount",
            incoming."onchainFeedbackCount",
            incoming."siteFeedbackCount",
            incoming."onchainFeedbackCount" + incoming."siteFeedbackCount"
          )
      `);
    }
    return { chainsWithAgents, totalAgents };
  }, { isolationLevel: "RepeatableRead", timeout: 120_000, maxWait: 30_000 });
  logger.info("derived chain counts refreshed", snapshot, "sync");
  return snapshot;
}
