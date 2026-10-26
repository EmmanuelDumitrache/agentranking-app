const SIGNAL_OK = new Set(["verified", "detected", "partner_registered"]);
export type PublicTrustFlags = {
  x402Detected: boolean;
  x402Payable: boolean;
  devProofActive: boolean;
  officialLinksLocked: boolean;
};
type SignalLike = { signalType: string; status: string };
export function derivePublicTrustFlags(signals: SignalLike[]): PublicTrustFlags {
  const has = (type: string) =>
    signals.some((s) => s.signalType === type && SIGNAL_OK.has(s.status));
  return {
    x402Detected: has("x402_detected"),
    x402Payable: has("x402_payable"),
    devProofActive: has("devproof_active"),
    officialLinksLocked: has("official_links_locked"),
  };
}