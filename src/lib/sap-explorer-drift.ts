import { prisma } from "@/lib/db";
import { listOobeExplorerAgents } from "@/lib/oobe-explorer-client";
export type SapOobeExplorerDriftResult = {
  explorerAgentCount: number;
  dbSapAgentCount: number;
  onlyInExplorer: string[];
  onlyInDb: string[];
};
/**
 * B1 — compare Explorer `GET /api/v1/agents` PDAs vs `Agent.sapAgentPda` where `sapVerified`.
 * Does not mutate data. Caller logs or attaches to indexer result.
 */
export async function runSapOobeExplorerDriftCheck(options?: { listLimit?: number }): Promise<SapOobeExplorerDriftResult> {
  const limit = Math.min(Math.max(options?.listLimit ?? 500, 1), 10_000);
  const explorerRows = await listOobeExplorerAgents({ limit });
  const explorerSet = new Set(explorerRows.map((r) => r.pda.trim()).filter(Boolean));
  const dbRows = await prisma.agent.findMany({
    where: { sapVerified: true },
    select: { sapAgentPda: true },
  });
  const dbSet = new Set(dbRows.map((r) => r.sapAgentPda?.trim()).filter((p): p is string => Boolean(p)));
  const onlyInExplorer: string[] = [];
  for (const p of explorerSet) {
    if (!dbSet.has(p)) onlyInExplorer.push(p);
  }
  onlyInExplorer.sort();
  const onlyInDb: string[] = [];
  for (const p of dbSet) {
    if (!explorerSet.has(p)) onlyInDb.push(p);
  }
  onlyInDb.sort();
  return {
    explorerAgentCount: explorerSet.size,
    dbSapAgentCount: dbSet.size,
    onlyInExplorer,
    onlyInDb,
  };
}