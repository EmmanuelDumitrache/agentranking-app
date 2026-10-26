"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wallet-wagmi-config";
import { QueryProvider } from "@/providers/query-provider";
import "@rainbow-me/rainbowkit/styles.css";

const rainbowTheme = darkTheme({
  accentColor: "#22c55e",
  accentColorForeground: "black",
  borderRadius: "medium",
  fontStack: "system",
});

/**
 * Complete browser-wallet runtime for public and authentication routes.
 *
 * Wagmi and RainbowKit use TanStack Query internally, so the query provider is
 * intentionally part of this boundary rather than relying on an unrelated
 * ancestor layout to supply it.
 */
export function WalletProvider({ children }: { readonly children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryProvider>
        <RainbowKitProvider theme={rainbowTheme}>{children}</RainbowKitProvider>
      </QueryProvider>
    </WagmiProvider>
  );
}

export default WalletProvider;
