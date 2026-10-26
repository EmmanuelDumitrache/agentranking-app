"use client";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  walletConnectWallet,
  rainbowWallet,
  trustWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { cookieStorage, createConfig, createConnector, createStorage, http } from "wagmi";
import { defineChain, fallback, http as httpViem } from "viem";
import { injected } from "wagmi/connectors";
import type { Wallet } from "@rainbow-me/rainbowkit";
import {
  BASE_SEPOLIA_BROWSER_RPC_URLS,
  MAINNET_BROWSER_RPC_URLS,
  SEPOLIA_BROWSER_RPC_URLS,
} from "@/lib/cors-rpc-urls";
import { robinhoodChain } from "@/lib/robinhood-chain/config";
import {
  mainnet,
  polygon,
  arbitrum,
  base,
  baseSepolia,
  sepolia,
  gnosis,
  scroll,
  optimism,
  bsc,
  avalanche,
  celo,
  linea,
  mantle,
  soneium,
  taiko,
  plasma,
  megaeth,
  abstract,
  skaleEuropa,
} from "wagmi/chains";
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "demo_project_id_replace_me";
const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { decimals: 18, name: "MON", symbol: "MON" },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monadscan", url: "https://monadscan.com" } },
});
const billions = defineChain({
  id: 45056,
  name: "Billions",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  rpcUrls: { default: { http: ["https://billions-blockscout.eu-north-2.gateway.fm"] } },
  blockExplorers: { default: { name: "Billions Blockscout", url: "https://billions-blockscout.eu-north-2.gateway.fm" } },
});
const injectiveEvm = defineChain({
  id: 1776,
  name: "Injective",
  nativeCurrency: { decimals: 18, name: "Injective", symbol: "INJ" },
  rpcUrls: { default: { http: ["https://sentry.evm-rpc.injective.network/"] } },
  blockExplorers: { default: { name: "Injective Blockscout", url: "https://blockscout.injective.network" } },
});
const tempo = defineChain({
  id: 4217,
  name: "Tempo",
  nativeCurrency: { decimals: 18, name: "USD", symbol: "USD" },
  rpcUrls: { default: { http: ["https://rpc.tempo.xyz"] } },
  blockExplorers: { default: { name: "Tempo Explorer", url: "https://explore.tempo.xyz" } },
});
const lukso = defineChain({
  id: 42,
  name: "LUKSO",
  nativeCurrency: { decimals: 18, name: "LYX", symbol: "LYX" },
  rpcUrls: { default: { http: ["https://42.rpc.thirdweb.com"] } },
  blockExplorers: { default: { name: "LUKSO Explorer", url: "https://explorer.execution.mainnet.lukso.network" } },
});
const gateLayer = defineChain({
  id: 10088,
  name: "Gate Layer Mainnet",
  nativeCurrency: { decimals: 18, name: "GT", symbol: "GT" },
  rpcUrls: { default: { http: ["https://gatelayer-mainnet.gatenode.cc"] } },
  blockExplorers: { default: { name: "GateScan", url: "https://www.gatescan.org/gatelayer" } },
});
const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc",
  nativeCurrency: { decimals: 18, name: "USD Coin", symbol: "USDC" },
  rpcUrls: {
    default: {
      http: [
        "https://rpc.testnet.arc.io",
        "https://rpc.drpc.testnet.arc.io",
        "https://rpc.quicknode.testnet.arc.io",
      ],
    },
  },
  blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});
