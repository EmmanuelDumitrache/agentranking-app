"use client";
/**
 * PrivyProvider wrapper for the AgentRanking dashboard.
 * Wraps around the existing WagmiProvider/RainbowKitProvider to add
 * Privy embedded wallet support for Robinhood Chain 4663.
 *
 * Key decisions:
 * - Robinhood Chain (4663) is the default chain for embedded wallets
 * - `loginMethods: ["email"]` satisfies the SDK/Dashboard requirement for
 *   at least one login method. It is NEVER shown to the user because:
 *   a) We never call Privy's login()
 *   b) The PrivyAuthBridge authenticates the user silently via JWT
 * - Embedded wallets are created lazily on explicit user click
 * - The provider is rendered ONLY when NEXT_PUBLIC_PRIVY_APP_ID is set.
 */
import { PrivyProvider } from "@privy-io/react-auth";
import { mainnet } from "viem/chains";
import { robinhoodChain } from "@/lib/robinhood-chain/config";
import { PrivyAuthBridge } from "@/components/dashboard/privy-auth-bridge";
// NEXT_PUBLIC_* is inlined for both SSR and client. Do not gate on `window` —
// skipping PrivyProvider during SSR makes useWallets() throw and 500 agent pages.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || "";
export function DashboardPrivyProvider({ children }: { readonly children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    return <>{children}</>;
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Robinhood Chain default; Ethereum mainnet supported for funding / sends
        defaultChain: robinhoodChain,
        supportedChains: [robinhoodChain, mainnet],
        // At least one login method must be listed for the SDK to initialise.
        // This is NEVER shown to users — the PrivyAuthBridge handles auth silently.
        loginMethods: ["email"],
        embeddedWallets: {
          // Lazy wallet creation: user must explicitly click "Set up EVM wallet"
          ethereum: { createOnLogin: "off" as const },
          showWalletUIs: true,
        },
        appearance: {
          theme: "dark",
          accentColor: "#22c55e",
          walletChainType: "ethereum-only",
          // Do not let Privy's default wallet list instantiate Base Account
          // (formerly Coinbase Smart Wallet): it rejects Robinhood Chain 4663.
          // Dashboard execution uses the Privy embedded wallet; these entries
          // are only interoperable external-wallet fallbacks.
          walletList: [
            "metamask",
            "rainbow",
            "detected_ethereum_wallets",
            "wallet_connect_qr",
          ],
        },
      }}
    >
      <PrivyAuthBridge />
      {children}
    </PrivyProvider>
  );
}
