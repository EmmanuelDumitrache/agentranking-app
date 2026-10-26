import "server-only";

export type NormalizedToolOutcomeKind =
  | "success"
  | "partial"
  | "failed"
  | "cancelled"
  | "timeout"
  | "validation_error"
  | "refused";

export type NormalizedToolOutcome = {
  kind: NormalizedToolOutcomeKind;
  terminalSuccess: boolean;
  makesProgress: boolean;
  retryable: boolean;
};

const FAILURE_STATUSES = new Set([
  "error",
  "failed",
  "failure",
  "rejected",
  "blocked",
  "denied",
  "invalid",
  "invalid_input",
  "validation_error",
  "unavailable",
]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "aborted"]);
const TIMEOUT_STATUSES = new Set(["timeout", "timed_out", "expired"]);
const REFUSED_STATUSES = new Set(["refused", "declined", "not_approved"]);
const PARTIAL_STATUSES = new Set(["partial", "incomplete", "pending_confirmation"]);
const SUCCESS_STATUSES = new Set(["success", "succeeded", "ok", "complete", "completed"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapToolResult(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  if ("output" in record && (record.type === "tool-result" || "toolCallId" in record || "toolName" in record)) {
    return record.output;
  }
  return value;
}

export function normalizeToolOutcome(value: unknown): NormalizedToolOutcome {
  if (value == null || Error.isError(value)) {
    return { kind: "failed", terminalSuccess: false, makesProgress: false, retryable: true };
  }
  const wrapper = asRecord(value);
  if (wrapper && (wrapper.type === "tool-error" || wrapper.type === "error" || wrapper.isError === true)) {
    return { kind: "failed", terminalSuccess: false, makesProgress: false, retryable: true };
  }
  const output = unwrapToolResult(value);
  const record = asRecord(output);
  if (!record) {
    return { kind: "success", terminalSuccess: true, makesProgress: true, retryable: false };
  }
  if (record.ok === false || record.success === false || record.isError === true) {
    return { kind: "failed", terminalSuccess: false, makesProgress: false, retryable: true };
  }
  if ("error" in record && record.error != null) {
    return { kind: "failed", terminalSuccess: false, makesProgress: false, retryable: true };
  }
  const rawStatus = typeof record.status === "string"
    ? record.status
    : typeof record.state === "string"
      ? record.state
      : "";
  const status = rawStatus.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (CANCELLED_STATUSES.has(status)) {
    return { kind: "cancelled", terminalSuccess: false, makesProgress: false, retryable: false };
  }
  if (TIMEOUT_STATUSES.has(status)) {
    return { kind: "timeout", terminalSuccess: false, makesProgress: false, retryable: true };
  }
  if (REFUSED_STATUSES.has(status)) {
    return { kind: "refused", terminalSuccess: false, makesProgress: false, retryable: false };
  }
  if (status === "validation_error" || status === "invalid_input") {
    return { kind: "validation_error", terminalSuccess: false, makesProgress: false, retryable: false };
  }
  if (FAILURE_STATUSES.has(status)) {
    return { kind: "failed", terminalSuccess: false, makesProgress: false, retryable: true };
  }
  if (PARTIAL_STATUSES.has(status)) {
    return { kind: "partial", terminalSuccess: false, makesProgress: true, retryable: true };
  }
  if (SUCCESS_STATUSES.has(status) || record.ok === true || record.success === true) {
    return { kind: "success", terminalSuccess: true, makesProgress: true, retryable: false };
  }
  return { kind: "success", terminalSuccess: true, makesProgress: true, retryable: false };
}
