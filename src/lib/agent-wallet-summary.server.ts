/**
 * Shared wallet-summary service for the Agent Dashboard.
 * Returns a serialisable combined view of Solana + EVM wallets for one agent.
 */
import "server-only";

import { loadAgentEvmWalletSnapshot } from "@/lib/agent-evm-wallet.server";
import { getSolUsdPrice } from "@/lib/solana-price";
import { getEthUsdPrice } from "@/lib/eth-price";
import { getWalletBalances } from "@/features/agent-chat/server/tools/wallet-balance";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";
import {
  ethereumMainnetExplorerUrl,
  robinhoodChainExplorerUrl,
  ETHEREUM_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_NAME,
  EVM_CHAIN_ID,
  EVM_NETWORK_NAME,
} from "@/lib/evm-wallet-utils";

export type WalletSummaryChainBalances = {
  native: string;
  nativeSymbol: string;
  nativeRaw: string | null;
  nativeDisplay: string;
  usdc: string;
  ar: string;
};

export type WalletSummaryChain = {
  networkName: string;
  chainId: number;
  explorerUrl: string | null;
  balances: WalletSummaryChainBalances;
  estimatedUsd: number | null;
};

export type WalletSummaryNetwork = {
  configured: boolean;
  address: string | null;
  explorerUrl: string | null;
  balances: WalletSummaryChainBalances;
  estimatedUsd: number | null;
  status?: string;
  provider?: string;
};

export type AgentWalletSummary = {
  agentId: number;
  estimatedUsdValue: number | null;
  solPrice: number | null;
  ethPrice: number | null;
  solana: WalletSummaryNetwork & { isCustodial: boolean };
  evm: WalletSummaryNetwork & {
    chainId: number;
    networkName: string;
    provider: string | null;
    status: string;
    isCustodial: boolean;
    mainnet: WalletSummaryChain;
    robinhood: WalletSummaryChain;
  };
};

type EvmBalance = { wei: string; ether: string } | null;

function chainBalanceFromEth(balance: EvmBalance): WalletSummaryChainBalances {
  return {
    native: balance?.ether ?? "—",
    nativeSymbol: "ETH",
    nativeRaw: balance?.wei ?? null,
    nativeDisplay: balance?.ether ?? "—",
    usdc: "—",
    ar: "—",
  };
}

function ethUsd(balance: EvmBalance, ethPrice: number | null): number {
  if (!balance || ethPrice == null) return 0;
  const value = Number.parseFloat(balance.ether);
  return Number.isFinite(value) ? value * ethPrice : 0;
}

function formatRawTokenAmount(
  balance: { amount: string; decimals: number } | null,
): string {
  if (!balance) return "0";
  try {
    const raw = BigInt(balance.amount);
    const scale = 10n ** BigInt(balance.decimals);
    const whole = raw / scale;
    const fraction = (raw % scale)
      .toString()
      .padStart(balance.decimals, "0")
      .replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "0";
  }
}

export async function loadAgentWalletSummary(
  agentDbId: number,
): Promise<AgentWalletSummary> {
  const [solPrice, ethPrice, solana, evmWallet] = await Promise.all([
    getSolUsdPrice(),
    getEthUsdPrice(),
    getWalletBalances(agentDbId),
    loadAgentEvmWalletSnapshot(agentDbId),
  ]);

  const solBalanceLamports = solana.solBalanceLamports;
  const solNative =
    solBalanceLamports == null
      ? "0"
      : (solBalanceLamports / 1_000_000_000)
          .toFixed(9)
          .replace(/\.?0+$/, "");
  const usdcDisplay = formatRawTokenAmount(solana.usdcBalance);
  const arDisplay = formatRawTokenAmount(solana.arBalance);
  const solUsd =
    solBalanceLamports != null && solPrice != null
      ? (solBalanceLamports / 1_000_000_000) * solPrice
      : 0;
  const usdcUsd = Number.parseFloat(usdcDisplay);
  const solTotalUsd = solUsd + (Number.isFinite(usdcUsd) ? usdcUsd : 0);

  const mainnetBalance = evmWallet.balances.mainnet;
  const robinhoodBalance = evmWallet.balances.robinhood;
  const mainnetUsd = ethUsd(mainnetBalance, ethPrice);
  const robinhoodUsd = ethUsd(robinhoodBalance, ethPrice);
  const evmUsd = mainnetUsd + robinhoodUsd;
  const totalUsd = solTotalUsd + evmUsd;
  const solanaExplorer = solana.publicKey
    ? solscanAccountUrlForNetwork(solana.publicKey, solana.network)
    : null;

  return {
    agentId: agentDbId,
    estimatedUsdValue: totalUsd > 0 ? totalUsd : null,
    solPrice,
    ethPrice,
    solana: {
      configured: Boolean(solana.publicKey),
      address: solana.publicKey,
      explorerUrl: solanaExplorer,
      balances: {
        native: solNative,
        nativeSymbol: "SOL",
        nativeRaw:
          solBalanceLamports != null ? String(solBalanceLamports) : null,
        nativeDisplay: solNative,
        usdc: usdcDisplay,
        ar: arDisplay,
      },
      estimatedUsd: solTotalUsd > 0 ? solTotalUsd : null,
      isCustodial: solana.isCustodial,
    },
    evm: {
      configured: evmWallet.configured,
      address: evmWallet.address,
      chainId: evmWallet.chainId,
      networkName: EVM_NETWORK_NAME,
      explorerUrl: evmWallet.address
        ? ethereumMainnetExplorerUrl(evmWallet.address)
        : null,
      balances: chainBalanceFromEth(mainnetBalance),
      estimatedUsd: evmUsd > 0 ? evmUsd : null,
      status: evmWallet.status,
      provider: evmWallet.provider,
      isCustodial: evmWallet.isCustodial,
      mainnet: {
        networkName: ETHEREUM_MAINNET_NAME,
        chainId: ETHEREUM_MAINNET_CHAIN_ID,
        explorerUrl: evmWallet.address
          ? ethereumMainnetExplorerUrl(evmWallet.address)
          : null,
        balances: chainBalanceFromEth(mainnetBalance),
        estimatedUsd: mainnetUsd > 0 ? mainnetUsd : null,
      },
      robinhood: {
        networkName: EVM_NETWORK_NAME,
        chainId: EVM_CHAIN_ID,
        explorerUrl: evmWallet.address
          ? robinhoodChainExplorerUrl(evmWallet.address)
          : null,
        balances: chainBalanceFromEth(robinhoodBalance),
        estimatedUsd: robinhoodUsd > 0 ? robinhoodUsd : null,
      },
    },
  };
}
