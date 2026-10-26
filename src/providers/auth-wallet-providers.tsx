"use client";

import { WalletProvider } from "@/providers/wallet-provider";

/** Public/auth browser-wallet scope, including Wagmi's required query runtime. */
export function AuthWalletProviders({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <WalletProvider>{children}</WalletProvider>;
}
