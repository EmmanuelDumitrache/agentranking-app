import { enqueueApplicationJob, enqueueApplicationJobs } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";

export async function enqueueFairscaleScan(): Promise<string | null> {
  return enqueueApplicationJob(JOB_QUEUES.PARTNER_FAIRSCALE_SCAN, { v: 1 }, { singletonKey: "eligible" });
}
export async function enqueueFairscaleAssessment(agentDbId: number): Promise<string | null> {
  if (!Number.isSafeInteger(agentDbId) || agentDbId <= 0) throw new Error("Invalid agent database id");
  return enqueueApplicationJob(
    JOB_QUEUES.PARTNER_FAIRSCALE_ASSESS,
    { v: 1, agentDbId },
    { singletonKey: String(agentDbId) },
  );
}

export async function enqueueFairscaleAssessmentBatch(
  agentDbIds: readonly number[],
): Promise<string[]> {
  const uniqueIds = [...new Set(agentDbIds)];
  for (const agentDbId of uniqueIds) {
    if (!Number.isSafeInteger(agentDbId) || agentDbId <= 0) {
      throw new Error("Invalid agent database id");
    }
  }
  return enqueueApplicationJobs(
    JOB_QUEUES.PARTNER_FAIRSCALE_ASSESS,
    uniqueIds.map((agentDbId) => ({
      data: { v: 1 as const, agentDbId },
      singletonKey: String(agentDbId),
    })),
  );
}