const shape = defineChain({
  id: 360,
  name: "Shape",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  rpcUrls: { default: { http: ["https://mainnet.shape.network"] } },
  blockExplorers: { default: { name: "ShapeScan", url: "https://shapescan.xyz" } },
});
const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { decimals: 18, name: "OKB", symbol: "OKB" },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKLink", url: "https://www.oklink.com/xlayer" } },
});
const goatNetwork = defineChain({
  id: 2345,
  name: "GOAT Network",
  nativeCurrency: { decimals: 18, name: "Bitcoin", symbol: "BTC" },
  rpcUrls: { default: { http: ["https://rpc.goat.network"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.goat.network" } },
});
const metis = defineChain({
  id: 1088,
  name: "Metis",
  nativeCurrency: { decimals: 18, name: "Metis", symbol: "METIS" },
  rpcUrls: { default: { http: ["https://andromeda.metis.io/?owner=1088"] } },
  blockExplorers: { default: { name: "Andromeda Explorer", url: "https://andromeda-explorer.metis.io" } },
});
const skaleBase = defineChain({
  id: 1187947933,
  name: "SKALE Base",
  nativeCurrency: { decimals: 18, name: "sFUEL", symbol: "sFUEL" },
  rpcUrls: { default: { http: ["https://skale-base.skalenodes.com/v1/base"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://skale-base-explorer.skalenodes.com" } },
});
type InjectedEthereumCandidate = {
  isPhantom?: boolean;
  providers?: InjectedEthereumCandidate[];
};
/**
 * RainbowKit's default `injectedWallet` uses the first `ethereum.providers` entry, which is
 * often Phantom. Phantom then receives EIP-1193 calls and shows "Unsupported account" for
 * Solana-only profiles. Prefer any other injected wallet in the same multi-provider bundle.
 */
function getNonPhantomEthereumInjectedProvider(): unknown {
  if (typeof window === "undefined") return undefined;
  const ethereum = (window as Window & { ethereum?: InjectedEthereumCandidate }).ethereum;
  if (!ethereum) return undefined;
  const candidates: InjectedEthereumCandidate[] =
    ethereum.providers && ethereum.providers.length > 0 ? ethereum.providers : [ethereum];
  return candidates.find((p) => !p?.isPhantom);
}
/** True when an EVM browser wallet (MetaMask, etc.) is available — not Solana-only Phantom. */
export function hasBrowserEvmWallet(): boolean {
  return !!getNonPhantomEthereumInjectedProvider();
}
/** Same icon as RainbowKit's Browser Wallet (avoids deep package imports in the bundler). */
const BROWSER_WALLET_ICON_URL =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2228%22%20height%3D%2228%22%20fill%3D%22none%22%3E%3Cpath%20fill%3D%22%23fff%22%20d%3D%22M0%200h28v28H0z%22%2F%3E%3Crect%20width%3D%2220%22%20height%3D%2216%22%20x%3D%224%22%20y%3D%226%22%20fill%3D%22url(%23a)%22%20rx%3D%223.5%22%2F%3E%3Cpath%20fill%3D%22%230E76FD%22%20d%3D%22M16%2014a3%203%200%200%201%203-3h4.4c.56%200%20.84%200%201.054.109a1%201%200%200%201%20.437.437C25%2011.76%2025%2012.04%2025%2012.6v2.8c0%20.56%200%20.84-.109%201.054a1%201%200%200%201-.437.437C24.24%2017%2023.96%2017%2023.4%2017H19a3%203%200%200%201-3-3Z%22%2F%3E%3Ccircle%20cx%3D%2219%22%20cy%3D%2214%22%20r%3D%221.25%22%20fill%3D%22%23A3D7FF%22%2F%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22a%22%20x1%3D%2214%22%20x2%3D%2214%22%20y1%3D%226%22%20y2%3D%2222%22%20gradientUnits%3D%22userSpaceOnUse%22%3E%3Cstop%20stop-color%3D%22%23174299%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23001E59%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3C%2Fsvg%3E";
const injectedWalletExcludingPhantom = (): Wallet => ({
  id: "injected",
  name: "Browser Wallet",
  iconUrl: BROWSER_WALLET_ICON_URL,
  iconBackground: "#fff",
  installed: typeof window !== "undefined" && !!getNonPhantomEthereumInjectedProvider(),
  createConnector: (walletDetails) => {
    const provider = getNonPhantomEthereumInjectedProvider();
    const injectedOptions = provider
      ? { target: () => ({ id: "injected", name: "Browser Wallet", provider }) }
      : {};
    return createConnector((config) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EIP-1193 provider from window.ethereum.providers
      ...injected(injectedOptions as any)(config),
      ...walletDetails,
    }));
  },
});
/** Get MetaMask provider even when Phantom (or others) overrides window.ethereum */
function getMetaMaskProvider(): unknown {
  if (typeof window === "undefined") return undefined;
  const ethereum = (window as Window & { ethereum?: { providers?: unknown[]; isMetaMask?: boolean } }).ethereum;
  if (!ethereum) return undefined;
  if (ethereum.providers) {
    const mm = ethereum.providers.find((p: { isMetaMask?: boolean }) => p?.isMetaMask);
    return mm ?? ethereum;
  }
  return ethereum.isMetaMask ? ethereum : undefined;
}
const metaMaskWalletCustom = (): Wallet => ({
  id: "metaMask",
  name: "MetaMask",
  rdns: "io.metamask",
  iconUrl: "https://images.ctfassets.net/clixtyxoaeas/4rnpEzy1ATWRKVBOLxZ1Fm/a74dc1eed36d23d7ea6030383a4d5163/MetaMask-icon-fox.svg",
  iconAccent: "#f6851a",
  iconBackground: "#fff",
  installed: typeof window !== "undefined" && !!getMetaMaskProvider(),
  downloadUrls: {
    android: "https://play.google.com/store/apps/details?id=io.metamask",
    ios: "https://apps.apple.com/us/app/metamask/id1438144202",
    mobile: "https://metamask.io/download",
    qrCode: "https://metamask.io/download",
    chrome: "https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn",
    edge: "https://microsoftedge.microsoft.com/addons/detail/metamask/ejbalbakoplchlghecdalmeeeajnimhm",
    firefox: "https://addons.mozilla.org/firefox/addon/ether-metamask",
    opera: "https://addons.opera.com/extensions/details/metamask-10",
    browserExtension: "https://metamask.io/download",
  },
  createConnector: (walletDetails) => {
    const provider = getMetaMaskProvider();
    const injectedOptions = provider
      ? { target: () => ({ id: "metaMask", name: "MetaMask", provider }) }
      : {};
    return createConnector((config) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider from window.ethereum.providers is compatible
      ...injected(injectedOptions as any)(config),
      ...walletDetails,
    }));
  },
});
// Phantom is intentionally omitted here: RainbowKit's phantomWallet is Ethereum-only.
// Solana-only Phantom accounts show "Unsupported account" for EIP-1193. Use Solana
// wallet-adapter pages (e.g. Streamflow) for Phantom on Solana; use MetaMask / browser / WC for EVM.
// Default RainbowKit `injectedWallet` picks providers[0] (often Phantom) — use injectedWalletExcludingPhantom.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      // RainbowKit 2.2.11 aliases `coinbaseWallet` to Base Account (smart wallet),
      // which rejects AgentRanking's custom Robinhood Chain 4663 during connector
      // construction. Coinbase EOA/mobile users remain reachable through EIP-6963
      // Browser Wallet and WalletConnect without instantiating that incompatible connector.
      wallets: [metaMaskWalletCustom, walletConnectWallet],
    },
    {
      groupName: "More",
      wallets: [rainbowWallet, trustWallet, injectedWalletExcludingPhantom],
    },
  ],
  { appName: "AgentRanking", projectId }
);
const HTTP_RPC_TIMEOUT_MS = 14_000;
/** Comma/semicolon/whitespace-separated Infura project keys (browser — still public in network tab). */
function parseEnvKeyList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}
/**
 * Multiple keys so viem `fallback` can rotate past quota / 402 (RainbowKit ENS on mainnet hits RPC hard).
 * Set `NEXT_PUBLIC_INFURA_API_KEYS=key1,key2` or `NEXT_PUBLIC_INFURA_API_KEY` + `NEXT_PUBLIC_INFURA_API_KEY_2`…`_8`.
 */
