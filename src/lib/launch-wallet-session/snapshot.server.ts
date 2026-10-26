import "server-only";
import { getLaunchWalletSession } from "@/lib/launch-wallet-session/session";
import {
  ANONYMOUS_LAUNCH_WALLET_SESSION,
  type LaunchWalletSessionState,
} from "@/lib/launch-wallet-session/types";

export async function readLaunchWalletSessionSnapshot(): Promise<LaunchWalletSessionState> {
  const session = await getLaunchWalletSession();
  if (!session) return ANONYMOUS_LAUNCH_WALLET_SESSION;
  return {
    authenticated: true,
    wallet: session.wallet,
    chain: session.chain,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}
