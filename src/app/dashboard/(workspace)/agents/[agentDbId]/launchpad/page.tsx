import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { DashboardTokenLaunchPage } from "@/components/dashboard/token-launch-page";
import { authOptions } from "@/lib/auth";
import { appLoginUrl } from "@/lib/app-auth-routes";
import { loadLatestAgentLaunchForAgentWithRecovery } from "@/lib/agent-launch/agent-launch-for-agent";
import {
  assertAgentLaunchServerEnabled,
} from "@/lib/agent-launch/guards";
import { getAgentLaunchFeeDisplayConfig } from "@/lib/agent-launch/config";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import { loadLaunchSelectedAgentContext } from "@/lib/agent-launch/selected-agent";
import { loadDashboardAgentOverview } from "@/lib/dashboard/agent-overview";
import { requireDashboardAgentPage } from "@/lib/dashboard/page-auth";
import { getLatestRobinhoodLaunchForAgent } from "@/lib/robinhood-chain/record-launch.server";
import { loadAgentWalletSummary } from "@/lib/agent-wallet-summary.server";
import { readAgentLaunchClaimableFeesForLaunch } from "@/lib/agent-launch/claimable-fees.server";
import { readDashboardRobinhoodClaimableFees } from "@/lib/robinhood-chain/dashboard-claimable-fees.server";
import { TokenGraduationBar } from "@/components/public-site/token-graduation-bar";
import { QuiverLiquidityCard } from "@/components/robinhood-chain/quiver-liquidity-card";
import {
  resolveRobinhoodGraduation,
  resolveSolanaGraduation,
} from "@/lib/public-site/token-graduation";
import { getDexscreenerMarketForMint } from "@/lib/public-site/dexscreener";
import { getPumpFunBondingData } from "@/lib/public-site/pumpfun-bonding";
import { loadRobinhoodGraduationMetrics } from "@/lib/robinhood-chain/robinhood-graduation.server";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ agentDbId: string }> };
export default async function DashboardLaunchpadPage({ params, searchParams }: Props & { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { agentDbId } = await params;
  const id = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    redirect("/dashboard");
  }
  const sp = await searchParams;
  const launchPrefill =
    sp.prefillName || sp.prefillSymbol || sp.prefillDescription || sp.prefillImage
      ? {
          tokenName: typeof sp.prefillName === "string" ? sp.prefillName : undefined,
          tokenSymbol: typeof sp.prefillSymbol === "string" ? sp.prefillSymbol : undefined,
          tokenDescription: typeof sp.prefillDescription === "string" ? sp.prefillDescription : undefined,
          tokenImageUrl: typeof sp.prefillImage === "string" ? sp.prefillImage : undefined,
        }
      : null;
  await requireDashboardAgentPage(id);
  const feeDisplay = getAgentLaunchFeeDisplayConfig();
  const serverGuard = assertAgentLaunchServerEnabled();
  const launchBackendReady = serverGuard.ok;
  const session = await getServerSession(authOptions);
  const resolved = await loadLaunchSelectedAgentContext(id, session);
  if (!resolved.ok) {
    if (resolved.status === 401) {
      redirect(appLoginUrl(`/dashboard/agents/${id}/launchpad`));
    }
    notFound();
  }
  const overview = await loadDashboardAgentOverview(id, {
    autoProvisionWallet: false,
  });
  const agentWalletPublicKey = overview?.agentWalletPublicKey ?? null;
  const [latestLaunch, initialWalletSummary, initialRobinhoodLaunch] = await Promise.all([
    loadLatestAgentLaunchForAgentWithRecovery(id, agentWalletPublicKey),
    loadAgentWalletSummary(id),
    getLatestRobinhoodLaunchForAgent(id),
  ]);
  const initialLaunch = latestLaunch ? serializeAgentLaunch(latestLaunch) : null;
  const initialAgentWalletBalanceLamports = (() => {
    const raw = initialWalletSummary.solana.balances.nativeRaw;
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  })();
  const solPrice = initialWalletSummary.solPrice;
  const solanaMint = initialLaunch?.mint?.trim() || null;
  const solanaNetwork = initialLaunch?.network?.trim().toLowerCase();
  const solanaIsMainnet = solanaNetwork === "mainnet" || solanaNetwork === "mainnet-beta";
  const solanaLaunchStatus = initialLaunch?.launchStatus?.trim().toLowerCase() ?? "";
  // Only surface Pump.fun curve for real Solana launches — not drafts / failed attempts.
  const solanaLaunchEligible =
    Boolean(solanaMint && solanaIsMainnet) &&
    solanaLaunchStatus !== "draft" &&
    solanaLaunchStatus !== "failed" &&
    solanaLaunchStatus !== "cancelled";
  const [
    initialSolanaClaimableFees,
    initialRobinhoodClaimableFees,
    robinhoodGraduationMetrics,
    pumpFunBonding,
    solanaMarket,
  ] = await Promise.all([
    latestLaunch?.launchStatus === "indexed"
      ? readAgentLaunchClaimableFeesForLaunch(latestLaunch).catch(() => null)
      : Promise.resolve(null),
    initialRobinhoodLaunch
      ? readDashboardRobinhoodClaimableFees({
          launch: initialRobinhoodLaunch,
          agentEvmAddress: initialWalletSummary.evm.address,
          agentEvmStatus: initialWalletSummary.evm.status,
        }).catch(() => null)
      : Promise.resolve(null),
    initialRobinhoodLaunch
      ? loadRobinhoodGraduationMetrics({
          tokenAddress: initialRobinhoodLaunch.tokenAddress,
          poolAddress: initialRobinhoodLaunch.poolAddress,
        }).catch(() => null)
      : Promise.resolve(null),
    solanaLaunchEligible
      ? getPumpFunBondingData(solanaMint!).catch(() => null)
      : Promise.resolve(null),
    solanaLaunchEligible
      ? getDexscreenerMarketForMint(solanaMint!).catch(() => null)
      : Promise.resolve(null),
  ]);
  const robinhoodGraduation = initialRobinhoodLaunch
    ? resolveRobinhoodGraduation(
        initialRobinhoodLaunch.poolAddress,
        robinhoodGraduationMetrics,
      )
    : null;
  const solanaGraduation =
    solanaMint && solanaIsMainnet
      ? resolveSolanaGraduation(pumpFunBonding, solanaMarket)
      : null;
  const robinhoodSymbol = initialRobinhoodLaunch?.tokenSymbol?.trim() || null;
  const solanaSymbol = initialLaunch?.tokenSymbol?.trim() || null;
  const showRobinhoodStatus = Boolean(initialRobinhoodLaunch && robinhoodGraduation);
  const showSolanaStatus = Boolean(solanaGraduation);
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl min-w-0 space-y-4 px-4 py-6 sm:px-6">
      <div className="space-y-4">
        {showRobinhoodStatus || showSolanaStatus ? (
          <div className="ui-overview-panel w-full overflow-hidden rounded-xl p-4">
            {showRobinhoodStatus && initialRobinhoodLaunch ? (
              <QuiverLiquidityCard
                tokenAddress={initialRobinhoodLaunch.tokenAddress}
                tokenSymbol={robinhoodSymbol}
                detailLabel={robinhoodGraduation?.detailLabel}
                statusLabel={robinhoodGraduation?.statusLabel ?? "Live"}
                featured
              />
            ) : null}
            {showSolanaStatus && solanaGraduation ? (
              <TokenGraduationBar
                graduation={solanaGraduation}
                title={
                  solanaSymbol
                    ? `$${solanaSymbol} · Pump.fun bonding curve`
                    : "Pump.fun bonding curve"
                }
                tone="solana"
                featured
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <DashboardTokenLaunchPage
        agentDbId={id}
        feeDisplay={feeDisplay}
        selectedAgent={resolved.agent}
        launchBackendReady={launchBackendReady}
        initialLaunch={initialLaunch}
        agentWalletPublicKey={agentWalletPublicKey}
        agentWalletSolscanUrl={overview?.agentWalletSolscanUrl ?? null}
        initialAgentWalletBalanceLamports={initialAgentWalletBalanceLamports}
        solPrice={solPrice}
        launchPrefill={launchPrefill}
        initialWalletSummary={initialWalletSummary}
        initialSolanaClaimableFees={initialSolanaClaimableFees}
        initialRobinhoodClaimableFees={initialRobinhoodClaimableFees}
        initialEvmWallet={{
          configured: initialWalletSummary.evm.configured,
          address: initialWalletSummary.evm.address,
          provider: initialWalletSummary.evm.provider,
        }}
        initialRobinhoodLaunch={initialRobinhoodLaunch}
      />
    </div>
  );
}
