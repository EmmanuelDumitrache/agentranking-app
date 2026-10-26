/**
 * Backfill Agent.cluster_key for all EVM deployments (union-find over registration edges).
 *
 * Run with worker stopped or low queue load to avoid competing with agent-sync.
 */
import "../config.js";
import { rebuildAllClusterKeys } from "../sync/cluster-assignment.js";
import { logger } from "../logger.js";
import { prisma } from "../db.js";
async function main(): Promise<void> {
  const result = await rebuildAllClusterKeys();
  logger.info("cluster-rebuild finished", result, "cluster");
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
