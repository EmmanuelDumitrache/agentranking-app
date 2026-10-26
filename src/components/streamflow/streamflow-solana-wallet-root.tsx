"use client";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TrustWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";
import { streamflowRpcEndpoint } from "@/lib/streamflow-stake-config";
export function StreamflowSolanaWalletRoot({
  children,
  autoConnect = false,
  phantomOnly = false,
}: Readonly<{ children: ReactNode; autoConnect?: boolean; phantomOnly?: boolean }>) {
  const endpoint = streamflowRpcEndpoint();
  /** Single Phantom adapter — avoids Wallet Standard duplicate registration that hangs on connect. */
  const wallets = useMemo(
    () =>
      phantomOnly
        ? [new PhantomWalletAdapter()]
        : [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new TrustWalletAdapter()],
    [phantomOnly],
  );
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={autoConnect}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
