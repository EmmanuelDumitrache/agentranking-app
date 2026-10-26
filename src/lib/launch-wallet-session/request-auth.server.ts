import "server-only";
import type { LaunchWalletChain } from "@/lib/launch-wallet-session/constants";
import { getLaunchWalletSessionFromRequest } from "@/lib/launch-wallet-session/session";
import { normalizeLaunchWallet, walletsMatch } from "@/lib/launch-wallet-session/wallet-match";
export type WalletSessionAccessResult =
  | { readonly ok: true; readonly wallet: string }
  | { readonly ok: false; readonly status: 400 | 401 | 403; readonly error: string };
export async function requireLaunchWalletSessionForAddress(
  request: Request,
  chain: LaunchWalletChain,
  requestedWallet: string,
): Promise<WalletSessionAccessResult> {
  const normalized = normalizeLaunchWallet(chain, requestedWallet);
  if (!normalized) {
    return { ok: false, status: 400, error: "Invalid wallet address." };
  }
  const session = await getLaunchWalletSessionFromRequest(request);
  if (!session || session.chain !== chain) {
    return {
      ok: false,
      status: 401,
      error: `${chain === "solana" ? "Solana" : "EVM"} wallet verification is required.`,
    };
  }
  if (!walletsMatch(chain, session.wallet, normalized)) {
    return { ok: false, status: 403, error: "Verified wallet does not match the requested wallet." };
  }
  return { ok: true, wallet: normalized };
}
