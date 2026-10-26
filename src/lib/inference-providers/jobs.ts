import { enqueueApplicationJob, enqueueApplicationJobs } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";

export async function enqueueInferenceProviderScan(): Promise<string | null> {
  return enqueueApplicationJob(JOB_QUEUES.PARTNER_INFERENCE_SCAN, { v: 1 }, {
    singletonKey: "registry",
  });
}
export async function enqueueInferenceProviderRefresh(providerId: string): Promise<string | null> {
  const normalized = providerId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(normalized)) {
    throw new Error("Invalid inference provider id");
  }
  return enqueueApplicationJob(
    JOB_QUEUES.PARTNER_INFERENCE_REFRESH,
    { v: 1, providerId: normalized },
    { singletonKey: normalized },
  );
}

export async function enqueueInferenceProviderRefreshBatch(
  providerIds: readonly string[],
): Promise<string[]> {
  const normalizedIds = [...new Set(providerIds.map((providerId) => providerId.trim().toLowerCase()))];
  for (const providerId of normalizedIds) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(providerId)) {
      throw new Error("Invalid inference provider id");
    }
  }
  return enqueueApplicationJobs(
    JOB_QUEUES.PARTNER_INFERENCE_REFRESH,
    normalizedIds.map((providerId) => ({
      data: { v: 1 as const, providerId },
      singletonKey: providerId,
    })),
  );
}
