/**
 * Recompute `Chain.agentCount` and `Chain.feedbackCount` from `Agent` / `Feedback` (source of truth).
 * Run after bulk-index, catchup, or whenever UI counters look stale.
 *
 * This command module is invoked by the worker command surface, not a package script.
 */
import { pathToFileURL } from "node:url";
import "../config.js";
import { prisma } from "../db.js";
import { CHAINS } from "../chains.js";
import { logger } from "../logger.js";
export async function refreshChainCounts(): Promise<{ chainsWithAgents: number; totalAgents: number }> {
  const snapshot = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ chainId: number; agentCount: bigint; onchainFeedbackCount: bigint; siteFeedbackCount: bigint }>>`
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
          COUNT(*) FILTER (WHERE f.revoked = FALSE AND (f."source_registry" IS NOT NULL OR f."feedbackIndex" IS NOT NULL))::bigint AS "eventFeedbackCount",
          COUNT(*) FILTER (WHERE f.revoked = FALSE AND (f."source_registry" IS NULL AND f."feedbackIndex" IS NULL))::bigint AS "siteFeedbackCount"
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
    for (const cfg of CHAINS) {
      if (known.has(cfg.chainId)) continue;
      await tx.chain.upsert({
        where: { chainId: cfg.chainId },
        create: {
          chainId: cfg.chainId, name: cfg.name, shortName: cfg.shortName, icon: "", color: "#888",
          identityRegistry: cfg.identityRegistry, reputationRegistry: cfg.reputationRegistry, validationRegistry: cfg.validationRegistry,
          agentCount: 0, feedbackCount: 0, onchainFeedbackCount: 0, siteFeedbackCount: 0,
        },
        update: {},
      });
      rows.push({ chainId: cfg.chainId, agentCount: 0n, onchainFeedbackCount: 0n, siteFeedbackCount: 0n });
    }
    let totalAgents = 0;
    let chainsWithAgents = 0;
    for (const row of rows) {
      const agentCount = Number(row.agentCount);
      const onchainFeedbackCount = Number(row.onchainFeedbackCount);
      const siteFeedbackCount = Number(row.siteFeedbackCount);
      for (const [label, value] of Object.entries({ agentCount, onchainFeedbackCount, siteFeedbackCount })) {
        if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new Error(`${label} is outside the database integer domain`);
      }
      await tx.chain.update({ where: { chainId: row.chainId }, data: {
        agentCount, onchainFeedbackCount, siteFeedbackCount, feedbackCount: onchainFeedbackCount + siteFeedbackCount,
      } });
      totalAgents += agentCount;
      if (agentCount > 0) chainsWithAgents += 1;
    }
    return { chainsWithAgents, totalAgents };
  }, { isolationLevel: "RepeatableRead", timeout: 120_000, maxWait: 30_000 });
  logger.info("refresh-chain-counts done", snapshot, "sync");
  return snapshot;
}
async function main(): Promise<void> {
  const { chainsWithAgents, totalAgents } = await refreshChainCounts();
  console.log(JSON.stringify({ ok: true, chainsWithAgents, totalAgents }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
    .catch(async (err) => {
      logger.error("refresh-chain-counts fatal", { error: Error.isError(err) ? err.message : String(err) }, "sync");
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
