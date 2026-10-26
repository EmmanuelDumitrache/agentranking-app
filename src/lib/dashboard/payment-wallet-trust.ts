export type PaymentWalletTrust = "matches_verified" | "unverified" | "missing";
export function normalizeWalletAddress(addr: string): string {
  const wallet = addr.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : wallet;
}
export function classifyPaymentWalletTrust(
  paymentWallet: string | null | undefined,
  trustedWallets: string[],
): PaymentWalletTrust {
  const wallet = paymentWallet?.trim();
  if (!wallet) return "missing";
  const normalized = normalizeWalletAddress(wallet);
  const trusted = new Set(trustedWallets.map(normalizeWalletAddress).filter(Boolean));
  if (trusted.has(normalized)) return "matches_verified";
  return "unverified";
}
export function paymentWalletTrustLabel(trust: PaymentWalletTrust): string {
  switch (trust) {
    case "matches_verified":
      return "Matches verified wallet";
    case "unverified":
      return "Unverified payment wallet";
    default:
      return "No payment wallet added";
  }
}
