/** CREATE2 vanity Validation Registry — mainnet family (shared across EVM mainnets). */
export const ERC8004_MAINNET_VALIDATION_REGISTRY =
  "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as const;
/** CREATE2 vanity Validation Registry — testnet family. */
export const ERC8004_TESTNET_VALIDATION_REGISTRY =
  "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as const;
const MAINNET_IDENTITY = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
const TESTNET_IDENTITY = "0x8004a818bfb912233c491871b3d84c89a494bd9e";
/** Resolve Validation Registry address from Identity Registry deployment. */
export function resolveValidationRegistry(identityRegistry: string): string {
  const id = identityRegistry.trim().toLowerCase();
  if (id === MAINNET_IDENTITY) return ERC8004_MAINNET_VALIDATION_REGISTRY;
  if (id === TESTNET_IDENTITY) return ERC8004_TESTNET_VALIDATION_REGISTRY;
  return "";
}