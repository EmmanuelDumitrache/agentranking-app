import "server-only";

import type { DistributionRunMode, DistributionRunResult } from "@/lib/agent-launch/fee-distribution";
import { feeDistributionQueueKey } from "@/lib/agent-launch/fee-distribution-state";
import { getAgentLaunchFeeDistributionStatus } from "@/lib/agent-launch/fee-distribution-status";
import { getJobProducer } from "@/jobs/boss";
import { JOB_QUEUES } from "@/jobs/queues";

export type FeeDistributionJobPayload = {
  v: 1;
  id: string;
  mode: DistributionRunMode;
};

type FeeDistributionJobOutput = {
  ok?: boolean;
  result?: DistributionRunResult;
  skipped?: string;
};

const IN_FLIGHT_STATES = new Set(["created", "retry", "active"]);

export async function enqueueAgentLaunchFeeDistribution(
  launchId: string,
  mode: DistributionRunMode,
): Promise<{ jobId: string; accepted: boolean }> {
  const boss = await getJobProducer();
  const payload: FeeDistributionJobPayload = { v: 1, id: launchId, mode };
  const queueKey = feeDistributionQueueKey(launchId, mode);
  const jobId = await boss.send(JOB_QUEUES.LAUNCH_FEE_DISTRIBUTE, payload, {
    singletonKey: queueKey,
  });
  if (jobId) return { jobId, accepted: true };

  // `exclusive` is extended by singletonKey, so a rejected send means another
  // queued/active execution for this launch won the race. Return that durable
  // job id instead of asking the caller to manufacture a second execution path.
  const jobs = await boss.findJobs<FeeDistributionJobPayload>(
    JOB_QUEUES.LAUNCH_FEE_DISTRIBUTE,
    { key: queueKey },
  );
  const active = jobs
    .filter((job) => IN_FLIGHT_STATES.has(job.state))
    .sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime())[0];
  if (active) return { jobId: active.id, accepted: false };

  throw new Error(`Fee distribution queue rejected launch ${launchId} without an active keyed job`);
}

export async function getAgentLaunchFeeDistributionJobResult(
  launchId: string,
  jobId: string,
) {
  const boss = await getJobProducer();
  const [job] = await boss.findJobs<FeeDistributionJobPayload>(
    JOB_QUEUES.LAUNCH_FEE_DISTRIBUTE,
    { id: jobId },
  );
  const persisted = await getAgentLaunchFeeDistributionStatus(launchId);
  if (!persisted) return null;

  if (!job) {
    return {
      ...persisted,
      status: persisted.status === "idle" ? "failed" : persisted.status,
      reason: persisted.reason ?? "Fee distribution job is no longer retained",
      jobId,
      jobState: "missing",
    };
  }
  if (job.data.id !== launchId) {
    throw new Error(`Fee distribution job ${jobId} does not belong to launch ${launchId}`);
  }

  if (persisted.status === "distributed" || persisted.status === "failed") {
    return {
      ...persisted,
      jobId,
      jobState: job.state,
    };
  }

  if (persisted.attempt && persisted.status === "in_progress") {
    const reconcileJobs = await boss.findJobs(
      JOB_QUEUES.LAUNCH_FEE_RECONCILE,
      { key: persisted.attempt.id },
    );
    const reconcileJob = reconcileJobs
      .sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime())[0];
    if (reconcileJob?.state === "failed" || reconcileJob?.state === "cancelled") {
      return {
        ...persisted,
        status: "failed" as const,
        reason:
          persisted.reason ??
          (typeof reconcileJob.output === "object"
            ? JSON.stringify(reconcileJob.output)
            : String(reconcileJob.output)),
        jobId,
        jobState: job.state,
        reconcileJobId: reconcileJob.id,
        reconcileJobState: reconcileJob.state,
      };
    }
    if (reconcileJob?.state === "completed") {
      const reconcileOutput = (reconcileJob.output ?? {}) as FeeDistributionJobOutput;
      if (reconcileOutput.result?.status === "failed") {
        return {
          ...persisted,
          ...reconcileOutput.result,
          status: "failed" as const,
          launch: persisted.launch,
          jobId,
          jobState: job.state,
          reconcileJobId: reconcileJob.id,
          reconcileJobState: reconcileJob.state,
        };
      }
    }
  }

  const output = (job.output ?? {}) as FeeDistributionJobOutput;
  if (job.state === "completed") {
    if (output.result) {
      if (output.result.status === "pending") {
        return {
          ...persisted,
          status: "in_progress" as const,
          txSignature: output.result.txSignature,
          jobId,
          jobState: job.state,
        };
      }
      return {
        ...persisted,
        ...output.result,
        launch: persisted.launch,
        jobId,
        jobState: job.state,
      };
    }
    if (output.skipped) {
      return {
        ...persisted,
        status: "skipped" as const,
        reason: output.skipped,
        jobId,
        jobState: job.state,
      };
    }
  }

  if (job.state === "failed" || job.state === "cancelled") {
    return {
      ...persisted,
      status: "failed" as const,
      reason:
        persisted.reason ??
        (typeof job.output === "object" ? JSON.stringify(job.output) : String(job.output)),
      jobId,
      jobState: job.state,
    };
  }

  return {
    ...persisted,
    status: job.state === "active" ? ("in_progress" as const) : ("queued" as const),
    jobId,
    jobState: job.state,
  };
}
