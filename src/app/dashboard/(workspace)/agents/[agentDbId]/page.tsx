import { notFound } from "next/navigation";
import { DashboardSummary } from "@/components/dashboard/dashboard-summary";
import { getMfaFactorFlags } from "@/lib/account-security/flags";
import { loadAppAccountSummary } from "@/lib/app-account-summary";
import {
  loadDashboardAgentOverview,
  toDashboardAgentOverviewDto,
  loadAgentWalletDashboardBalances,
} from "@/lib/dashboard/agent-overview";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { getSolUsdPrice } from "@/lib/solana-price";
import { getEthUsdPrice } from "@/lib/eth-price";
import { getAgentEvmWallet } from "@/lib/agent-evm-wallet.server";
import {
  loadAgentEvmActivity,
  loadAgentWalletTransfers,
} from "@/lib/dashboard/wallet-page";
import { fetchEthereumMainnetEthBalance, fetchRobinhoodChainEthBalance } from "@/lib/evm-wallet-utils";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ agentDbId: string }> };
export default async function DashboardAgentPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  await requireDashboardAgentPage(id);
  const session = await getCachedDashboardSession();
  const profile = session ? await getDashboardUserProfile(session) : null;
  const [
    data,
    account,
    solPrice,
    ethPrice,
    evmWalletInfo,
    initialTransfers,
    initialEvmActivity,
  ] = await Promise.all([
    loadDashboardAgentOverview(id, {
      actorProfileId: profile?.id,
      autoProvisionWallet: false,
    }),
    loadAppAccountSummary(session),
    getSolUsdPrice(),
    getEthUsdPrice(),
    getAgentEvmWallet(id),
    loadAgentWalletTransfers(id, 10),
    loadAgentEvmActivity(id, 10),
  ]);
  if (!data || !account) notFound();
  const { solBalanceLamports, usdcBalanceRaw, arBalanceRaw } =
    await loadAgentWalletDashboardBalances(data.agentWalletPublicKey);
  const mfaEnabled = profile ? getMfaFactorFlags(profile).mfaRequired : false;
  let evmWallet: {
    configured: boolean;
    address: string | null;
    status: string;
    ethBalance: string | null;
    robinhoodEthBalance: string | null;
    ethPrice: number | null;
    provider?: string | null;
    isCustodial?: boolean;
  } | null = null;
  if (evmWalletInfo) {
    let ethBalance: string | null = null;
    let robinhoodEthBalance: string | null = null;
    if (evmWalletInfo.configured && evmWalletInfo.address) {
      const [mainnetBal, robinhoodBal] = await Promise.all([
        fetchEthereumMainnetEthBalance(evmWalletInfo.address),
        fetchRobinhoodChainEthBalance(evmWalletInfo.address),
      ]);
      ethBalance = mainnetBal?.ether ?? null;
      robinhoodEthBalance = robinhoodBal?.ether ?? null;
    }
    evmWallet = {
      configured: evmWalletInfo.configured,
      address: evmWalletInfo.address,
      status: evmWalletInfo.status,
      ethBalance,
      robinhoodEthBalance,
      ethPrice,
      provider: evmWalletInfo.provider,
      isCustodial: evmWalletInfo.isCustodial,
    };
  }
  return (
    <DashboardSummary
      data={toDashboardAgentOverviewDto(data)}
      account={account}
      solPrice={solPrice}
      initialSolBalance={{
        solBalanceLamports,
        usdcBalanceRaw: usdcBalanceRaw?.toString() ?? "0",
        arBalanceRaw: arBalanceRaw?.toString() ?? "0",
      }}
      evmWallet={evmWallet}
      initialTransfers={initialTransfers}
      initialEvmActivity={initialEvmActivity}
      mfaEnabled={mfaEnabled}
    />
  );
}
