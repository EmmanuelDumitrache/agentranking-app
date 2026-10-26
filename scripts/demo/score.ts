/**
 * Recompute scores and organic ranks for a seeded demo database, the same
 * passes the worker runs in production. Run after `scripts/demo/seed.mjs`:
 *
 *   DEMO_MODE=true node --conditions=react-server --env-file-if-exists=.env.local --import tsx scripts/demo/score.ts
 */
import process from "node:process";
import { prisma } from "@/lib/db";
import { recomputeAllAgentScores } from "@/lib/recompute-agent-scores";
import { runRankProjectionQueries } from "@/lib/compute-ranks-queries";
import { prisma as workerPrisma } from "@/worker/indexer/db";
import { findStaleScoreAgentIds, recalculateAgentScore } from "@/worker/indexer/sync/score-recalculation";

if (process.env.DEMO_MODE !== "true") {
  console.error("Refusing to score: DEMO_MODE=true is required.");
  process.exit(1);
}

try {
  const updated = await recomputeAllAgentScores(prisma);
  console.log(`dimensions: ${updated} agents`);

  // Materialize the final AR score for every agent the dimension pass marked stale.
  let materialized = 0;
  let after = 0;
  for (;;) {
    const ids = await findStaleScoreAgentIds(after);
    if (ids.length === 0) break;
    for (const id of ids) {
      if ((await recalculateAgentScore(id)) === "updated") materialized++;
    }
    after = ids[ids.length - 1];
  }
  console.log(`ar scores: ${materialized} agents`);

  await runRankProjectionQueries(prisma);
  console.log("ranks: projected");
} finally {
  await prisma.$disconnect();
  await workerPrisma.$disconnect();
}
