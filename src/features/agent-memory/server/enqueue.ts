import "server-only";
import { enqueueApplicationJobs } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import type { MemoryExtractPayload } from "../shared/schemas";

const MEMORY_EXTRACT_GENERATION_DEDUPE_SECONDS = 14 * 24 * 60 * 60;

type MemoryExtractInput = {
  sourceMessageId: string;
  sourceRunId: string;
  agentDbId: number;
  conversationId: string;
  appAccountId: string;
};

/** Queue delivery primitive. Turn-level delivery ownership lives in the DB outbox. */
export async function enqueueMemoryExtractBatch(
  inputs: readonly MemoryExtractInput[],
): Promise<void> {
  await enqueueApplicationJobs(
    JOB_QUEUES.MEMORY_EXTRACT,
    inputs.map((input) => ({
      // The database outbox owns logical turn delivery. The queue singleton is
      // scoped to one run generation only, so it suppresses crash duplicates
      // without blocking a later stable regeneration/continuation run.
      // Project the public queue contract explicitly. Outbox rows carry
      // dispatcher-only bookkeeping (for example `attempts`); spreading a
      // structurally-compatible object would leak those fields into the strict
      // worker schema and poison otherwise valid extraction jobs.
      data: {
        v: 2,
        sourceMessageId: input.sourceMessageId,
        sourceRunId: input.sourceRunId,
        agentDbId: input.agentDbId,
        conversationId: input.conversationId,
        appAccountId: input.appAccountId,
      } satisfies MemoryExtractPayload,
      singletonKey: `memory-extract:${input.sourceMessageId}:${input.sourceRunId}`,
      singletonSeconds: MEMORY_EXTRACT_GENERATION_DEDUPE_SECONDS,
      expireInSeconds: 15 * 60,
    })),
    { returnIds: false },
  );
}
