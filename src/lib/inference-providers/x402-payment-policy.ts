export const INFERENCE_X402_NETWORK = "eip155:8453" as const;
export const INFERENCE_X402_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const INFERENCE_X402_MAX_ATOMIC_USDC = 50_000n;
export const INFERENCE_X402_MAX_TIMEOUT_SECONDS = 300;

type PaymentRequirementShape = {
  scheme?: unknown;
  network?: unknown;
  asset?: unknown;
  amount?: unknown;
  maxTimeoutSeconds?: unknown;
};

function parsePositiveAtomicAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Pure spending policy applied before the x402 SDK selects or signs a payment. */
export function isAllowedInferencePaymentRequirement(
  version: number,
  requirement: unknown,
): boolean {
  if (version !== 2 || !requirement || typeof requirement !== "object") return false;
  const row = requirement as PaymentRequirementShape;
  if (row.scheme !== "exact" || row.network !== INFERENCE_X402_NETWORK) return false;
  if (
    typeof row.asset !== "string" ||
    row.asset.toLowerCase() !== INFERENCE_X402_ASSET.toLowerCase()
  ) return false;
  const amount = parsePositiveAtomicAmount(row.amount);
  if (amount === null || amount > INFERENCE_X402_MAX_ATOMIC_USDC) return false;
  return Number.isInteger(row.maxTimeoutSeconds)
    && Number(row.maxTimeoutSeconds) >= 1
    && Number(row.maxTimeoutSeconds) <= INFERENCE_X402_MAX_TIMEOUT_SECONDS;
}

export function isExactApprovedX402Url(requested: string, approved: string): boolean {
  try {
    const approvedUrl = new URL(approved);
    const requestedUrl = new URL(requested);
    return approvedUrl.protocol === "https:"
      && !approvedUrl.username
      && !approvedUrl.password
      && !approvedUrl.hash
      && requestedUrl.toString() === approvedUrl.toString();
  } catch {
    return false;
  }
}
