/** Map noisy viem/wallet claim errors into a short user-facing message. */
export function mapRobinhoodClaimError(err: unknown): string {
  if (!err || typeof err !== "object") {
    return "Claim failed. Try again.";
  }
  const anyErr = err as {
    shortMessage?: string;
    message?: string;
    details?: string;
    cause?: { message?: string; shortMessage?: string };
    code?: number | string;
    name?: string;
  };
  const raw = [
    anyErr.shortMessage,
    anyErr.message,
    anyErr.details,
    anyErr.cause?.shortMessage,
    anyErr.cause?.message,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    raw.includes("user rejected") ||
    raw.includes("user denied") ||
    raw.includes("rejected the request") ||
    anyErr.code === 4001 ||
    anyErr.name === "UserRejectedRequestError"
  ) {
    return "Claim cancelled.";
  }
  if (
    raw.includes("intrinsic gas too low") ||
    raw.includes("execution reverted") ||
    raw.includes("gas provided") ||
    raw.includes("0xea8e4eb5")
  ) {
    return "Claim failed — this wallet can't collect fees for this launch.";
  }
  if (raw.includes("insufficient funds") || raw.includes("insufficient balance")) {
    return "Not enough ETH on Robinhood Chain for gas.";
  }
  if (raw.includes("wrong chain") || raw.includes("chain mismatch")) {
    return "Switch to Robinhood Chain (4663) and try again.";
  }
  // Prefer a short message when viem provides one without the Request Arguments dump.
  if (anyErr.shortMessage && !anyErr.shortMessage.includes("Request Arguments")) {
    return anyErr.shortMessage;
  }
  return "Claim failed. Try again.";
}
