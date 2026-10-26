"use client";
/**
 * Wagmi provider for the Agent Dashboard (dashboard).
 * Uses @privy-io/wagmi so Privy embedded wallets sync as wagmi connectors —
 * required for useSendTransaction / useSwitchChain on agent EVM wallets.
 */
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { WagmiProvider as PlainWagmiProvider, http } from "wagmi";
import { defineChain, fallback, http as httpViem } from "viem";
import { mainnet } from "viem/chains";
import { MAINNET_BROWSER_RPC_URLS } from "@/lib/cors-rpc-urls";
import { robinhoodChain } from "@/lib/robinhood-chain/config";
// Must match DashboardPrivyProvider: without an app id there is no PrivyProvider,
// and the Privy wagmi bridge cannot mount outside one.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || "";
const mainnetRpcList = [...MAINNET_BROWSER_RPC_URLS];
const mainnetCors = defineChain({
  ...mainnet,
  rpcUrls: { default: { http: mainnetRpcList.slice(0, 12) } },
});
const mainnetTransport = fallback(mainnetRpcList.map((url) => httpViem(url)));
export const dashboardWagmiConfig = createConfig({
  chains: [robinhoodChain, mainnetCors],
  transports: {
    [mainnetCors.id]: mainnetTransport,
    [robinhoodChain.id]: http(robinhoodChain.rpcUrls.default.http[0]),
  },
});
export function DashboardWalletProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  if (!PRIVY_APP_ID) {
    return <PlainWagmiProvider config={dashboardWagmiConfig}>{children}</PlainWagmiProvider>;
  }
  return <WagmiProvider config={dashboardWagmiConfig}>{children}</WagmiProvider>;
}
