/** User-facing launch error codes for Robinhood Chain flow. */
export const ROBINHOOD_LAUNCH_ERROR = {
  WRONG_CHAIN: "WRONG_CHAIN",
  INSUFFICIENT_ETH: "INSUFFICIENT_ETH",
  TX_REJECTED: "TX_REJECTED",
  TX_REVERTED: "TX_REVERTED",
  EVENT_NOT_FOUND: "EVENT_NOT_FOUND",
  SOURCE_VERIFICATION_FAILED: "SOURCE_VERIFICATION_FAILED",
  RECEIPT_TIMEOUT: "RECEIPT_TIMEOUT",
  PREPARE_FAILED: "PREPARE_FAILED",
  PREPARATION_REQUIRED: "PREPARATION_REQUIRED",
  PREPARATION_NOT_FOUND: "PREPARATION_NOT_FOUND",
  PREPARATION_MISMATCH: "PREPARATION_MISMATCH",
  PREPARATION_USED: "PREPARATION_USED",
  PREPARATION_EXPIRED: "PREPARATION_EXPIRED",
} as const;
export type RobinhoodLaunchErrorCode =
  (typeof ROBINHOOD_LAUNCH_ERROR)[keyof typeof ROBINHOOD_LAUNCH_ERROR];
const MESSAGES: Record<RobinhoodLaunchErrorCode, string> = {
  WRONG_CHAIN: "Switch to Robinhood Chain (chain ID 4663) before launching.",
  INSUFFICIENT_ETH: "Insufficient ETH for the launch fee and gas. Add funds to your wallet on Robinhood Chain.",
  TX_REJECTED: "Transaction was rejected in your wallet.",
  TX_REVERTED: "Transaction reverted on-chain. Your launch fee was not consumed if the tx failed early — check the explorer.",
  EVENT_NOT_FOUND: "Transaction confirmed but TokenLaunched was not found. Save your tx hash and try import later.",
  SOURCE_VERIFICATION_FAILED: "Token was created but source verification failed. Contact support with your tx hash.",
  RECEIPT_TIMEOUT: "Transaction is taking longer than expected. Check the explorer, then import with your tx hash.",
  PREPARE_FAILED: "Could not prepare the launch transaction.",
  PREPARATION_REQUIRED: "Launch preparation is required. Prepare the transaction again and retry.",
  PREPARATION_NOT_FOUND: "Launch preparation was not found. Prepare the transaction again and retry.",
  PREPARATION_MISMATCH: "The confirmed transaction does not match the prepared AgentRanking launch.",
  PREPARATION_USED: "This launch preparation has already been used by another transaction.",
  PREPARATION_EXPIRED: "The transaction was mined outside the launch preparation window. Prepare a new launch.",
};
export class RobinhoodLaunchError extends Error {
  readonly code: RobinhoodLaunchErrorCode;
  constructor(code: RobinhoodLaunchErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "RobinhoodLaunchError";
    this.code = code;
  }
}
export function mapWalletError(err: unknown): RobinhoodLaunchError {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("rejected the request") ||
    msg.includes("action_rejected")
  ) {
    return new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.TX_REJECTED);
  }
  if (msg.includes("insufficient funds") || msg.includes("insufficient balance")) {
    return new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.INSUFFICIENT_ETH);
  }
  if (err instanceof RobinhoodLaunchError) return err;
  return new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARE_FAILED, err instanceof Error ? err.message : "Launch failed");
}