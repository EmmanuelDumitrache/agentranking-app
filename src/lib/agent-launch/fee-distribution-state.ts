export type FeeDistributionSignatureObservation = {
  signatureSeen: boolean;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  hasError: boolean;
  currentBlockHeight: bigint;
  lastValidBlockHeight: bigint;
};

export type FeeDistributionReconcileDecision =
  | "finalize"
  | "fail_on_chain"
  | "prepare_new"
  | "rebroadcast_same_transaction";

export function feeDistributionQueueKey(
  launchId: string,
  mode: "standard" | "recovery",
): string {
  return mode === "recovery" ? `recovery:${launchId}` : launchId;
}

export function decideFeeDistributionReconciliation(
  observation: FeeDistributionSignatureObservation,
): FeeDistributionReconcileDecision {
  if (observation.hasError) return "fail_on_chain";
  if (
    observation.confirmationStatus === "confirmed" ||
    observation.confirmationStatus === "finalized"
  ) {
    return "finalize";
  }
  if (
    !observation.signatureSeen &&
    observation.currentBlockHeight > observation.lastValidBlockHeight
  ) {
    return "prepare_new";
  }
  return "rebroadcast_same_transaction";
}

export function splitFeeDistributionAmounts(
  total: bigint,
  creatorBps: number,
  arBps: number,
): { creatorAmount: bigint; arAmount: bigint } {
  if (total < 0n) throw new Error("Fee distribution total cannot be negative");
  if (!Number.isInteger(creatorBps) || !Number.isInteger(arBps)) {
    throw new Error("Fee distribution BPS values must be integers");
  }
  if (creatorBps < 0 || arBps < 0 || creatorBps + arBps !== 10_000) {
    throw new Error(
      `Invalid fee distribution BPS: creator=${creatorBps} ar=${arBps}`,
    );
  }
  const creatorAmount = (total * BigInt(creatorBps)) / 10_000n;
  // Keep aggregate accounting exact by assigning the integer division remainder
  // to the AR side.
  const arAmount = total - creatorAmount;
  return { creatorAmount, arAmount };
}

const TERMINAL_FEE_DISTRIBUTION_FAILURE_MARKERS = [
  "AGENT_LAUNCH_FEE_BOT_PRIVATE_KEY",
  "AGENT_LAUNCH_FEE_BOT_PUBLIC_KEY",
  "Invalid AGENT_LAUNCH_FEE_BOT_PRIVATE_KEY",
  "fee_bot_public_key_mismatch",
  "launch_not_found",
  "missing_mint",
  "invalid_mint",
  "launch_network_mismatch",
  "Sharing config not found",
  "no longer matches launch network/mint",
  "belongs to launch",
  "Persisted transaction signature mismatch",
  "missing a payer signature",
  "invalid status",
  "Invalid fee distribution BPS",
  "Fee distribution BPS values must be integers",
  "Fee distribution total cannot be negative",
] as const;

export function isRetryableFeeDistributionFailure(
  reason: string,
  onChainFailure = false,
): boolean {
  if (onChainFailure || reason.startsWith("on_chain_transaction_error:")) {
    return false;
  }
  return !TERMINAL_FEE_DISTRIBUTION_FAILURE_MARKERS.some((marker) =>
    reason.includes(marker),
  );
}
