import { PublicKey } from "@solana/web3.js";
const FAKE_WALLET_PREFIX = /^(profile|user|agent):/i;
/** Reject internal placeholders like `profile:5` — not Solana addresses. */
export function isFakeWalletPlaceholder(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return FAKE_WALLET_PREFIX.test(trimmed);
}
export function isValidSolanaPublicKey(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed || isFakeWalletPlaceholder(trimmed)) return false;
  try {
    const key = new PublicKey(trimmed);
    return key.toBase58() === trimmed;
  } catch {
    return false;
  }
}
/** Prefer custodial / metadata keys; never treat owner placeholders as wallets. */
export function resolveDisplaySolanaPublicKey(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (isValidSolanaPublicKey(candidate)) {
      return candidate!.trim();
    }
  }
  return null;
}
