export type ExecutionLeaseState = {
  state: string;
  deadlineAt: Date;
};
export type ExecutionLeaseDisposition = "claim" | "busy" | "completed";
export function progressLeaseStalled(lastProgressAt: Date, now: Date, stallTimeoutMs: number): boolean {
  return now.getTime() - lastProgressAt.getTime() > Math.max(1_000, stallTimeoutMs);
}
/**
 * Pure lease decision used by the durable worker boundary. A retry may take over
 * only after the previous execution reached a terminal retryable state or its
 * fixed execution deadline elapsed. Completed work is replayed from the
 * idempotency record instead of being claimed again.
 */
export function executionLeaseDisposition(
  current: ExecutionLeaseState | null,
  now: Date,
): ExecutionLeaseDisposition {
  if (current == null) return "claim";
  if (current.state === "completed") return "completed";
  if (current.state === "running" && current.deadlineAt.getTime() > now.getTime()) return "busy";
  return "claim";
}
