export type AgentLaunchFeeDistributionClientResult = {
  status: "idle" | "queued" | "in_progress" | "distributed" | "failed" | "skipped";
  launchId?: string;
  jobId?: string;
  jobState?: string;
  mint?: string | null;
  txSignature?: string | null;
  totalAmount?: string | null;
  creatorAmount?: string | null;
  arAmount?: string | null;
  reason?: string | null;
  error?: string;
  retryable?: boolean;
  timedOut?: boolean;
  launch?: unknown;
};
const TERMINAL_STATUSES = new Set(["distributed", "failed", "skipped"]);
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
async function readJson(response: Response): Promise<AgentLaunchFeeDistributionClientResult> {
  const payload = (await response.json()) as AgentLaunchFeeDistributionClientResult;
  if (!response.ok) {
    throw new Error(payload.error || payload.reason || `Fee distribution request failed (${response.status})`);
  }
  return payload;
}
export async function requestAgentLaunchFeeDistribution(
  launchId: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
    mode?: "standard" | "recovery";
  } = {},
): Promise<AgentLaunchFeeDistributionClientResult> {
  const requestedTimeoutMs = options.timeoutMs ?? 45_000;
  const requestedPollMs = options.pollMs ?? 1_000;
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.min(1_800_000, Math.max(1, Math.trunc(requestedTimeoutMs)))
    : 120_000;
  const pollMs = Number.isFinite(requestedPollMs)
    ? Math.min(300_000, Math.max(100, Math.trunc(requestedPollMs)))
    : 1_000;
  const deadlineSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadlineSignal])
    : deadlineSignal;
  let latest: AgentLaunchFeeDistributionClientResult = { status: "idle", launchId };
  try {
    latest = await readJson(
      await fetch("/api/agent-launch/run-distribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          launchId,
          mode: options.mode ?? "standard",
        }),
        signal,
      }),
    );
    if (TERMINAL_STATUSES.has(latest.status)) return latest;
    if (!latest.jobId) throw new Error("Fee distribution enqueue did not return a job id");
    const jobId = latest.jobId;
    while (!signal.aborted) {
      await delay(pollMs, signal);
      latest = await readJson(
        await fetch(
          `/api/agent-launch/run-distribution?launchId=${encodeURIComponent(launchId)}&jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store", signal },
        ),
      );
      if (TERMINAL_STATUSES.has(latest.status)) return latest;
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    if (!deadlineSignal.aborted) throw error;
  }
  return {
    ...latest,
    timedOut: true,
    reason: latest.reason ?? "Fee distribution is still processing after the local polling deadline.",
  };
}
