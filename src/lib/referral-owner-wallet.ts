import { PublicKey } from "@solana/web3.js";
/**
 * Canonical Solana pubkey base58 for referral owner lookups (trim + stable encoding).
 * Falls back to trimmed input if it is not a valid Solana address.
 */
export function normalizeReferralOwnerWallet(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    return new PublicKey(t).toBase58();
  } catch {
    return t;
  }
}