function collectNextPublicInfuraKeys(): string[] {
  const fromPlural = parseEnvKeyList(process.env.NEXT_PUBLIC_INFURA_API_KEYS);
  if (fromPlural.length > 0) return fromPlural;
  const out: string[] = [];
  const primary = process.env.NEXT_PUBLIC_INFURA_API_KEY?.trim();
  if (primary) out.push(primary);
  for (let i = 2; i <= 8; i++) {
    const k = process.env[`NEXT_PUBLIC_INFURA_API_KEY_${i}`]?.trim();
    if (k) out.push(k);
  }
  return [...new Set(out)];
}
function buildHttpFallbackTransport(urls: readonly string[]) {
  const uniq = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (uniq.length === 0) {
    return httpViem(MAINNET_BROWSER_RPC_URLS[0], { timeout: HTTP_RPC_TIMEOUT_MS });
  }
  if (uniq.length === 1) {
    const [single] = uniq;
    return httpViem(single, { timeout: HTTP_RPC_TIMEOUT_MS });
  }
  return fallback(uniq.map((url) => httpViem(url, { timeout: HTTP_RPC_TIMEOUT_MS })));
}
const infuraKeys = collectNextPublicInfuraKeys();
/** CORS-safe Sepolia RPCs first — rpc.sepolia.org and exhausted Infura keys break browser receipt polling. */
const sepoliaRpcUrls: string[] = [];
const explicitSepolia = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL?.trim();
if (explicitSepolia) sepoliaRpcUrls.push(explicitSepolia);
sepoliaRpcUrls.push(...SEPOLIA_BROWSER_RPC_URLS);
for (const key of infuraKeys) {
  sepoliaRpcUrls.push(`https://sepolia.infura.io/v3/${key}`);
}
const sepoliaRpcList = [...new Set(sepoliaRpcUrls)];
const sepoliaTransport = buildHttpFallbackTransport(sepoliaRpcList);
const sepoliaCors = defineChain({
  ...sepolia,
  rpcUrls: { default: { http: sepoliaRpcList.slice(0, 8) } },
});
const baseSepoliaRpcUrls: string[] = [];
const explicitBaseSepolia = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL?.trim();
if (explicitBaseSepolia) baseSepoliaRpcUrls.push(explicitBaseSepolia);
baseSepoliaRpcUrls.push(...BASE_SEPOLIA_BROWSER_RPC_URLS);
for (const key of infuraKeys) {
  baseSepoliaRpcUrls.push(`https://base-sepolia.infura.io/v3/${key}`);
}
const baseSepoliaRpcList = [...new Set(baseSepoliaRpcUrls)];
const baseSepoliaTransport = buildHttpFallbackTransport(baseSepoliaRpcList);
/**
 * Ethereum L1 in the browser: viem's mainnet chain default is https://eth.merkle.io (no CORS).
 * RainbowKit calls useEnsName({ chainId: 1 }) — viem http("") or http() uses chain.rpcUrls, so we must:
 * - Never pass an empty URL (empty env var → http("") → falls back to merkle per viem http transport)
 * - Override mainnet rpcUrls so any default-RPC path is CORS-safe
 * - Use fallback across Infura keys + public RPCs when one returns 402 / rate limits
 */
