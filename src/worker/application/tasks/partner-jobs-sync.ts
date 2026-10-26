import { ensureDefaultJobPartnerSources } from "@/lib/jobs/partner-sources";
import { syncPartnerSource } from "@/lib/jobs/sync";
import { enqueueApplicationJobs } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { backgroundJobPausedResult } from "../task-utils";
import type { PartnerJobSource } from "@/lib/jobs/types";
import { getPartnerSourceConfiguration } from "@/lib/jobs/partner-env";
const SOURCES: PartnerJobSource[] = ["earnfi", "wurk"];
export async function partnerJobsSyncJob() {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  await ensureDefaultJobPartnerSources();
  const candidates = SOURCES.map((source) => ({
    source,
    configuration: getPartnerSourceConfiguration(source),
  }));
  const configured = candidates
    .filter(({ configuration }) => configuration.configured)
    .map(({ source }) => source);
  const skipped = candidates
    .filter(({ configuration }) => !configuration.configured)
    .map(({ source, configuration }) => ({
      source,
      reason: configuration.reason ?? "not configured",
    }));
  const jobs = await enqueueApplicationJobs(
    JOB_QUEUES.PARTNER_JOBS_SYNC,
    configured.map((source) => ({
      data: { v: 1 as const, source },
      singletonKey: source,
    })),
  );
  return {
    ok: true,
    selected: configured.length,
    enqueued: jobs.length,
    skipped,
  };
}
export async function partnerJobSourceSyncJob(source: PartnerJobSource) {
  const paused = backgroundJobPausedResult();
  if (paused) return paused;
  const configuration = getPartnerSourceConfiguration(source);
  if (!configuration.configured) {
    return {
      source,
      ok: true,
      skipped: true,
      reason: configuration.reason ?? "not configured",
    };
  }
  const result = await syncPartnerSource(source);
  if (!result.ok) throw new Error(result.error || `${source} sync failed`);
  return result;
}
