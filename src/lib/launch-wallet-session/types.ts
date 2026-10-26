import type { LaunchWalletChain } from "@/lib/launch-wallet-session/constants";

export type LaunchWalletSessionState = {
  authenticated: boolean;
  wallet: string | null;
  chain: LaunchWalletChain | null;
  expiresAt: string | null;
};

export const ANONYMOUS_LAUNCH_WALLET_SESSION: LaunchWalletSessionState = {
  authenticated: false,
  wallet: null,
  chain: null,
  expiresAt: null,
};
