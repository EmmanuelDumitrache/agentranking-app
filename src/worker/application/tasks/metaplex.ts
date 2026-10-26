import { clampMetaplexDiscoverBatch, discoverAndIndexMetaplexAgents } from "@/worker/indexer/sync/metaplex-discover-and-index";
import { clampReindexLimit, parseStaleHours, reindexKnownMetaplexAgents } from "@/lib/metaplex/reindex-known";
import { backgroundJobPausedResult } from "../task-utils";
import { indexMetaplexAgent } from "../../../../services/metaplex-indexer";
import type { MetaplexDiscoverPayload, MetaplexIndexPayload, MetaplexReindexPayload } from "@/jobs/contracts";
import { enqueueMetaplexSnapshot } from "@/worker/indexer/queue/producer";
export async function metaplexIndexJob(payload: MetaplexIndexPayload) {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const result = await indexMetaplexAgent(payload.assetAddress);
  if (!result.ok) return { ...result, terminal: true };
  return result;
}
export async function metaplexDiscoverJob(payload: MetaplexDiscoverPayload) {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  if (!payload.dryRun) {
    const jobId = await enqueueMetaplexSnapshot();
    return { ok: jobId != null, accepted: jobId != null, jobId };
  }
  return discoverAndIndexMetaplexAgents({
    limit: clampMetaplexDiscoverBatch(payload.limit),
    dryRun: true,
  });
}
export async function metaplexReindexJob(payload: MetaplexReindexPayload) {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  return reindexKnownMetaplexAgents({
    limit: clampReindexLimit(payload.limit),
    staleHours: parseStaleHours(payload.staleHours),
    dryRun: payload.dryRun,
  });
}
