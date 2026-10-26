import { getAddress, isAddress } from "viem";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import type { LaunchWalletChain } from "@/lib/launch-wallet-session/constants";

export function normalizeLaunchWallet(chain: LaunchWalletChain, wallet: string): string | null {
  const trimmed = wallet.trim();
  if (!trimmed) return null;
  if (chain === "evm") {
    if (!isAddress(trimmed)) return null;
    return getAddress(trimmed).toLowerCase();
  }
  return normalizeSolanaAddress(trimmed);
}

export function walletsMatch(chain: LaunchWalletChain, a: string, b: string): boolean {
  const left = normalizeLaunchWallet(chain, a);
  const right = normalizeLaunchWallet(chain, b);
  return Boolean(left && right && left === right);
}

export function assertImmutableCreatorWallet(
  existingWallet: string | null | undefined,
  nextWallet: string | undefined,
  chain: LaunchWalletChain,
): { ok: true } | { ok: false; error: string } {
  if (nextWallet === undefined) return { ok: true };
  const existing = existingWallet?.trim();
  if (!existing) return { ok: true };
  if (!walletsMatch(chain, existing, nextWallet)) {
    return { ok: false, error: "Creator wallet cannot be changed after it is set." };
  }
  return { ok: true };
}
