/** Deployment tier helpers for the VPS-hosted application. */
function isProductionDeploy(): boolean {
  return process.env.NODE_ENV === "production";
}
/** Honour client-sent testnet flags only outside production and when explicitly enabled. */
export function allowClientTestnetFromServer(): boolean {
  if (isProductionDeploy()) return false;
  return process.env.ALLOW_CLIENT_TESTNET === "true";
}
/** Payment test mode is never enabled in production. */
export function isPromotionTestModeEnabled(): boolean {
  if (isProductionDeploy()) return false;
  return process.env.PROMOTION_TESTNET_MODE === "true";
}
