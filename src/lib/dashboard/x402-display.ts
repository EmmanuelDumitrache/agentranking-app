export type X402DisplayState = {
  detected: boolean;
  payable: boolean;
  httpStatus: number | null;
  endpoint: string | null;
  hints: string[];
  paymentHeaders: string[];
  priceHint: string | null;
  assetHint: string | null;
  recipientHint: string | null;
  lastScanned: Date | null;
  failureReason: string | null;
};
type SignalRow = {
  signalType: string;
  status: string;
  value: string;
  payloadJson: unknown;
  lastCheckedAt: Date | null;
};
const OK_STATUSES = new Set(["verified", "detected", "partner_registered"]);
function parsePayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  return payload as Record<string, unknown>;
}
function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
export function parseX402SignalState(signals: SignalRow[]): X402DisplayState {
  const detectedSig = signals.find((s) => s.signalType === "x402_detected");
  const payableSig = signals.find((s) => s.signalType === "x402_payable");
  const detectedPayload = parsePayload(detectedSig?.payloadJson);
  const detected = detectedSig ? OK_STATUSES.has(detectedSig.status) : false;
  const payable = payableSig ? OK_STATUSES.has(payableSig.status) : false;
  const hints = Array.isArray(detectedPayload?.hints)
    ? (detectedPayload.hints as unknown[]).filter((h): h is string => typeof h === "string")
    : [];
  const paymentHeaders = Array.isArray(detectedPayload?.paymentHeaders)
    ? (detectedPayload.paymentHeaders as unknown[]).filter((h): h is string => typeof h === "string")
    : [];
  const httpStatus =
    typeof detectedPayload?.statusCode === "number" ? detectedPayload.statusCode : null;
  let failureReason: string | null = null;
  if (detectedSig?.status === "failed") {
    failureReason = hints[0] ?? "x402 scan did not detect payment readiness";
  } else if (!detected && detectedSig) {
    failureReason = hints[0] ?? "Endpoint not reachable or no x402 signals found";
  }
  return {
    detected,
    payable,
    httpStatus,
    endpoint: detectedSig?.value?.trim() || null,
    hints,
    paymentHeaders,
    priceHint: stringOrNull(detectedPayload?.priceHint),
    assetHint: stringOrNull(detectedPayload?.assetHint),
    recipientHint: stringOrNull(detectedPayload?.recipientHint),
    lastScanned: detectedSig?.lastCheckedAt ?? payableSig?.lastCheckedAt ?? null,
    failureReason,
  };
}
export function x402SummaryLabel(state: X402DisplayState): string {
  if (state.payable) return "x402 payable";
  if (state.detected) return "x402 detected";
  if (state.failureReason) return "Not ready";
  return "Not scanned";
}
