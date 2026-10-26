import { getChainByChainId } from "./chains";
const DEFAULT_MAINNET_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
/**
 * Returns the ERC-8004 IdentityRegistry contract address for the given chain.
 * Mainnet chains use 0x8004A169...; Base Sepolia and Sepolia use 0x8004A818...
 */
export function getIdentityRegistryAddress(chainId: number): `0x${string}` {
  const config = getChainByChainId(chainId);
  return (config?.identityRegistry ?? DEFAULT_MAINNET_REGISTRY) as `0x${string}`;
}