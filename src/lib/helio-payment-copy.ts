/** Shared copy for Helio + MoonPay checkout (card/crypto → USDC on Solana). */
export function helioPaymentGatewayLabel(): string {
  return "Helio · MoonPay";
}
export function helioSettlementLabel(): string {
  return "USDC on Solana";
}
export function helioCheckoutSubtitle(): string {
  return "Card or crypto via MoonPay. Payment settles as USDC on Solana.";
}
export function isHelioCheckoutProduct(productType: string): boolean {
  switch (productType) {
    case "ad":
    case "kya_verify":
    case "verification_bundle":
    case "power_boost":
    case "pro_subscription":
    case "card_treasury":
      return true;
    default:
      return false;
  }
}