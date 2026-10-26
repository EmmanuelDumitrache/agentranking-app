import bs58 from "bs58";
import { SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR } from "./constants.js";

export const SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR_BASE58 = bs58.encode(
  SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR,
);

export function hasAgentAccountDiscriminator(bytes: Uint8Array): boolean {
  if (bytes.byteLength < SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR.byteLength) return false;
  for (let index = 0; index < SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR.byteLength; index += 1) {
    if (bytes[index] !== SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR[index]) return false;
  }
  return true;
}
