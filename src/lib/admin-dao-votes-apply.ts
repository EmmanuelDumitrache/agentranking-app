import type { PrismaClient } from "@/generated/prisma/client";
import { invalidatePublicDaoVotesCaches } from "@/lib/admin-dao-votes";
import { upsertDaoVotesLiveForAgents } from "@/lib/dao-votes-store";
import { recomputeBoostsAndListingPowerForAgent } from "@/lib/recompute-single-agent-power-score";
/** Fast path after admin DAO vote edits — no immediate full-table rank projection. */
export async function applyDaoVotesAdminChange(
  db: PrismaClient,
  agentInternalIds: number[],
): Promise<void> {
  const uniqueIds = [...new Set(agentInternalIds)].filter((id) => id > 0);
  if (uniqueIds.length === 0) return;
  for (const id of uniqueIds) {
    await recomputeBoostsAndListingPowerForAgent(db, id);
  }
  await upsertDaoVotesLiveForAgents(db, uniqueIds);
  await invalidatePublicDaoVotesCaches();
}
