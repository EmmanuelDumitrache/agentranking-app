export type ScanIntentState = {
  desiredGeneration: bigint;
  acknowledgedGeneration: bigint;
  requestedFinalizedTarget: bigint | null;
  minimumRescanBoundary: bigint | null;
  forceReconciliation: boolean;
};
export type ScanIntentRequest = {
  requestedFinalizedTarget?: bigint;
  minimumRescanBoundary?: bigint;
  forceReconciliation?: boolean;
};
/** Merge desired work monotonically so an ordinary wake-up cannot erase stronger pending work. */
export function mergeScanIntentState(current: ScanIntentState | null, request: ScanIntentRequest): ScanIntentState {
  const desiredGeneration = (current?.desiredGeneration ?? 0n) + 1n;
  const requestedFinalizedTarget = request.requestedFinalizedTarget == null
    ? current?.requestedFinalizedTarget ?? null
    : current?.requestedFinalizedTarget == null
      ? request.requestedFinalizedTarget
      : request.requestedFinalizedTarget > current.requestedFinalizedTarget
        ? request.requestedFinalizedTarget
        : current.requestedFinalizedTarget;
  const minimumRescanBoundary = request.minimumRescanBoundary == null
    ? current?.minimumRescanBoundary ?? null
    : current?.minimumRescanBoundary == null
      ? request.minimumRescanBoundary
      : request.minimumRescanBoundary < current.minimumRescanBoundary
        ? request.minimumRescanBoundary
        : current.minimumRescanBoundary;
  return {
    desiredGeneration,
    acknowledgedGeneration: current?.acknowledgedGeneration ?? 0n,
    requestedFinalizedTarget,
    minimumRescanBoundary,
    forceReconciliation: (current?.forceReconciliation ?? false) || (request.forceReconciliation ?? false),
  };
}
export function acknowledgeScanIntentState(current: ScanIntentState, processedGeneration: bigint): {
  state: ScanIntentState;
  requeueGeneration: bigint | null;
} {
  const acknowledgedGeneration = current.acknowledgedGeneration > processedGeneration
    ? current.acknowledgedGeneration
    : processedGeneration;
  const fullyAcknowledged = acknowledgedGeneration >= current.desiredGeneration;
  return {
    state: {
      ...current,
      acknowledgedGeneration,
      // Consume one-shot repair requirements only after the newest request generation is done.
      forceReconciliation: fullyAcknowledged ? false : current.forceReconciliation,
      minimumRescanBoundary: fullyAcknowledged ? null : current.minimumRescanBoundary,
      requestedFinalizedTarget: fullyAcknowledged ? null : current.requestedFinalizedTarget,
    },
    requeueGeneration: fullyAcknowledged ? null : current.desiredGeneration,
  };
}
