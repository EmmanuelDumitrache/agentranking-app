export type ResourceProfile = {
  minCapacity: number;
  maxCapacity: number;
  successWindow: number;
  decreaseFactor: number;
  leaseTtlMs: number;
  leaseHeartbeatMs: number;
  leaseAcquirePollMs: number;
};

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

export function createResourceProfile(input: ResourceProfile): ResourceProfile {
  const minCapacity = positiveSafeInteger(input.minCapacity, "resource minCapacity");
  const maxCapacity = positiveSafeInteger(input.maxCapacity, "resource maxCapacity");
  if (minCapacity > maxCapacity) throw new Error("resource minCapacity cannot exceed maxCapacity");
  if (!Number.isFinite(input.decreaseFactor) || input.decreaseFactor <= 0 || input.decreaseFactor >= 1) {
    throw new Error("resource decreaseFactor must be greater than zero and less than one");
  }
  const leaseTtlMs = positiveSafeInteger(input.leaseTtlMs, "resource leaseTtlMs");
  const leaseHeartbeatMs = positiveSafeInteger(input.leaseHeartbeatMs, "resource leaseHeartbeatMs");
  if (leaseHeartbeatMs >= leaseTtlMs) {
    throw new Error("resource leaseHeartbeatMs must be less than leaseTtlMs");
  }
  return Object.freeze({
    minCapacity,
    maxCapacity,
    successWindow: positiveSafeInteger(input.successWindow, "resource successWindow"),
    decreaseFactor: input.decreaseFactor,
    leaseTtlMs,
    leaseHeartbeatMs,
    leaseAcquirePollMs: positiveSafeInteger(input.leaseAcquirePollMs, "resource leaseAcquirePollMs"),
  });
}