const mainnetRpcUrls: string[] = [];
const explicitMainnet = process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL?.trim();
if (explicitMainnet) mainnetRpcUrls.push(explicitMainnet);
mainnetRpcUrls.push(...MAINNET_BROWSER_RPC_URLS);
for (const key of infuraKeys) {
  mainnetRpcUrls.push(`https://mainnet.infura.io/v3/${key}`);
}
const mainnetRpcList = [...new Set(mainnetRpcUrls)];
const mainnetTransport = buildHttpFallbackTransport(mainnetRpcList);
const mainnetCors = defineChain({
  ...mainnet,
  rpcUrls: { default: { http: mainnetRpcList.slice(0, 12) } },
});
const chains = [
  base,
  baseSepolia,
  mainnetCors,
  sepoliaCors,
  polygon,
  arbitrum,
  optimism,
  bsc,
  avalanche,
  celo,
  gnosis,
  scroll,
  linea,
  mantle,
  soneium,
  shape,
  xLayer,
  goatNetwork,
  metis,
  skaleBase,
  monadMainnet,
  taiko,
  plasma,
  megaeth,
  abstract,
  skaleEuropa,
  billions,
  injectiveEvm,
  tempo,
  lukso,
  gateLayer,
  arcTestnet,
  robinhoodChain,
] as const;
function buildWagmiConfig() {
  return createConfig({
    connectors,
    chains,
    multiInjectedProviderDiscovery: false,
    storage: createStorage({ storage: cookieStorage }),
    transports: {
      [base.id]: http(),
      [baseSepolia.id]: baseSepoliaTransport,
      [mainnetCors.id]: mainnetTransport,
      [sepoliaCors.id]: sepoliaTransport,
      [polygon.id]: http(),
      [arbitrum.id]: http(),
      [optimism.id]: http(),
      [bsc.id]: http(),
      [avalanche.id]: http(),
      [celo.id]: http(),
      [gnosis.id]: http(),
      [scroll.id]: http(),
      [linea.id]: http(),
      [mantle.id]: http(),
      [soneium.id]: http(),
      [shape.id]: http(),
      [xLayer.id]: http(),
      [goatNetwork.id]: http(),
      [metis.id]: http(),
      [skaleBase.id]: http(),
      [monadMainnet.id]: http(),
      [taiko.id]: http(),
      [plasma.id]: http(),
      [megaeth.id]: http(),
      [abstract.id]: http(),
      [skaleEuropa.id]: http(),
      [billions.id]: http(),
      [injectiveEvm.id]: http(),
      [tempo.id]: http(),
      [lukso.id]: http(),
      [gateLayer.id]: http(),
      [arcTestnet.id]: http(),
      [robinhoodChain.id]: http(robinhoodChain.rpcUrls.default.http[0]),
    },
    ssr: true,
  });
}
type WagmiConfig = ReturnType<typeof buildWagmiConfig>;
const globalForWagmi = globalThis as typeof globalThis & {
  __agentRankingWagmiConfig?: WagmiConfig;
};
/** Singleton — HMR must not call WalletConnect `init()` twice in dev. */
export const wagmiConfig: WagmiConfig =
  globalForWagmi.__agentRankingWagmiConfig ?? buildWagmiConfig();
if (process.env.NODE_ENV !== "production") {
  globalForWagmi.__agentRankingWagmiConfig = wagmiConfig;
}