"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import {
  METAPLEX_LAUNCH_DEPOSIT_LAMPORTS,
  METAPLEX_TOKEN_DESCRIPTION_MAX,
} from "@/lib/metaplex-launch/constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Keypair } from "@solana/web3.js";
import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Gift,
  ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Upload,
  X,
} from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { resolveTokenImagePreviewUrl, uploadPreviewFallbackSrc, withImagePreviewCacheBust } from "@/lib/image-utils";
import { formatWalletSol } from "@/components/dashboard/wallet-public-key-row";
import type { SerializedAgentLaunch } from "@/components/agent-launch/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/toast-simple";
import { LaunchTokenPendingScreen } from "@/components/dashboard/token-launch-pending-screen";
import { formatLaunchNetworkLabel } from "@/lib/agent-launch/network-label";
import { requestAgentLaunchFeeDistribution } from "@/lib/agent-launch/fee-distribution-client";
import type { AgentLaunchFeeDisplayConfig } from "@/lib/agent-launch/config";
import {
  formatEstimatedSolLamports,
  PUMP_LAUNCH_NETWORK_FEE_ESTIMATE_LAMPORTS,
  solToLamports,
} from "@/lib/agent-launch/fees";
import { isLaunchIndexed } from "@/lib/agent-launch/launch-wizard-state";
import {
  buildLaunchPrefillFromSelectedAgent,
  buildLaunchEnrichmentFromAgent,
  suggestTokenSymbolFromAgentName,
} from "@/lib/agent-launch/selected-agent-prefill";
import type { LaunchSelectedAgentContext } from "@/lib/agent-launch/selected-agent";
import {
  mapTokenLaunchError,
  validateTokenLaunchForm,
  type TokenLaunchFormFieldsNoWebsite,
} from "@/lib/agent-launch/token-launch-utils";
import {
  fetchLaunchDraft,
  runTokenLaunchPipeline,
  saveLaunchProfileEnrichment,
  type LaunchProgressPhase,
} from "@/lib/agent-launch/token-launch-client";
import { LaunchProfileEnrichmentSection } from "@/components/dashboard/launch-profile-enrichment-section";
import type { LaunchProfileEnrichmentFields } from "@/lib/agent-launch/launch-profile-enrichment";
import { generateMintKeypair } from "@/lib/agent-launch/wallet-client";
import { useAgentEvmWalletSetup } from "@/lib/use-agent-evm-wallet-setup";
import { useAgentEvmSigner } from "@/lib/use-agent-evm-signer";
import { useAgentWalletSummary } from "@/lib/use-agent-wallet-summary";
import type { AgentWalletSummary } from "@/lib/agent-wallet-summary.server";
import type { AgentLaunchClaimableFeesDto } from "@/lib/agent-launch/claimable-fees";
import type { DashboardRobinhoodClaimableFeesDto } from "@/lib/robinhood-chain/dashboard-claimable-fees";
import {
  shortenEvmAddress,
  formatEthCompact,
  robinhoodChainExplorerUrl,
} from "@/lib/evm-wallet-utils";
import { EthereumIcon } from "@/components/shared/ethereum-icon";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import { useRobinhoodLaunchFlow } from "@/components/robinhood-chain/use-robinhood-launch-flow";
import { RobinhoodTokenImage } from "@/components/robinhood-chain/robinhood-token-image";
import { RobinhoodFeeClaimPanel } from "@/components/robinhood-chain/robinhood-fee-claim-panel";
import {
  ROBINHOOD_CHAIN_ID,
  robinhoodExplorerAddressUrl,
  robinhoodExplorerTxUrl,
} from "@/lib/robinhood-chain/config";
import { mapRobinhoodLaunchError } from "@/lib/robinhood-chain/robinhood-launch-client";
import type { RobinhoodLaunchRecord } from "@/lib/robinhood-chain/types";
import {
  clearMintKeypairForLaunch,
  loadMintKeypairForLaunch,
  persistMintKeypairForLaunch,
} from "@/lib/agent-launch/mint-keypair-storage";
import {
  TOKEN_DESCRIPTION_MAX_LENGTH,
  TOKEN_NAME_MAX_LENGTH,
  TOKEN_SYMBOL_MAX_LENGTH,
} from "@/lib/agent-launch/constants";
import {
  mapMetaplexLaunchClientError,
  runMetaplexLaunchPipeline,
  uploadMetaplexIrysImage,
  createMetaplexLaunchAttempt,
} from "@/lib/metaplex-launch/client";
import type { MetaplexLaunchProgressPhase } from "@/lib/metaplex-launch/types";
import {
  METAPLEX_TOKEN_NAME_MAX,
  METAPLEX_TOKEN_SYMBOL_MAX,
} from "@/lib/metaplex-launch/constants";
import {
  validateMetaplexLaunchForm,
  isValidIrysGatewayUrl,
} from "@/lib/metaplex-launch/validation";
import { cn } from "@/lib/utils";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { shortenSolanaAddress } from "@/lib/custodial-wallet/solscan";
function shortenWallet(publicKey: string): string {
  return shortenSolanaAddress(publicKey, 4);
}
function launchOptionClass(selected: boolean, disabled = false) {
  return cn(
    "ui-launch-option inline-flex min-h-[44px] w-full items-center gap-2.5 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all",
    disabled && "pointer-events-none opacity-45",
    selected
      ? "border-[#f1f1f1] bg-[#212121] text-foreground ring-1 ring-[#f1f1f1]"
      : "border-[#303030] bg-[#181818] text-muted-foreground hover:border-[#717171] hover:bg-[#212121]",
  );
}
function parseEthBalance(value: string | null | undefined): number {
  if (value == null || value === "—") return 0;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}
type LaunchTarget = "solana" | "metaplex" | "robinhood";
type LaunchSuccessState = {
  chain: LaunchTarget;
  tokenUrl: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
};
function FreshLaunchCompletePanel({
  launch,
  agentDbId,
}: {
  readonly launch: LaunchSuccessState;
  readonly agentDbId: number;
}) {
  return (
    <div className="ui-overview-panel rounded-xl space-y-5 border-emerald-500/20">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
          <Check className="h-5 w-5 text-emerald-500" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Token launched</h2>
          <p className="text-muted-foreground text-sm">
            Your public token page opened in a new tab.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <AgentAvatar
          image={launch.imageUrl || undefined}
          name={launch.name}
          size="lg"
          className="!h-16 !w-16 rounded-2xl"
        />
        <div className="min-w-0">
          <Badge variant="secondary">
            {launch.chain === "robinhood"
              ? "Robinhood Chain"
              : launch.chain === "metaplex"
                ? "Metaplex Genesis"
                : "Solana"}
          </Badge>
          <p className="mt-2 text-xl font-bold">${launch.symbol}</p>
          <p className="truncate text-sm text-muted-foreground">{launch.name}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={launch.tokenUrl} target="_blank" rel="noopener noreferrer">
            Open token page
            <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
          </a>
        </Button>
        <Button variant="secondary" asChild>
          <Link href={`/dashboard/agents/${agentDbId}`}>Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}
type Props = {
  readonly agentDbId: number;
  readonly selectedAgent: LaunchSelectedAgentContext;
  readonly feeDisplay: AgentLaunchFeeDisplayConfig;
  readonly launchBackendReady: boolean;
  readonly initialLaunch: SerializedAgentLaunch | null;
  readonly agentWalletPublicKey: string | null;
  readonly agentWalletSolscanUrl: string | null;
  readonly initialAgentWalletBalanceLamports: number | null;
  readonly solPrice: number | null;
  readonly initialWalletSummary: AgentWalletSummary;
  readonly initialSolanaClaimableFees: AgentLaunchClaimableFeesDto | null;
  readonly initialRobinhoodClaimableFees: DashboardRobinhoodClaimableFeesDto | null;
  /** Optional prefill from onboarding wizard or external source */
  readonly launchPrefill?: {
    tokenName?: string;
    tokenSymbol?: string;
    tokenDescription?: string;
    tokenImageUrl?: string;
  } | null;
  readonly initialEvmWallet?: {
    configured: boolean;
    address: string | null;
    provider?: string | null;
  } | null;
  readonly initialRobinhoodLaunch?: RobinhoodLaunchRecord | null;
};
const METAPLEX_PHASE_LABELS: Record<MetaplexLaunchProgressPhase, string> = {
  idle: "Launch token",
  draft: "Preparing launch…",
  upload: "Uploading image…",
  mint_agent: "Registering Metaplex agent…",
  genesis: "Launching Genesis token…",
  register: "Registering launch…",
  index: "Publishing to AgentRanking…",
  done: "Token launched",
  error: "Launch token",
};
const METAPLEX_PROGRESS_STEPS = [
  { key: "draft", label: "Prepare" },
  { key: "mint_agent", label: "Metaplex agent" },
  { key: "genesis", label: "Genesis bonding curve" },
  { key: "index", label: "AgentRanking index" },
] as const;
const PHASE_BUTTON_LABELS: Record<LaunchProgressPhase, string> = {
  idle: "Launch token",
  draft: "Starting launch…",
  details: "Saving token details…",
  metadata: "Uploading metadata…",
  preparing: "Preparing launch…",
  signing: "Signing with agent wallet…",
  sending: "Creating Pump.fun token…",
  confirming: "Confirming on Solana…",
  create: "Launching token…",
  routing: "Configuring fees…",
  syncing: "Syncing AgentRanking…",
  done: "Token launched",
  error: "Launch token",
};
const PROGRESS_STEPS: { key: LaunchProgressPhase; label: string }[] = [
  { key: "details", label: "Saving token details" },
  { key: "metadata", label: "Uploading metadata to IPFS" },
  { key: "preparing", label: "Preparing wallet signer" },
  { key: "signing", label: "Signing with agent wallet" },
  { key: "sending", label: "Creating Pump.fun token" },
  { key: "confirming", label: "Confirming on Solana" },
  { key: "routing", label: "Configuring creator fees" },
  { key: "syncing", label: "Syncing AgentRanking pages" },
];
function resolveProgressStepIndex(phase: LaunchProgressPhase): number {
  // Phases before first PROGRESS_STEP (draft) → first step is active
  if (phase === "draft") return 0;
  // The create phase maps to signing (the actual on-chain step)
  if (phase === "create") {
    const idx = PROGRESS_STEPS.findIndex((s) => s.key === "signing");
    return idx >= 0 ? idx : 3;
  }
  // Done means all completed, but progress panel won't be shown
  if (phase === "done") return PROGRESS_STEPS.length;
  const idx = PROGRESS_STEPS.findIndex((s) => s.key === phase);
  return idx >= 0 ? idx : -1;
}
function pumpPendingPhaseLabel(phase: LaunchProgressPhase): string {
  if (phase === "draft") return "Starting launch…";
  if (phase === "details") return "Saving token details…";
  if (phase === "create") return "Creating Pump.fun token…";
  const step = PROGRESS_STEPS.find((s) => s.key === phase);
  if (step) return `${step.label}…`;
  const label = PHASE_BUTTON_LABELS[phase];
  return label !== "Launch token" ? label : "Launching on Pump.fun…";
}
function resolveMetaplexProgressStepIndex(phase: MetaplexLaunchProgressPhase): number {
  if (phase === "draft" || phase === "upload") return 0;
  if (phase === "mint_agent") return 1;
  if (phase === "genesis" || phase === "register") return 2;
  if (phase === "index") return 3;
  if (phase === "done") return METAPLEX_PROGRESS_STEPS.length;
  return -1;
}
function launchFromForm(
  agent: LaunchSelectedAgentContext,
  launch: SerializedAgentLaunch | null,
): TokenLaunchFormFieldsNoWebsite {
  const prefill = buildLaunchPrefillFromSelectedAgent(agent);
  return {
    tokenName: launch?.tokenName?.trim() || prefill.tokenName,
    tokenSymbol: launch?.tokenSymbol?.trim() || prefill.tokenSymbol,
    tokenDescription: launch?.tokenDescription?.trim() || prefill.tokenDescription,
    tokenImageUrl: launch?.tokenImageUrl?.trim() || prefill.tokenImageUrl,
    twitter: launch?.profileTwitter?.trim() || agent.twitter || "",
    telegram: launch?.profileTelegram?.trim() || agent.telegram || "",
  };
}
function RobinhoodLaunchSuccessPanel({
  launch,
  agent,
  agentDbId,
  evmAddress,
  onRobinhoodChain,
  switchToRobinhood,
  initialClaimableFees,
  custodial = false,
}: {
  readonly launch: RobinhoodLaunchRecord;
  readonly agent: LaunchSelectedAgentContext;
  readonly agentDbId: number;
  readonly evmAddress: string | null;
  readonly onRobinhoodChain: boolean;
  readonly switchToRobinhood: () => Promise<void>;
  readonly initialClaimableFees: DashboardRobinhoodClaimableFeesDto | null;
  readonly custodial?: boolean;
}) {
  const symbol = launch.tokenSymbol ? `$${launch.tokenSymbol}` : "Token";
  const arTokenUrl = `/tokens/robinhood/${launch.tokenAddress}`;
  const arOverviewUrl = `/dashboard/agents/${agent.agentDbId}`;
  const tokenExplorerUrl = robinhoodExplorerAddressUrl(launch.tokenAddress);
  const poolExplorerUrl = launch.poolAddress
    ? robinhoodExplorerAddressUrl(launch.poolAddress)
    : null;
  const txExplorerUrl = launch.txHash.startsWith("0x")
    ? robinhoodExplorerTxUrl(launch.txHash)
    : null;
  return (
    <div className="space-y-6">
      <div className="ui-overview-panel rounded-xl space-y-5 border-emerald-500/20">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
            <Check className="h-5 w-5 text-emerald-500" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Token launched</h2>
            <p className="text-muted-foreground text-sm">
              Your Robinhood Chain token is linked to {agent.name}.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border/60">
            <RobinhoodTokenImage
              source={{
                tokenLogoGatewayUrl: launch.tokenLogoGatewayUrl,
                tokenLogoIpfsUri: launch.tokenLogoIpfsUri,
                tokenImageOriginalUrl: launch.tokenImageOriginalUrl,
                tokenImageUrl: launch.tokenImageUrl,
                agentImage: agent.image,
                tokenName: launch.tokenName,
                tokenSymbol: launch.tokenSymbol,
              }}
              alt={symbol}
              fill
              className="object-cover"
            />
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center justify-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <RobinhoodChainIcon className="h-3 w-3" />
                Robinhood Chain
              </Badge>
            </div>
            <p className="text-xl font-bold">{symbol}</p>
            <p className="truncate text-sm text-muted-foreground">{launch.tokenName || symbol}</p>
          </div>
        </div>
        <div className="grid gap-3 rounded-lg border border-border/60 p-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">Provider</p>
            <p>{launch.frontendSourceLabel}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Network</p>
            <p>Robinhood Chain · {ROBINHOOD_CHAIN_ID}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-muted-foreground text-xs">Token contract</p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={tokenExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-xs hover:underline"
              >
                {launch.tokenAddress}
              </a>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground inline-flex shrink-0"
                aria-label="Copy contract"
                onClick={() => {
                  void navigator.clipboard.writeText(launch.tokenAddress).then(() =>
                    showToast("Contract copied"),
                  );
                }}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
          {launch.poolAddress && poolExplorerUrl ? (
            <div className="sm:col-span-2">
              <p className="text-muted-foreground text-xs">Liquidity pool</p>
              <a
                href={poolExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-xs hover:underline"
              >
                {launch.poolAddress}
              </a>
            </div>
          ) : null}
          {txExplorerUrl ? (
            <div className="sm:col-span-2">
              <p className="text-muted-foreground text-xs">Launch transaction</p>
              <a
                href={txExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-xs hover:underline"
              >
                {launch.txHash}
              </a>
            </div>
          ) : null}
          <div>
            <p className="text-muted-foreground text-xs">Linked agent</p>
            <p className="truncate">{agent.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Creator wallet</p>
            {launch.creatorWallet ? (
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={robinhoodExplorerAddressUrl(launch.creatorWallet)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs hover:underline"
                >
                  {shortenEvmAddress(launch.creatorWallet)}
                </a>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground inline-flex shrink-0"
                  aria-label="Copy creator wallet"
                  onClick={() => {
                    void navigator.clipboard.writeText(launch.creatorWallet).then(() =>
                      showToast("Wallet copied"),
                    );
                  }}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">—</p>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            You earn 70% of trading fees
          </p>
          <p className="text-muted-foreground text-xs">
            V3 pool fees accrue as WETH in the launch locker. On claim, fees split 70% to your
            agent EVM wallet and 30% to AgentRanking.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={arTokenUrl}>View token page</Link>
          </Button>
          <Button variant="secondary" asChild>
            <a href={tokenExplorerUrl} target="_blank" rel="noopener noreferrer">
              Explorer
              <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </a>
          </Button>
          <Button variant="secondary" asChild>
            <Link href={arOverviewUrl}>Back to overview</Link>
          </Button>
        </div>
      </div>
      <RobinhoodFeeClaimPanel
        agentDbId={agentDbId}
        launch={launch}
        evmAddress={evmAddress}
        onRobinhoodChain={onRobinhoodChain}
        switchToRobinhood={switchToRobinhood}
        initialData={initialClaimableFees}
        custodial={custodial}
      />
    </div>
  );
}
type LaunchFeeData = AgentLaunchClaimableFeesDto;
function LaunchSuccessPanel({
  launch,
  agent,
  networkLabel,
  agentWalletPublicKey,
  agentWalletSolscanUrl,
  initialClaimableFees,
}: {
  readonly launch: SerializedAgentLaunch;
  readonly agent: LaunchSelectedAgentContext;
  readonly networkLabel: string;
  readonly agentWalletPublicKey: string | null;
  readonly agentWalletSolscanUrl: string | null;
  readonly initialClaimableFees: AgentLaunchClaimableFeesDto | null;
}) {
  const symbol = launch.tokenSymbol ? `$${launch.tokenSymbol}` : "Token";
  const mint = launch.mint;
  const imageUrl = launch.tokenImageUrl?.trim() || agent.image || "";
  const pumpFunUrl = mint ? `https://pump.fun/coin/${mint}` : null;
  const dexscreenerUrl = mint ? `https://dexscreener.com/solana/${mint}` : null;
  const solscanUrl = mint
    ? `https://solscan.io/token/${mint}${networkLabel.toLowerCase() === "devnet" ? "?cluster=devnet" : ""}`
    : null;
  const arTokenUrl = mint ? `/tokens/${mint}` : null;
  const arOverviewUrl = `/dashboard/agents/${agent.agentDbId}`;
  // Fee claim state
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [distributionTx, setDistributionTx] = useState<string | null>(null);
  const hasFeeId = Boolean(launch.id && launch.id !== "undefined" && launch.id !== "null");
  const feeResourceKey =
    hasFeeId && launch.launchStatus === "indexed" ? launch.id : null;
  const feeResource = useAsyncResource(
    feeResourceKey,
    async (signal) => {
      const response = await fetch(
        `/api/agent-launch/drafts/${launch.id}/claimable-fees`,
        { signal, cache: "no-store" },
      );
      const data = (await response.json()) as LaunchFeeData & { error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Status ${response.status}`);
      }
      return data;
    },
    {
      initialData: initialClaimableFees,
      initialDataKey: initialClaimableFees ? feeResourceKey : null,
      revalidateOnMount: true,
    },
  );
  const feeData = feeResource.data;
  const feeCheckLoading = feeResource.loading;
  const feeError = claimError ?? feeResource.error?.message ?? null;
  const refreshFees = feeResource.refresh;
  useEffect(() => {
    if (!feeResourceKey) return;
    const interval = window.setInterval(() => {
      refreshFees();
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [feeResourceKey, refreshFees]);
  async function claimFees(force = false) {
    if (!hasFeeId) {
      showToast("Fee rewards are still syncing — refresh in a moment.");
      return;
    }
    if (!force && feeData?.feeSharingStatus !== "active") {
      showToast("Fee sharing is still activating. Use force claim or refresh fees.");
    }
    if ((accruedCreatorSol ?? 0) <= 0 && !force) {
      showToast("No claimable fees yet — volume on Pump.fun must generate creator fees first.");
      return;
    }
    setClaimLoading(true);
    setClaimError(null);
    try {
      const result = await requestAgentLaunchFeeDistribution(launch.id, {
        mode: force ? "recovery" : "standard",
        timeoutMs: force ? 120_000 : 45_000,
      });
      if (result.status === "failed") {
        const message = result.reason || "Fee distribution failed";
        setClaimError(message);
        showToast(message);
        return;
      }
      if (result.timedOut) {
        showToast("Claim queued — still processing. Fees will refresh automatically.");
        refreshFees();
        return;
      }
      if (result.status === "skipped") {
        const reason = result.reason || "below_threshold_or_no_claimable_fees";
        const friendly =
          reason.includes("below_threshold") || reason.includes("no_claimable")
            ? "Below Pump.fun minimum — fees are accruing but not claimable yet."
            : reason.replaceAll("_", " ");
        showToast(friendly);
        feeResource.setData((previous) =>
          previous
            ? { ...previous, reason: friendly, canDistribute: false }
            : previous,
        );
      } else if (result.status === "distributed" && result.txSignature) {
        setDistributionTx(result.txSignature);
        showToast("Creator fees distributed to your agent wallet.");
        refreshFees();
      } else if (result.status === "queued" || result.status === "in_progress") {
        showToast("Claim submitted — check back in a few seconds.");
        refreshFees();
      } else {
        showToast("Claim status unknown — refresh fees to check again.");
        refreshFees();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Claim failed";
      setClaimError(message);
      showToast(message);
    } finally {
      setClaimLoading(false);
    }
  }
  function fmtSol(n: number | null): string {
    if (n == null || n <= 0) return "0";
    if (n < 0.000001) return "<0.000001";
    return n.toFixed(6).replace(/\.?0+$/, "");
  }
  const agentSharePct = feeData?.agentShareBps != null ? feeData.agentShareBps / 100 : 70;
  const earnedCreatorSolLabel =
    feeData?.earnedCreatorSol != null ? `${fmtSol(feeData.earnedCreatorSol)} SOL` : "—";
  const totalDistributedLabel =
    feeData?.totalDistributedSol != null ? `${fmtSol(feeData.totalDistributedSol)} SOL` : "—";
  const accruedCreatorSol =
    feeData?.accruedCreatorSol ??
    (feeData?.claimableSol != null && feeData.agentShareBps != null
      ? (feeData.claimableSol * feeData.agentShareBps) / 10_000
      : null);
  const claimableLabel =
    accruedCreatorSol != null
      ? feeData?.canDistribute
        ? `${fmtSol(accruedCreatorSol)} SOL`
        : accruedCreatorSol <= 0
          ? "0 SOL"
          : `${fmtSol(accruedCreatorSol)} SOL`
      : "—";
  const canClaimStandard =
    feeData?.canDistribute === true && feeData.feeSharingStatus === "active";
  const showForceClaim =
    hasFeeId &&
    !claimLoading &&
    (accruedCreatorSol ?? 0) > 0 &&
    (!canClaimStandard || Boolean(feeError));
  return (
    <div className="space-y-6">
      <div className="ui-overview-panel rounded-xl space-y-5 border-emerald-500/20">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
            <Check className="h-5 w-5 text-emerald-500" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Token launched</h2>
            <p className="text-muted-foreground text-sm">
              Your Pump.fun token is linked to {agent.name}.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-3 text-center">
          {imageUrl ? (
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border/60">
              <Image src={imageUrl} alt={symbol} fill className="object-cover" />
            </div>
          ) : null}
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center justify-center gap-2">
              <Badge variant="secondary">Solana · {networkLabel}</Badge>
            </div>
            <p className="text-xl font-bold">{symbol}</p>
            <p className="truncate text-sm text-muted-foreground">{launch.tokenName || symbol}</p>
          </div>
        </div>
        <div className="grid gap-3 rounded-lg border border-border/60 p-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">Provider</p>
            <p>Pump.fun</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Network</p>
            <p>Solana · {networkLabel}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-muted-foreground text-xs">Mint</p>
            <div className="flex flex-wrap items-center gap-2">
              <p className="break-all font-mono text-xs">{mint ?? "—"}</p>
              {mint ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground inline-flex shrink-0"
                  aria-label="Copy mint"
                  onClick={() => {
                    void navigator.clipboard.writeText(mint).then(() => showToast("Mint copied"));
                  }}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Linked agent</p>
            <p className="truncate">{agent.name}</p>
          </div>
        </div>
        <div className="space-y-3 border-t border-border/60 pt-4">
          {arTokenUrl ? (
            <Button asChild className="w-full">
              <Link href={arTokenUrl}>
                View token page
                <ExternalLink className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
          {pumpFunUrl || dexscreenerUrl || solscanUrl ? (
            <div className="overflow-hidden rounded-lg border border-border/60">
            {pumpFunUrl ? (
              <a
                href={pumpFunUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 text-sm transition-colors hover:bg-muted/40"
              >
                <span>Trade on Pump.fun</span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            ) : null}
            {dexscreenerUrl ? (
              <a
                href={dexscreenerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 text-sm transition-colors hover:bg-muted/40"
              >
                <span>Dexscreener</span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            ) : null}
            {solscanUrl ? (
              <a
                href={solscanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40"
              >
                <span>Solscan</span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            ) : null}
            </div>
          ) : null}
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" asChild>
              <Link href={arOverviewUrl}>Back to overview</Link>
            </Button>
          </div>
        </div>
      </div>
      {agentWalletPublicKey ? (
        <div className="ui-overview-panel rounded-xl space-y-3 p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Linked agent wallet
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-all font-mono text-xs">{agentWalletPublicKey}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(agentWalletPublicKey).then(() =>
                  showToast("Wallet copied"),
                );
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
              Copy
            </Button>
            {agentWalletSolscanUrl ? (
              <Button size="sm" variant="secondary" asChild>
                <a href={agentWalletSolscanUrl} target="_blank" rel="noopener noreferrer">
                  Solscan
                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="ui-overview-panel rounded-xl space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
            <Gift className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Creator fee rewards
          </p>
          {hasFeeId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void refreshFees()}
              disabled={feeCheckLoading}
            >
              <RefreshCw
                className={cn("mr-1 h-3.5 w-3.5", feeCheckLoading && "animate-spin")}
                aria-hidden
              />
              {feeCheckLoading ? "Checking…" : "Refresh fees"}
            </Button>
          ) : null}
        </div>
        {!hasFeeId ? (
          <p className="text-muted-foreground text-sm">
            Fee rewards are syncing. Refresh in a moment.
          </p>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-medium">Your agent earns {agentSharePct}%</span>
              <span className="text-muted-foreground">
                {" "}
                — Creator fees accrue as people trade on Pump.fun. Claiming unlocks once
                Pump.fun&apos;s minimum threshold is reached.
              </span>
            </p>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-muted-foreground text-xs">Earned ({agentSharePct}%)</p>
                <p className="font-semibold tabular-nums">{earnedCreatorSolLabel}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-muted-foreground text-xs">Total distributed</p>
                <p className="font-semibold tabular-nums">{totalDistributedLabel}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-muted-foreground text-xs">Claimable now</p>
                <p className="font-semibold tabular-nums">{claimableLabel}</p>
              </div>
            </div>
            {feeData?.reason && !feeData.canDistribute ? (
              <p className="text-muted-foreground text-xs">{feeData.reason}</p>
            ) : null}
            {distributionTx ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Distribution complete
                </p>
                <a
                  href={`https://solscan.io/tx/${distributionTx}${networkLabel.toLowerCase() === "devnet" ? "?cluster=devnet" : ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-xs text-muted-foreground hover:underline"
                >
                  {distributionTx}
                </a>
              </div>
            ) : null}
            {canClaimStandard || showForceClaim ? (
              <div className="flex flex-wrap gap-2">
                {canClaimStandard ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={() => void claimFees(false)}
                    disabled={claimLoading}
                  >
                    {claimLoading ? "Claiming…" : "Claim creator fees"}
                  </Button>
                ) : null}
                {showForceClaim ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void claimFees(true)}
                    disabled={claimLoading}
                  >
                    {claimLoading ? "Submitting…" : "Force claim"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {feeError ? (
              <p className="text-muted-foreground text-xs">{feeError}</p>
            ) : null}
            {!feeData && !feeCheckLoading && !feeError ? (
              <p className="text-muted-foreground text-xs">
                Creator fees accrue as tokens trade on Pump.fun. They become claimable once
                the minimum distribution threshold is met.
              </p>
            ) : null}
          </>
        )}
        <p className="text-muted-foreground text-xs">
          Fees accrue from Pump.fun trades. They must be claimed/distributed via an on-chain
          transaction which splits them 70/30. Claiming is only possible past Pump.fun&apos;s minimum
          distribution threshold — until then, fees accumulate but cannot be moved.
        </p>
      </div>
    </div>
  );
}
function PreviewEconomicsRow({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}) {
  if (hint) {
    return (
      <div className="space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground shrink-0">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
        <p className="text-muted-foreground text-[11px] leading-relaxed">{hint}</p>
      </div>
    );
  }
  return (
    <div className="flex justify-between gap-2 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
function FieldLabel({
  htmlFor,
  label,
  current,
  max,
  optional,
}: {
  readonly htmlFor: string;
  readonly label: string;
  readonly current?: number;
  readonly max?: number;
  readonly optional?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? (
          <span className="text-muted-foreground font-normal"> (optional)</span>
        ) : null}
      </Label>
      {max != null && current != null ? (
        <span
          className={cn(
            "text-xs tabular-nums",
            current > max ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {current}/{max}
        </span>
      ) : null}
    </div>
  );
}
const DESCRIPTION_RESERVE_CHARS = 200;
const DESCRIPTION_USER_MAX = TOKEN_DESCRIPTION_MAX_LENGTH - DESCRIPTION_RESERVE_CHARS;
function TokenLaunchPreviewImage({
  src,
  alt,
  className,
}: {
  readonly src: string;
  readonly alt: string;
  readonly className?: string;
}) {
  return (
    <TokenLaunchPreviewImageForSource
      key={src}
      src={src}
      alt={alt}
      className={className}
    />
  );
}

function TokenLaunchPreviewImageForSource({
  src,
  alt,
  className,
}: {
  readonly src: string;
  readonly alt: string;
  readonly className?: string;
}) {
  const [imageState, setImageState] = useState(() => ({
    displaySrc: src,
    fallbackAttempted: false,
  }));
  return (
    <RuntimeImage
      src={imageState.displaySrc}
      alt={alt}
      className={className}
      onError={() => {
        if (imageState.fallbackAttempted) return;
        const fallback = uploadPreviewFallbackSrc(imageState.displaySrc);
        if (fallback && fallback !== imageState.displaySrc) {
          setImageState({ displaySrc: fallback, fallbackAttempted: true });
        }
      }}
    />
  );
}

export function DashboardTokenLaunchPage({
  agentDbId,
  selectedAgent,
  feeDisplay,
  launchBackendReady,
  initialLaunch,
  agentWalletPublicKey,
  agentWalletSolscanUrl,
  initialAgentWalletBalanceLamports,
  solPrice,
  initialWalletSummary,
  initialSolanaClaimableFees,
  initialRobinhoodClaimableFees,
  launchPrefill,
  initialEvmWallet,
  initialRobinhoodLaunch,
}: Props) {
  const router = useRouter();
  const mintKeypairRef = useRef<Keypair>(generateMintKeypair());
  const [launch, setLaunch] = useState<SerializedAgentLaunch | null>(initialLaunch);
  const [form, setForm] = useState<TokenLaunchFormFieldsNoWebsite>(() => {
    const base = launchFromForm(selectedAgent, initialLaunch);
    return launchPrefill
      ? {
          ...base,
          tokenName: launchPrefill.tokenName || base.tokenName,
          tokenSymbol: launchPrefill.tokenSymbol || base.tokenSymbol,
          tokenDescription: launchPrefill.tokenDescription || base.tokenDescription,
          tokenImageUrl: launchPrefill.tokenImageUrl || base.tokenImageUrl,
        }
      : base;
  });
  const [enrichment, setEnrichment] = useState<LaunchProfileEnrichmentFields>(() =>
    buildLaunchEnrichmentFromAgent(selectedAgent, initialLaunch),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<LaunchProgressPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<LaunchTarget>("solana");
  const [rhWebsite, setRhWebsite] = useState(selectedAgent.website || "");
  const [rhDiscord, setRhDiscord] = useState("");
  const [rhFarcaster, setRhFarcaster] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [showMetaplexConfirmModal, setShowMetaplexConfirmModal] = useState(false);
  const [metaplexBindChecked, setMetaplexBindChecked] = useState(false);
  const [firstBuySol, setFirstBuySol] = useState("0");
  const [metaplexPhase, setMetaplexPhase] = useState<MetaplexLaunchProgressPhase>("idle");
  const metaplexAttemptIdRef = useRef<string | null>(null);
  const [launchSuccess, setLaunchSuccess] = useState<LaunchSuccessState | null>(null);
  const [tokenPageOpened, setTokenPageOpened] = useState(false);
  const rh = useRobinhoodLaunchFlow();
  const { ensureWallet } = useAgentEvmSigner();
  const { summary: walletSummary, loading: walletSummaryLoading, refreshAfterSetup } = useAgentWalletSummary(
    agentDbId,
    { initialData: initialWalletSummary },
  );
  const { state: evmSetupState, error: evmSetupError, setupEvmWallet } = useAgentEvmWalletSetup(agentDbId);
  const evmConfigured = Boolean(
    walletSummary?.evm?.configured || initialEvmWallet?.configured,
  );
  const evmAddress =
    walletSummary?.evm?.address ?? initialEvmWallet?.address ?? null;
  // Image upload state
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagePreviewNonce, setImagePreviewNonce] = useState(0);
  const [localImagePreview, setLocalImagePreview] = useState<string | null>(null);
  const tokenImagePreviewSrc = useMemo(
    () =>
      localImagePreview ||
      withImagePreviewCacheBust(
        resolveTokenImagePreviewUrl(form.tokenImageUrl),
        imagePreviewNonce || null,
      ),
    [form.tokenImageUrl, imagePreviewNonce, localImagePreview],
  );
  useEffect(() => {
    return () => {
      if (localImagePreview?.startsWith("blob:")) {
        URL.revokeObjectURL(localImagePreview);
      }
    };
  }, [localImagePreview]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const networkLabel = formatLaunchNetworkLabel(feeDisplay.network);
  const isRobinhood = launchTarget === "robinhood";
  const isMetaplex = launchTarget === "metaplex";
  const selectedChain: "solana" | "robinhood" = isRobinhood ? "robinhood" : "solana";
  const nameMaxLength = isMetaplex ? METAPLEX_TOKEN_NAME_MAX : TOKEN_NAME_MAX_LENGTH;
  const symbolMaxLength = isMetaplex ? METAPLEX_TOKEN_SYMBOL_MAX : TOKEN_SYMBOL_MAX_LENGTH;
  const descriptionMaxLength = isMetaplex
    ? METAPLEX_TOKEN_DESCRIPTION_MAX
    : DESCRIPTION_USER_MAX;
  const solBalanceResourceKey = agentWalletPublicKey
    ? `${agentDbId}:${agentWalletPublicKey}:${initialAgentWalletBalanceLamports ?? "unknown"}`
    : null;
  const solBalanceResource = useAsyncResource(
    solBalanceResourceKey,
    async (signal) => {
      const response = await fetch(`/api/dashboard/agents/${agentDbId}/sync-balance`, {
        method: "POST",
        signal,
      });
      const payload = (await response.json()) as {
        solBalanceLamports?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Failed to refresh SOL balance");
      return typeof payload.solBalanceLamports === "number"
        ? payload.solBalanceLamports
        : initialAgentWalletBalanceLamports;
    },
    {
      initialData: initialAgentWalletBalanceLamports,
      initialDataKey: solBalanceResourceKey,
      revalidateOnMount: false,
    },
  );
  const agentSolLamports =
    solBalanceResource.data ?? initialAgentWalletBalanceLamports;
  const balanceLoading = solBalanceResource.loading;
  const syncBalance = solBalanceResource.refresh;
  const copyWallet = useCallback(async () => {
    if (!agentWalletPublicKey) return;
    try {
      await navigator.clipboard.writeText(agentWalletPublicKey);
      showToast("Address copied");
    } catch {
      showToast("Could not copy address", "error");
    }
  }, [agentWalletPublicKey]);
  const evmBalanceResourceKey = evmAddress ? `${agentDbId}:${evmAddress}` : null;
  const evmBalanceResource = useAsyncResource(
    evmBalanceResourceKey,
    async (signal) => {
      const response = await fetch(`/api/dashboard/agents/${agentDbId}/evm-wallet`, {
        signal,
      });
      const data = (await response.json()) as {
        error?: string;
        balances?: {
          mainnet?: { ether?: string } | null;
          robinhood?: { ether?: string } | null;
        };
      };
      if (!response.ok) throw new Error(data.error || "Failed to refresh EVM balances");
      return {
        mainnet: data.balances?.mainnet?.ether ?? null,
        robinhood: data.balances?.robinhood?.ether ?? null,
      };
    },
    {
      initialData: { mainnet: null, robinhood: null },
      initialDataKey: evmBalanceResourceKey,
      revalidateOnMount: false,
    },
  );
  const evmMainnetBalanceEth = evmBalanceResource.data?.mainnet ?? null;
  const evmRobinhoodBalanceEth = evmBalanceResource.data?.robinhood ?? null;
  const evmBalanceLoading = evmBalanceResource.loading;
  const syncEvmBalance = evmBalanceResource.refresh;
  // ── Robinhood funding guardrails ──
  const GAS_BUFFER_BPS = 30; // 30% buffer on (launchFee + gasCost)
  const mainnetBalanceEth = evmConfigured
    ? parseEthBalance(
        evmMainnetBalanceEth
          ?? walletSummary?.evm?.mainnet?.balances?.nativeDisplay
          ?? walletSummary?.evm?.balances?.nativeDisplay,
      )
    : 0;
  const evmBalanceEth = evmConfigured
    ? parseEthBalance(
        evmRobinhoodBalanceEth ?? walletSummary?.evm?.robinhood?.balances?.nativeDisplay,
      )
    : 0;
  const evmBalanceWei = BigInt(Math.floor(evmBalanceEth * 1e18));
  const launchFeeWei = rh.launchFeeEth
    ? BigInt(Math.floor(Number.parseFloat(rh.launchFeeEth) * 1e18))
    : null;
  const estimatedGasCostWei = rh.estimatedGasCostWei
    ? BigInt(rh.estimatedGasCostWei)
    : null;
  const estimatedGasCostEthDisplay = rh.estimatedGasCostEth ?? null;
  // required = (launchFee + gasCost) × (1 + buffer%)
  const requiredWei = launchFeeWei != null && estimatedGasCostWei != null
    ? (launchFeeWei + estimatedGasCostWei) * BigInt(100 + GAS_BUFFER_BPS) / BigInt(100)
    : null;
  const requiredEthDisplay = requiredWei != null
    ? (Number(requiredWei) / 1e18).toFixed(6).replace(/\.?0+$/, "")
    : null;
  const shortfallWei = requiredWei != null && requiredWei > evmBalanceWei
    ? requiredWei - evmBalanceWei
    : BigInt(0);
  const shortfallEth = Number(shortfallWei) / 1e18;
  const isFunded = requiredWei != null && evmBalanceWei >= requiredWei;
  const indexedLaunch = launch && isLaunchIndexed(launch) ? launch : null;
  const hasIndexedLaunch = indexedLaunch != null;
  const creatorWallet = agentWalletPublicKey?.trim() || "";
  useEffect(() => {
    if (!launch?.id || launch.launchStatus !== "draft") return;
    const stored = loadMintKeypairForLaunch(launch.id);
    if (stored) {
      mintKeypairRef.current = stored;
      return;
    }
    persistMintKeypairForLaunch(launch.id, mintKeypairRef.current);
  }, [launch?.id, launch?.launchStatus]);
  const walletBalanceLabel = balanceLoading
    ? "Refreshing…"
    : agentSolLamports == null
      ? "—"
      : `${formatWalletSol(agentSolLamports)} SOL`;
  const estimatedUsd =
    agentSolLamports != null && solPrice != null
      ? (() => {
          const usd = (agentSolLamports / 1_000_000_000) * solPrice;
          if (usd >= 1_000) return `$${usd.toFixed(0)}`;
          return `$${usd.toFixed(2)}`;
        })()
      : null;
  useEffect(() => {
    if (!initialLaunch?.id || isLaunchIndexed(initialLaunch)) return;
    let cancelled = false;
    void fetchLaunchDraft(initialLaunch.id, creatorWallet || null)
      .then(({ launch: restored, recovered, recoveredMint }) => {
        if (cancelled) return;
        setLaunch(restored);
        setForm(launchFromForm(selectedAgent, restored));
        if (recovered) {
          showToast(
            recoveredMint
              ? `Found your token on-chain (${recoveredMint.slice(0, 4)}…${recoveredMint.slice(-4)}). Launch restored — continue to finish setup.`
              : "Found your token on-chain. Launch restored — continue to finish setup.",
            "success",
          );
        }
      })
      .catch(() => {
        /* keep server bootstrap */
      });
    return () => {
      cancelled = true;
    };
  }, [initialLaunch, selectedAgent, creatorWallet]);
  const uploadImage = useCallback(
    async (file: File) => {
      setUploadingImage(true);
      try {
        if (isMetaplex) {
          let attemptId = metaplexAttemptIdRef.current;
          if (!attemptId) {
            const attempt = await createMetaplexLaunchAttempt({
              agentDbId,
              fields: {
                tokenName: form.tokenName,
                tokenSymbol: form.tokenSymbol,
                tokenDescription: form.tokenDescription,
                // Draft create may run before Irys upload — never send blob/CDN URLs.
                tokenImageUrl: isValidIrysGatewayUrl(form.tokenImageUrl)
                  ? form.tokenImageUrl
                  : "",
                website: selectedAgent.website,
                twitter: form.twitter,
                telegram: form.telegram,
                firstBuySol,
              },
            });
            attemptId = attempt.id;
            metaplexAttemptIdRef.current = attemptId;
          }
          const imageUri = await uploadMetaplexIrysImage({ attemptId, file });
          setForm((prev) => ({ ...prev, tokenImageUrl: imageUri }));
          setImagePreviewNonce(Date.now());
          showToast("Token image uploaded");
          return;
        }
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(
          `/api/dashboard/uploads/token-image?agentId=${agentDbId}`,
          { method: "POST", body: fd },
        );
        const data = (await res.json()) as {
          ok?: boolean;
          url?: string;
          path?: string;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Image upload failed");
        }
        setForm((prev) => ({
          ...prev,
          // Store stable relative path for DB; API also returns absolute publicUrl in `url`.
          tokenImageUrl: data.path || data.url || "",
        }));
        setImagePreviewNonce(Date.now());
        showToast("Token image saved");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Image upload failed";
        showToast(message, "error");
      } finally {
        setUploadingImage(false);
      }
    },
    [agentDbId, form, firstBuySol, isMetaplex, selectedAgent.website],
  );
  async function cropFileToSquare(file: File): Promise<File> {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = Math.floor((bitmap.width - side) / 2);
    const sy = Math.floor((bitmap.height - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image cropping is not supported in this browser");
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, 512, 512);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, file.type === "image/png" ? "image/png" : "image/webp", 0.9),
    );
    if (!blob) throw new Error("Could not crop image");
    const extension = file.type === "image/png" ? "png" : "webp";
    return new File([blob], file.name.replace(/\.[^.]+$/, `.${extension}`), {
      type: blob.type,
    });
  }
  const processImageFile = useCallback(
    async (file: File) => {
      const allowed = ["image/png", "image/jpeg", "image/webp"];
      if (!allowed.includes(file.type)) {
        showToast("Image must be PNG, JPG, or WEBP", "error");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast("Image is too large", "error");
        return;
      }
      try {
        const cropped = await cropFileToSquare(file);
        const blobUrl = URL.createObjectURL(cropped);
        setLocalImagePreview((prev) => {
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
          return blobUrl;
        });
        await uploadImage(cropped);
      } catch {
        showToast("Could not crop image", "error");
      }
    },
    [uploadImage],
  );
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await processImageFile(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [processImageFile],
  );
  const updateField = useCallback(
    <K extends keyof TokenLaunchFormFieldsNoWebsite>(
      key: K,
      value: TokenLaunchFormFieldsNoWebsite[K],
    ) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setError(null);
    },
    [],
  );
  const clearImage = useCallback(() => {
    setLocalImagePreview((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
    updateField("tokenImageUrl", "");
    showToast("Token image removed");
  }, [updateField]);
  const launchBlockers: string[] = [];
  if (isRobinhood) {
    if (!evmConfigured) launchBlockers.push("Set up your EVM wallet before launching on Robinhood Chain.");
    if (evmConfigured && launchFeeWei == null) launchBlockers.push("Checking launch fee…");
    if (evmConfigured && estimatedGasCostWei == null) launchBlockers.push("Estimating gas cost…");
    if (evmConfigured && launchFeeWei != null && estimatedGasCostWei != null && !isFunded) {
      const haveRh = evmBalanceEth.toFixed(6).replace(/\.?0+$/, "");
      if (mainnetBalanceEth > 0 && evmBalanceEth <= 0) {
        launchBlockers.push(
          `Fund the agent EVM wallet on Robinhood Chain (4663) — need ~${requiredEthDisplay} ETH. You have ${mainnetBalanceEth.toFixed(6).replace(/\.?0+$/, "")} ETH on Ethereum mainnet, but launches spend Robinhood ETH at ${evmAddress ? shortenEvmAddress(evmAddress) : "the agent wallet"}.`,
        );
      } else {
        launchBlockers.push(
          `Add ETH on Robinhood Chain to the agent wallet ${evmAddress ? shortenEvmAddress(evmAddress) : ""} — need ~${requiredEthDisplay} ETH (have ${haveRh} on chain 4663)`,
        );
      }
    }
    if (!form.tokenName.trim()) launchBlockers.push("Token name is required.");
    if (!form.tokenSymbol.trim()) launchBlockers.push("Token symbol is required.");
    if (!form.tokenImageUrl?.trim()) launchBlockers.push("Token logo is required.");
    if (!confirmed) launchBlockers.push("Confirm the launch terms above.");
  } else if (isMetaplex) {
    if (!launchBackendReady) launchBlockers.push("Launch backend is not enabled in this environment.");
    if (!creatorWallet) launchBlockers.push("Agent wallet must be provisioned before launch.");
    const metaplexFormError = validateMetaplexLaunchForm({
      tokenName: form.tokenName,
      tokenSymbol: form.tokenSymbol,
      tokenDescription: form.tokenDescription,
      tokenImageUrl: form.tokenImageUrl,
      firstBuySol,
    });
    if (metaplexFormError) launchBlockers.push(metaplexFormError);
    if (!confirmed) launchBlockers.push("Confirm the launch terms above.");
  } else {
    if (!launchBackendReady) launchBlockers.push("Launch backend is not enabled in this environment.");
    if (!creatorWallet) launchBlockers.push("Agent wallet must be provisioned before launch.");
    const formError = validateTokenLaunchForm(form);
    if (formError) launchBlockers.push(formError);
    if (!confirmed) launchBlockers.push("Confirm the launch terms above.");
  }
  const formError = isRobinhood
    ? null
    : isMetaplex
      ? validateMetaplexLaunchForm({
          tokenName: form.tokenName,
          tokenSymbol: form.tokenSymbol,
          tokenDescription: form.tokenDescription,
          tokenImageUrl: form.tokenImageUrl,
          firstBuySol,
        })
      : validateTokenLaunchForm(form);
  const canLaunch = isRobinhood
    ? launchBlockers.length === 0 && !loading && !rh.sendingTx && rh.phase !== "preparing" && rh.phase !== "signing" && rh.phase !== "indexing"
    : isMetaplex
      ? launchBackendReady &&
        !formError &&
        Boolean(creatorWallet) &&
        confirmed &&
        !hasIndexedLaunch &&
        !loading &&
        metaplexPhase === "idle"
      : launchBackendReady &&
        !formError &&
        Boolean(creatorWallet) &&
        confirmed &&
        !hasIndexedLaunch &&
        !loading;
  const pumpLaunchRequiredLamports =
    PUMP_LAUNCH_NETWORK_FEE_ESTIMATE_LAMPORTS +
    (feeDisplay.platformFeeSol
      ? solToLamports(Number.parseFloat(feeDisplay.platformFeeSol))
      : BigInt(0)) +
    (feeDisplay.initialBuySol
      ? solToLamports(Number.parseFloat(feeDisplay.initialBuySol))
      : BigInt(0));
  const pumpLaunchCostLabel = formatEstimatedSolLamports(pumpLaunchRequiredLamports);
  const metaplexFirstBuyLamports = solToLamports(Number.parseFloat(firstBuySol) || 0);
  const metaplexLaunchRequiredLamports =
    BigInt(METAPLEX_LAUNCH_DEPOSIT_LAMPORTS) + metaplexFirstBuyLamports;
  const metaplexLaunchCostLabel = formatEstimatedSolLamports(metaplexLaunchRequiredLamports);
  const solanaLaunchRequiredLamports = isMetaplex
    ? metaplexLaunchRequiredLamports
    : pumpLaunchRequiredLamports;
  const solanaLaunchCostLabel = isMetaplex ? metaplexLaunchCostLabel : pumpLaunchCostLabel;
  const isSolanaLaunchFunded =
    agentSolLamports != null &&
    BigInt(agentSolLamports) >= solanaLaunchRequiredLamports;
  const solanaLaunchShortfallLamports =
    agentSolLamports != null && !isSolanaLaunchFunded
      ? solanaLaunchRequiredLamports - BigInt(agentSolLamports)
      : null;
  const solanaLaunchShortfallLabel =
    solanaLaunchShortfallLamports != null
      ? formatEstimatedSolLamports(solanaLaunchShortfallLamports)
      : null;
  const readinessItems = isRobinhood
    ? [
        {
          label: "EVM wallet created",
          ok: evmConfigured,
          detail: evmConfigured && evmAddress
            ? shortenEvmAddress(evmAddress)
            : "Set up EVM wallet",
        },
        {
          label: "Chain ready",
          ok: true,
          detail: "Robinhood Chain · 4663",
        },
        {
          label: "Network cost",
          ok: rh.launchFeeEth != null,
          detail:
            rh.launchFeeEth == null
              ? "Loading…"
              : Number(rh.launchFeeEth) > 0
                ? `${rh.launchFeeEth} ETH + gas`
                : "Gas only",
        },
        {
          label: "Wallet funded",
          ok: isFunded,
          detail: isFunded
            ? `${evmBalanceEth.toFixed(6).replace(/\.?0+$/, "")} ETH on Robinhood`
            : shortfallWei > BigInt(0)
              ? `Need ~${shortfallEth.toFixed(6)} ETH more on Robinhood (have ${evmBalanceEth.toFixed(6).replace(/\.?0+$/, "")})`
              : launchFeeWei == null
                ? "Checking…"
                : "Not configured",
        },
        {
          label: "Token details valid",
          ok: Boolean(form.tokenName.trim() && form.tokenSymbol.trim() && form.tokenImageUrl?.trim()),
          detail: "Name, symbol, logo required",
        },
        {
          label: "Creator wallet verified",
          ok: Boolean(evmConfigured && evmAddress),
          detail: "Linked to selected agent",
        },
        {
          label: "Source verification",
          ok: true,
          detail: "AgentRanking Launch",
        },
      ]
    : [
    {
      label: "Agent wallet generated",
      ok: Boolean(creatorWallet),
      detail: creatorWallet ? shortenWallet(creatorWallet) : "Not provisioned",
    },
    {
      label: "Estimated SOL cost",
      ok: true,
      detail:
        isMetaplex && metaplexFirstBuyLamports > BigInt(0)
          ? `${solanaLaunchCostLabel} (incl. first buy)`
          : solanaLaunchCostLabel,
    },
    {
      label: "Agent wallet funded",
      ok: isSolanaLaunchFunded,
      detail: isSolanaLaunchFunded
        ? `${formatWalletSol(agentSolLamports!)} SOL`
        : agentSolLamports != null && agentSolLamports > 0
          ? `Have ${formatWalletSol(agentSolLamports)} · need ${solanaLaunchShortfallLabel ?? solanaLaunchCostLabel} more`
          : `Fund wallet · ${solanaLaunchCostLabel} needed`,
    },
    {
      label: "Fee recipient configured",
      ok: true,
      detail: "AgentRanking treasury",
    },
    {
      label: "Network ready",
      ok: launchBackendReady,
      detail: launchBackendReady ? networkLabel : "Not available",
    },
    {
      label: "Token details valid",
      ok: !formError,
      detail: formError ?? "Ready",
    },
    {
      label: "Token image ready",
      ok: isMetaplex
        ? isValidIrysGatewayUrl(form.tokenImageUrl)
        : Boolean(form.tokenImageUrl?.trim()),
      detail: isMetaplex
        ? isValidIrysGatewayUrl(form.tokenImageUrl)
          ? "Ready"
          : "Upload required"
        : form.tokenImageUrl?.trim()
          ? "Uploaded"
          : "Optional",
    },
  ];
  const selectSolana = useCallback(() => {
    if (launchTarget !== "solana") {
      showToast("Selected Solana · Pump.fun", "info");
    }
    setLaunchTarget("solana");
    setError(null);
  }, [launchTarget]);
  const selectMetaplex = useCallback(() => {
    if (launchTarget !== "metaplex") {
      showToast("Selected Solana · Metaplex Genesis", "info");
    }
    setLaunchTarget("metaplex");
    setError(null);
    setForm((prev) =>
      prev.tokenImageUrl && !isValidIrysGatewayUrl(prev.tokenImageUrl)
        ? { ...prev, tokenImageUrl: "" }
        : prev,
    );
  }, [launchTarget]);
  const selectRobinhood = useCallback(() => {
    if (launchTarget !== "robinhood") {
      showToast("Selected Robinhood Chain", "info");
    }
    setLaunchTarget("robinhood");
    setError(null);
  }, [launchTarget]);
  const selectSolanaChain = useCallback(() => {
    if (isRobinhood) {
      selectSolana();
      return;
    }
    setLaunchTarget((current) => (current === "robinhood" ? "solana" : current));
  }, [isRobinhood, selectSolana]);
  const selectRobinhoodChain = useCallback(() => {
    selectRobinhood();
  }, [selectRobinhood]);
  const evmIsCustodial =
    walletSummary?.evm?.provider === "custodial" ||
    initialEvmWallet?.provider === "custodial";
  const buildProfileEnrichmentPayload = useCallback(
    (websiteOverride?: string) => ({
      website: websiteOverride ?? enrichment.website,
      github: enrichment.github,
      archetype: enrichment.archetype,
      capabilityTags: enrichment.capabilityTags,
      services: enrichment.services,
      twitter: form.twitter,
      telegram: form.telegram,
      tokenImageUrl: form.tokenImageUrl,
      tokenName: form.tokenName,
      tokenDescription: form.tokenDescription,
      launchId: launch?.id ?? null,
    }),
    [enrichment, form, launch?.id],
  );
  const doRobinhoodLaunch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setShowConfirmModal(false);
    setConfirmChecked(false);
    rh.beginLaunch();
    try {
      const agentEvmAddress = evmConfigured ? evmAddress : null;
      if (!agentEvmAddress) {
        throw new Error("Agent EVM wallet is not configured. Set it up before launching.");
      }
      // Custodial: server-signs on Robinhood — no Privy/wagmi switch.
      // Privy-backed wallets require the active chain and wallet first.
      if (!evmIsCustodial) {
        if (!rh.onRobinhoodChain) {
          try {
            await rh.switchToRobinhood();
          } catch {
            throw new Error("Could not switch to Robinhood Chain (chain ID 4663).");
          }
        }
        const switched = await ensureWallet(agentEvmAddress, ROBINHOOD_CHAIN_ID);
        if (!switched) {
          throw new Error(
            "Could not switch to the agent's EVM wallet. Set up the EVM wallet for this agent, then try again.",
          );
        }
      }
      const result = await rh.launch(
        {
          tokenName: form.tokenName,
          tokenSymbol: form.tokenSymbol,
          tokenDescription: form.tokenDescription,
          tokenImageUrl: form.tokenImageUrl,
          website: rhWebsite,
          twitter: form.twitter,
          telegram: form.telegram,
          discord: rhDiscord,
          farcaster: rhFarcaster,
          agentDbId,
        },
        agentEvmAddress,
        { agentDbId, custodial: evmIsCustodial },
      );
      setLaunchSuccess({
        chain: "robinhood",
        tokenUrl: `/tokens/robinhood/${result.tokenAddress}`,
        name: form.tokenName.trim() || selectedAgent.name,
        symbol: form.tokenSymbol.trim() || suggestTokenSymbolFromAgentName(selectedAgent.name),
        imageUrl: form.tokenImageUrl.trim() || null,
      });
      await saveLaunchProfileEnrichment(agentDbId, buildProfileEnrichmentPayload(rhWebsite));
    } catch (err) {
      const mapped = mapRobinhoodLaunchError(err);
      setError(mapped.message);
      showToast(mapped.message, "error");
    } finally {
      setLoading(false);
    }
  }, [
    rh,
    evmConfigured,
    evmAddress,
    evmIsCustodial,
    ensureWallet,
    form,
    rhWebsite,
    rhDiscord,
    rhFarcaster,
    agentDbId,
    selectedAgent,
    buildProfileEnrichmentPayload,
  ]);
  const doSolanaLaunch = useCallback(async () => {
    if (!creatorWallet) {
      setError("Agent wallet is not ready yet.");
      return;
    }
    const validationError = validateTokenLaunchForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    setPhase("draft");
    try {
      const result = await runTokenLaunchPipeline({
        agentId: String(agentDbId),
        creatorWallet,
        fields: {
          tokenName: form.tokenName,
          tokenSymbol: form.tokenSymbol,
          tokenDescription: form.tokenDescription,
          tokenImageUrl: form.tokenImageUrl,
          website: enrichment.website,
          twitter: form.twitter,
          telegram: form.telegram,
        },
        profile: {
          website: enrichment.website,
          github: enrichment.github,
          archetype: enrichment.archetype,
          capabilityTags: enrichment.capabilityTags,
          services: enrichment.services,
        },
        existingLaunch: launch && !isLaunchIndexed(launch) ? launch : null,
        mintKeypair: mintKeypairRef.current,
        onPhase: (p) => {
          setPhase(p);
        },
      });
      setLaunch(result);
      clearMintKeypairForLaunch(result.id);
      mintKeypairRef.current = generateMintKeypair();
      setPhase("done");
      const mint = result.mint?.trim();
      if (mint) {
        setLaunchSuccess({
          chain: "solana",
          tokenUrl: `/tokens/${mint}`,
          name: form.tokenName.trim() || selectedAgent.name,
          symbol: form.tokenSymbol.trim() || suggestTokenSymbolFromAgentName(selectedAgent.name),
          imageUrl: form.tokenImageUrl.trim() || null,
        });
      }
      await saveLaunchProfileEnrichment(agentDbId, {
        ...buildProfileEnrichmentPayload(enrichment.website),
        launchId: result.id,
      });
    } catch (err) {
      console.error("[token-launch]", err);
      const friendly = mapTokenLaunchError(err);
      setError(friendly);
      setPhase("error");
      showToast(friendly, "error");
    } finally {
      setLoading(false);
    }
  }, [buildProfileEnrichmentPayload, creatorWallet, form, enrichment, agentDbId, launch, selectedAgent]);
  const doMetaplexLaunch = useCallback(async () => {
    if (!creatorWallet) {
      setError("Agent wallet is not ready yet.");
      return;
    }
    const validationError = validateMetaplexLaunchForm({
      tokenName: form.tokenName,
      tokenSymbol: form.tokenSymbol,
      tokenDescription: form.tokenDescription,
      tokenImageUrl: form.tokenImageUrl,
      firstBuySol,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!metaplexBindChecked) {
      setError("Confirm permanent token binding before launch.");
      return;
    }
    setLoading(true);
    setError(null);
    setShowMetaplexConfirmModal(false);
    setMetaplexPhase("draft");
    try {
      const result = await runMetaplexLaunchPipeline({
        agentDbId,
        fields: {
          tokenName: form.tokenName,
          tokenSymbol: form.tokenSymbol,
          tokenDescription: form.tokenDescription,
          tokenImageUrl: form.tokenImageUrl,
          website: enrichment.website || selectedAgent.website,
          twitter: form.twitter,
          telegram: form.telegram,
          firstBuySol,
          permanentBindConfirmed: true,
        },
        onPhase: (p) => setMetaplexPhase(p),
      });
      metaplexAttemptIdRef.current = result.id;
      setMetaplexPhase("done");
      const mint = result.tokenMint?.trim();
      const asset = result.assetAddress?.trim();
      setLaunchSuccess({
        chain: "metaplex",
        tokenUrl: result.metaplexLaunchUrl || (mint ? `/tokens/${mint}` : `/ranking?metaplex=true`),
        name: form.tokenName.trim() || selectedAgent.name,
        symbol: form.tokenSymbol.trim() || suggestTokenSymbolFromAgentName(selectedAgent.name),
        imageUrl: form.tokenImageUrl.trim() || null,
      });
      if (asset) {
        showToast("Metaplex Genesis launch complete", "success");
      }
      await saveLaunchProfileEnrichment(
        agentDbId,
        buildProfileEnrichmentPayload(enrichment.website || selectedAgent.website),
      );
    } catch (err) {
      const friendly = mapMetaplexLaunchClientError(err);
      setError(friendly);
      setMetaplexPhase("error");
      showToast(friendly, "error");
    } finally {
      setLoading(false);
      setMetaplexBindChecked(false);
    }
  }, [
    creatorWallet,
    form,
    enrichment.website,
    firstBuySol,
    agentDbId,
    selectedAgent,
    metaplexBindChecked,
    buildProfileEnrichmentPayload,
  ]);
  const goToLaunchedToken = useCallback(() => {
    if (!launchSuccess) return;
    globalThis.open(launchSuccess.tokenUrl, "_blank", "noopener,noreferrer");
    setTokenPageOpened(true);
    router.refresh();
  }, [launchSuccess, router]);
  useEffect(() => {
    if (!launchSuccess || tokenPageOpened) return;
    const timer = globalThis.setTimeout(() => {
      globalThis.open(launchSuccess.tokenUrl, "_blank", "noopener,noreferrer");
      setTokenPageOpened(true);
      router.refresh();
    }, 1800);
    return () => globalThis.clearTimeout(timer);
  }, [launchSuccess, router, tokenPageOpened]);
  const onLaunch = useCallback(() => {
    if (isRobinhood) {
      if (!canLaunch) return;
      setShowConfirmModal(true);
    } else if (isMetaplex) {
      if (!canLaunch) return;
      setShowMetaplexConfirmModal(true);
    } else {
      void doSolanaLaunch();
    }
  }, [isRobinhood, isMetaplex, canLaunch, doSolanaLaunch]);
  const saveProfileEnrichment = useCallback(async () => {
    await saveLaunchProfileEnrichment(agentDbId, buildProfileEnrichmentPayload(isRobinhood ? rhWebsite : undefined));
    showToast("Profile details saved", "success");
  }, [agentDbId, buildProfileEnrichmentPayload, isRobinhood, rhWebsite]);
  const profileEnrichmentPanel = (
    <LaunchProfileEnrichmentSection
      enrichment={isRobinhood ? { ...enrichment, website: rhWebsite } : enrichment}
      onChange={(next) => {
        if (isRobinhood) {
          setRhWebsite(next.website);
          setEnrichment({ ...next, website: enrichment.website });
          return;
        }
        setEnrichment(next);
      }}
      tokenFields={{
        name: form.tokenName,
        description: form.tokenDescription,
        imageUrl: form.tokenImageUrl,
        symbol: form.tokenSymbol,
        twitter: form.twitter,
        telegram: form.telegram,
      }}
      agentName={selectedAgent.name}
      agentDescription={selectedAgent.description}
      agentImage={selectedAgent.image}
      hasAgentWallet={Boolean(agentWalletPublicKey)}
      disabled={loading}
      hideWebsite={isRobinhood}
      onSave={hasIndexedLaunch || initialRobinhoodLaunch ? saveProfileEnrichment : undefined}
    />
  );
  // Keep the post-launch panel visible after the public page opens in a new tab.
  if (initialRobinhoodLaunch && (!launchSuccess || tokenPageOpened)) {
    return (
      <div className="space-y-6">
        <RobinhoodLaunchSuccessPanel
        launch={initialRobinhoodLaunch}
        agent={selectedAgent}
        agentDbId={agentDbId}
        evmAddress={evmAddress}
        onRobinhoodChain={rh.onRobinhoodChain}
        switchToRobinhood={rh.switchToRobinhood}
        initialClaimableFees={initialRobinhoodClaimableFees}
        custodial={evmIsCustodial}
      />
        {profileEnrichmentPanel}
      </div>
    );
  }
  if (
    indexedLaunch &&
    (!launchSuccess || tokenPageOpened) &&
    !loading
  ) {
    return (
      <div className="space-y-6">
        <LaunchSuccessPanel
        launch={indexedLaunch}
        agent={selectedAgent}
        networkLabel={networkLabel}
        agentWalletPublicKey={agentWalletPublicKey}
        agentWalletSolscanUrl={agentWalletSolscanUrl}
        initialClaimableFees={initialSolanaClaimableFees}
      />
        {profileEnrichmentPanel}
      </div>
    );
  }
  if (launchSuccess && tokenPageOpened) {
    return <FreshLaunchCompletePanel launch={launchSuccess} agentDbId={agentDbId} />;
  }
  const displaySymbol =
    form.tokenSymbol.trim() || suggestTokenSymbolFromAgentName(selectedAgent.name);
  const displayName = form.tokenName.trim() || selectedAgent.name;
  const displayDescription =
    form.tokenDescription.trim() || selectedAgent.description || "";
  const userDescriptionLength = form.tokenDescription.trim().length;
  const launchInFlight =
    (Boolean(launchSuccess) && !tokenPageOpened) ||
    (isRobinhood
      ? // Keep the pending screen up through wallet switch, prepare, Privy approve, and indexing.
        loading ||
        rh.sendingTx ||
        rh.phase === "preparing" ||
        rh.phase === "signing" ||
        rh.phase === "indexing" ||
        rh.phase === "done"
      : isMetaplex
        ? loading &&
          metaplexPhase !== "idle" &&
          metaplexPhase !== "error"
        : (loading || rh.sendingTx) &&
          phase !== "idle" &&
          phase !== "error" &&
          phase !== "done");
  const pendingPhaseLabel = launchSuccess
      ? "Launch complete"
      : isRobinhood
        ? loading && rh.phase === "idle"
          ? "Switching wallet…"
          : rh.phase === "preparing"
            ? "Preparing transaction…"
            : rh.phase === "signing" || rh.sendingTx
              ? "Confirm in wallet…"
              : rh.phase === "indexing"
                ? "Publishing to AgentRanking…"
                : "Launching…"
        : isMetaplex
          ? METAPLEX_PHASE_LABELS[metaplexPhase] !== "Launch token"
            ? METAPLEX_PHASE_LABELS[metaplexPhase]
            : "Launching on Metaplex Genesis…"
          : pumpPendingPhaseLabel(phase);
  const pendingTitle = launchSuccess
    ? "Token launched"
    : isRobinhood
      ? "Launching on Robinhood Chain"
      : isMetaplex
        ? "Launching on Metaplex Genesis"
        : "Launching on Pump.fun";
  const pendingSubtitle = launchSuccess
    ? "Opening your public token page in a new tab…"
    : isRobinhood
      ? rh.phase === "signing" || rh.sendingTx
        ? "Approve the transaction in Privy to finish launching."
        : "Stay on this screen — we’ll prompt your wallet when ready."
      : isMetaplex
        ? metaplexPhase === "mint_agent"
          ? "Registering the Metaplex agent and uploading metadata…"
          : metaplexPhase === "genesis" || metaplexPhase === "register"
            ? "Creating the Genesis bonding-curve token on Solana…"
            : metaplexPhase === "index"
              ? "Publishing the launch to AgentRanking…"
              : "Stay on this screen until Metaplex Genesis finishes."
        : phase === "metadata"
          ? "Uploading token metadata…"
          : phase === "sending" || phase === "confirming"
            ? "Creating your Pump.fun token on Solana…"
            : phase === "syncing" || phase === "routing"
              ? "Syncing the launch to AgentRanking…"
              : "Stay on this screen until Pump.fun launch finishes.";
  if (launchInFlight && !error && !rh.error) {
    return (
      <>
        <LaunchTokenPendingScreen
          title={pendingTitle}
          subtitle={pendingSubtitle}
          tokenName={form.tokenName.trim() || selectedAgent.name}
          tokenSymbol={form.tokenSymbol.trim() || displaySymbol}
          imageUrl={form.tokenImageUrl.trim() || null}
          phaseLabel={pendingPhaseLabel}
        />
        <Dialog
          open={Boolean(launchSuccess) && !tokenPageOpened}
          onOpenChange={(open) => {
            if (!open && launchSuccess) goToLaunchedToken();
          }}
        >
          <DialogContent className="ui-overview-panel overflow-hidden rounded-xl p-0 sm:max-w-md">
            <DialogHeader className="ui-overview-panel-header px-5 py-4">
              <DialogTitle className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-muted">
                  <Check className="h-4 w-4 text-foreground" aria-hidden />
                </span>
                Token launched
              </DialogTitle>
              <DialogDescription>
                {launchSuccess?.chain === "robinhood"
                  ? "Your Robinhood Chain token is live and linked to this agent."
                  : launchSuccess?.chain === "metaplex"
                    ? "Your Metaplex Genesis token is live and linked to this agent."
                    : "Your Pump.fun token is live and linked to this agent."}
              </DialogDescription>
            </DialogHeader>
            {launchSuccess ? (
              <div className="ui-overview-metric mx-5 flex items-center gap-3 rounded-xl px-3 py-3">
                <AgentAvatar
                  image={launchSuccess.imageUrl || undefined}
                  name={launchSuccess.name}
                  size="md"
                  className="!h-12 !w-12 rounded-xl"
                />
                <div className="min-w-0">
                  <p className="font-semibold">${launchSuccess.symbol}</p>
                  <p className="truncate text-sm text-muted-foreground">{launchSuccess.name}</p>
                </div>
              </div>
            ) : null}
            <DialogFooter className="gap-2 px-5 pb-5 sm:justify-stretch">
              <Button type="button" className="w-full" onClick={goToLaunchedToken}>
                Open token page
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <div className="ui-token-launch-page space-y-4 sm:space-y-6">
      <div className="ui-overview-panel rounded-xl space-y-4 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar image={selectedAgent.image} name={selectedAgent.name} size="md" />
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Selected agent
            </p>
            <p className="truncate font-semibold">{selectedAgent.name}</p>
          </div>
        </div>
        <div className="border-t border-border/60 pt-4">
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {isRobinhood ? "Creator wallet" : "Agent wallet"}
            </p>
            {isRobinhood ? (
              <div className="space-y-3">
                {walletSummaryLoading && !walletSummary ? (
                  <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading EVM wallet…
                  </p>
                ) : evmConfigured && evmAddress ? (
                  <div className="space-y-3 rounded-xl border border-border/60 bg-[#212121] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <EthereumIcon className="h-4 w-4 shrink-0 opacity-70" />
                      <p className="min-w-0 truncate font-mono text-sm text-foreground/90">
                        {shortenEvmAddress(evmAddress, 6)}
                      </p>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                        onClick={() => {
                          void navigator.clipboard.writeText(evmAddress);
                          showToast("Address copied");
                        }}
                        aria-label="Copy EVM address"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <Button size="sm" variant="ghost" className="h-7 px-1.5" asChild>
                        <a
                          href={robinhoodChainExplorerUrl(evmAddress)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Robinhood Chain explorer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-7 px-1.5"
                        disabled={evmBalanceLoading}
                        onClick={() => void syncEvmBalance()}
                        title="Refresh balances"
                      >
                        <RefreshCw
                          className={cn("h-3.5 w-3.5", evmBalanceLoading && "animate-spin")}
                          aria-hidden
                        />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="ui-launch-stat">
                        <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
                          <EthereumIcon className="h-3 w-3 opacity-70" />
                          Ethereum
                        </p>
                        <p className="font-medium tabular-nums text-sm">
                          {evmBalanceLoading && evmMainnetBalanceEth == null
                            ? "…"
                            : `${formatEthCompact(
                                evmMainnetBalanceEth
                                  ?? walletSummary?.evm?.mainnet?.balances?.nativeDisplay
                                  ?? walletSummary?.evm?.balances?.nativeDisplay,
                              )} ETH`}
                        </p>
                      </div>
                      <div className="ui-launch-stat">
                        <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
                          <RobinhoodChainIcon className="h-3 w-3" />
                          Robinhood
                        </p>
                        <p className="font-medium tabular-nums text-sm">
                          {evmBalanceLoading && evmRobinhoodBalanceEth == null
                            ? "…"
                            : `${formatEthCompact(
                                evmRobinhoodBalanceEth
                                  ?? walletSummary?.evm?.robinhood?.balances?.nativeDisplay,
                              )} ETH`}
                        </p>
                      </div>
                      <div className="ui-launch-stat">
                        <p className="text-muted-foreground mb-1 text-[11px] uppercase tracking-wide">
                          Network cost
                        </p>
                        <p className="font-medium tabular-nums text-sm">
                          {rh.launchFeeEth == null
                            ? "Quoting…"
                            : Number(rh.launchFeeEth) > 0
                              ? `${rh.launchFeeEth} ETH + gas`
                              : "Gas only"}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-muted-foreground text-sm">
                      Set up your agent EVM wallet to launch on Robinhood Chain.
                    </p>
                    {evmSetupError ? <p className="text-destructive text-xs">{evmSetupError}</p> : null}
                    <Button
                      type="button"
                      size="sm"
                      disabled={evmSetupState === "creating" || evmSetupState === "persisting"}
                      onClick={async () => {
                        await setupEvmWallet();
                        await refreshAfterSetup();
                        await syncEvmBalance();
                      }}
                    >
                      {evmSetupState === "creating" || evmSetupState === "persisting" ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Setting up…
                        </>
                      ) : (
                        <>
                          <Plus className="mr-1.5 h-3.5 w-3.5" /> Set up EVM wallet
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            ) : agentWalletPublicKey ? (
              <div className="space-y-3 rounded-xl border border-border/60 bg-[#212121] px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <RuntimeImage
                    src="/branding/solana/solanaLogoMark.svg"
                    alt=""
                    className="h-4 w-4 shrink-0"
                    aria-hidden
                  />
                  <p className="min-w-0 truncate font-mono text-sm text-foreground/90">
                    {shortenWallet(agentWalletPublicKey)}
                  </p>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                    onClick={() => void copyWallet()}
                    aria-label="Copy Solana address"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {agentWalletSolscanUrl ? (
                    <Button size="sm" variant="ghost" className="h-7 px-1.5" asChild>
                      <a
                        href={agentWalletSolscanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Solscan"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 px-1.5"
                    disabled={balanceLoading}
                    onClick={() => void syncBalance()}
                    title="Refresh balance"
                  >
                    <RefreshCw
                      className={cn("h-3.5 w-3.5", balanceLoading && "animate-spin")}
                      aria-hidden
                    />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="ui-launch-stat">
                    <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
                      <RuntimeImage
                        src="/branding/solana/solanaLogoMark.svg"
                        alt=""
                        className="h-3 w-3 shrink-0 opacity-70"
                        aria-hidden
                      />
                      Balance
                    </p>
                    <p className="font-medium tabular-nums text-sm">
                      {balanceLoading && agentSolLamports == null
                        ? "…"
                        : walletBalanceLabel}
                    </p>
                  </div>
                  <div className="ui-launch-stat">
                    <p className="text-muted-foreground mb-1 text-[11px] uppercase tracking-wide">
                      USD value
                    </p>
                    <p className="font-medium tabular-nums text-sm">
                      {balanceLoading && agentSolLamports == null
                        ? "…"
                        : estimatedUsd ?? "—"}
                    </p>
                  </div>
                  <div className="ui-launch-stat">
                    <p className="text-muted-foreground mb-1 text-[11px] uppercase tracking-wide">
                      Network
                    </p>
                    <p className="font-medium text-sm">{networkLabel}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  {selectedAgent.isNative
                    ? "Agent wallet not provisioned. Set it up before launching on Solana."
                    : "No agent wallet on file. This agent was not created through AgentRanking and does not have a custodial wallet."}
                </p>
                {selectedAgent.isNative ? (
                  <Button size="sm" variant="secondary" asChild>
                    <Link href={`/dashboard/agents/${agentDbId}/wallet`}>
                      Open wallet setup
                    </Link>
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="ui-overview-panel rounded-xl space-y-4 p-4 sm:p-5">
        <div className="space-y-2">
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            Chain
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className={launchOptionClass(selectedChain === "solana")}
              onClick={selectSolanaChain}
            >
              <RuntimeImage
                src="/branding/solana/solanaLogoMark.svg"
                alt=""
                className="h-4 w-4 shrink-0"
                aria-hidden
              />
              Solana
            </button>
            <button
              type="button"
              className={launchOptionClass(selectedChain === "robinhood")}
              onClick={selectRobinhoodChain}
            >
              <RobinhoodChainIcon className="h-4 w-4 shrink-0" aria-hidden />
              Robinhood
            </button>
          </div>
        </div>
        <div className="space-y-2 border-t border-border/60 pt-4">
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            Protocol
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {selectedChain === "solana" ? (
              <>
                <button
                  type="button"
                  className={launchOptionClass(launchTarget === "solana")}
                  onClick={selectSolana}
                >
                  <RuntimeImage
                    src="/brandkit/protocol-logos/pumpfun.png"
                    alt=""
                    className="h-4 w-4 shrink-0 rounded object-contain"
                    aria-hidden
                  />
                  Pump.fun
                </button>
                <button
                  type="button"
                  className={launchOptionClass(launchTarget === "metaplex")}
                  onClick={selectMetaplex}
                >
                  <RuntimeImage
                    src="/brandkit/protocol-logos/metaplex.avif"
                    alt=""
                    className="h-4 w-4 shrink-0 rounded object-contain"
                    aria-hidden
                  />
                  Metaplex
                </button>
                <span className={launchOptionClass(false, true)}>
                  <RuntimeImage
                    src="/brandkit/protocol-logos/orbit.webp"
                    alt=""
                    className="h-4 w-4 shrink-0 rounded object-contain opacity-60"
                    aria-hidden
                  />
                  Xona
                  <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[10px] font-normal">
                    Soon
                  </Badge>
                </span>
              </>
            ) : (
              <button
                type="button"
                className={launchOptionClass(launchTarget === "robinhood")}
                onClick={selectRobinhood}
              >
                <RuntimeImage
                  src="/brandkit/protocol-logos/robinhood.com.png"
                  alt=""
                  className="h-4 w-4 shrink-0 rounded object-contain"
                  aria-hidden
                />
                Robinhood
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="ui-overview-panel rounded-xl space-y-5 p-4 sm:p-5">
        <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
          Token details
          {isMetaplex ? (
            <span className="text-muted-foreground/80 normal-case"> · image required</span>
          ) : null}
        </p>
        <div className="space-y-3">
          <Label className="text-sm">Token image</Label>
          <div
            className={cn(
              "rounded-xl border border-dashed p-3 transition-colors",
              imageDragActive
                ? "border-foreground/30 bg-[#212121]"
                : "border-border/60 bg-[#0f0f0f]",
            )}
            onDragEnter={(event) => {
              event.preventDefault();
              setImageDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setImageDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setImageDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setImageDragActive(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void processImageFile(file);
            }}
          >
            <div className="flex items-center gap-3">
              {form.tokenImageUrl || localImagePreview ? (
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border/60">
                  <TokenLaunchPreviewImage
                    src={tokenImagePreviewSrc}
                    alt="Token preview"
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-border bg-[#212121]">
                  <ImageIcon className="h-5 w-5 text-muted-foreground/60" aria-hidden />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {uploadingImage ? "Uploading…" : "Drop image or choose file"}
                </p>
                <p className="text-muted-foreground text-xs">PNG, JPG, or WEBP</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={uploadingImage}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploadingImage ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Upload className="mr-2 h-3.5 w-3.5" aria-hidden />
                    )}
                    Upload
                  </Button>
                  {!isMetaplex ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingImage || !selectedAgent.image?.trim()}
                      onClick={() => {
                        setLocalImagePreview((prev) => {
                          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
                          return null;
                        });
                        updateField("tokenImageUrl", selectedAgent.image || "");
                        setImagePreviewNonce(Date.now());
                      }}
                    >
                      Agent photo
                    </Button>
                  ) : null}
                  {form.tokenImageUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={uploadingImage}
                      onClick={clearImage}
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="token-name"
                label="Token name"
                current={form.tokenName.length}
                max={nameMaxLength}
              />
              <Input
                id="token-name"
                value={form.tokenName}
                onChange={(e) => updateField("tokenName", e.target.value)}
                placeholder={selectedAgent.name}
                maxLength={nameMaxLength}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel
                htmlFor="token-symbol"
                label="Token symbol"
                current={form.tokenSymbol.length}
                max={symbolMaxLength}
              />
              <Input
                id="token-symbol"
                value={form.tokenSymbol}
                onChange={(e) =>
                  updateField("tokenSymbol", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                }
                placeholder={suggestTokenSymbolFromAgentName(selectedAgent.name)}
                maxLength={symbolMaxLength}
              />
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel
              htmlFor="token-description"
              label="Description"
              current={userDescriptionLength}
              max={descriptionMaxLength}
            />
            <Textarea
              id="token-description"
              value={form.tokenDescription}
              onChange={(e) => updateField("tokenDescription", e.target.value)}
              placeholder={selectedAgent.description || "Describe your token…"}
              rows={4}
              maxLength={descriptionMaxLength}
            />
            {formError ? <p className="text-destructive text-xs">{formError}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel htmlFor="token-x" label="X / Twitter" optional />
              <Input
                id="token-x"
                value={form.twitter}
                onChange={(e) => updateField("twitter", e.target.value)}
                placeholder={selectedAgent.twitter || "@handle"}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="token-telegram" label="Telegram" optional />
              <Input
                id="token-telegram"
                value={form.telegram}
                onChange={(e) => updateField("telegram", e.target.value)}
                placeholder={selectedAgent.telegram || "@channel"}
              />
            </div>
            {isMetaplex ? (
              <div className="space-y-2 sm:col-span-2">
                <FieldLabel htmlFor="metaplex-first-buy" label="Optional first buy (SOL)" optional />
                <Input
                  id="metaplex-first-buy"
                  inputMode="decimal"
                  value={firstBuySol}
                  onChange={(e) => setFirstBuySol(e.target.value)}
                  placeholder="0"
                />
                <p className="text-muted-foreground text-xs">
                  Defaults to 0 SOL. First buy is fee-free when enabled.
                </p>
              </div>
            ) : null}
            {isRobinhood ? (
              <>
                <div className="space-y-2">
                  <FieldLabel htmlFor="token-website" label="Website" optional />
                  <Input
                    id="token-website"
                    value={rhWebsite}
                    onChange={(e) => setRhWebsite(e.target.value)}
                    placeholder="https://"
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel htmlFor="token-discord" label="Discord" optional />
                  <Input
                    id="token-discord"
                    value={rhDiscord}
                    onChange={(e) => setRhDiscord(e.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <FieldLabel htmlFor="token-farcaster" label="Farcaster" optional />
                  <Input
                    id="token-farcaster"
                    value={rhFarcaster}
                    onChange={(e) => setRhFarcaster(e.target.value)}
                  />
                </div>
              </>
            ) : null}
          </div>
          <div className="border-t border-border/50 pt-4">
            {profileEnrichmentPanel}
          </div>
          <div className="border-t border-border/50 pt-5 space-y-4">
            <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              Preview
            </p>
            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-[#0f0f0f] p-4">
              <AgentAvatar
                image={tokenImagePreviewSrc}
                name={displayName}
                size="lg"
                className="!h-14 !w-14 shrink-0 rounded-2xl"
              />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold tracking-tight">${displaySymbol}</p>
                <p className="truncate text-sm font-medium text-foreground/90">{displayName}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {isRobinhood ? "Robinhood Chain" : `Solana · ${networkLabel}`}
                </p>
                <p
                  className={cn(
                    "mt-2 line-clamp-2 text-sm leading-relaxed",
                    displayDescription ? "text-foreground/80" : "text-muted-foreground italic",
                  )}
                >
                  {displayDescription || "Add a description for your token."}
                </p>
              </div>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              {isRobinhood ? (
                <>
                  <PreviewEconomicsRow label="Provider" value="Robinhood Chain" />
                  <PreviewEconomicsRow
                    label="Network cost"
                    value={
                      rh.launchFeeEth == null
                        ? "Quoted at prepare"
                        : Number(rh.launchFeeEth) > 0
                          ? `${rh.launchFeeEth} ETH + gas`
                          : "Gas only"
                    }
                  />
                  <PreviewEconomicsRow
                    label="Creator wallet"
                    value={
                      evmConfigured && evmAddress
                        ? shortenEvmAddress(evmAddress)
                        : "Not configured"
                    }
                  />
                  <PreviewEconomicsRow label="Trading fees" value="70%/30%" />
                </>
              ) : isMetaplex ? (
                <>
                  <PreviewEconomicsRow label="Provider" value="Metaplex Genesis" />
                  <PreviewEconomicsRow label="Launch type" value="Bonding curve" />
                  <PreviewEconomicsRow
                    label="First buy"
                    value={firstBuySol.trim() ? `${firstBuySol} SOL` : "0 SOL"}
                  />
                  <PreviewEconomicsRow label="Creator fees" value="Agent Core PDA" />
                </>
              ) : (
                <>
                  <PreviewEconomicsRow label="Provider" value="Pump.fun" />
                  <PreviewEconomicsRow
                    label="Platform fee"
                    value={feeDisplay.platformFeeSol ?? "None"}
                  />
                  <PreviewEconomicsRow
                    label="Bundled buy"
                    value={feeDisplay.initialBuySol ?? "None"}
                  />
                  <PreviewEconomicsRow label="Creator fees" value="70%/30%" />
                </>
              )}
            </dl>
            {!isRobinhood && agentWalletPublicKey && agentWalletSolscanUrl ? (
              <Button size="sm" variant="secondary" className="w-full sm:w-auto" asChild>
                <a href={agentWalletSolscanUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden />
                  View wallet on Solscan
                </a>
              </Button>
            ) : null}
          </div>
      </div>
      <div className="ui-overview-panel rounded-xl space-y-3 p-0 overflow-hidden">
        <div className="ui-overview-panel-header px-5 py-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Readiness checklist
          </p>
        </div>
        <dl className="ui-settings-panel-body mx-auto grid w-full max-w-2xl gap-2 sm:grid-cols-2">
          {readinessItems.map((item) => (
            <div
              key={item.label}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3",
                item.ok
                  ? "border-emerald-500/20 bg-emerald-500/[0.04]"
                  : "border-amber-500/20 bg-amber-500/[0.04]",
              )}
            >
              <dt className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    item.ok
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-amber-500/15 text-amber-500",
                  )}
                >
                  {item.ok ? (
                    <Check className="h-3 w-3" aria-hidden />
                  ) : (
                    <span className="text-[10px] font-bold">!</span>
                  )}
                </span>
                <span className="truncate">{item.label}</span>
              </dt>
              <dd
                className={cn(
                  "text-xs sm:text-right sm:shrink-0",
                  item.ok ? "text-muted-foreground" : "text-amber-500",
                )}
              >
                {item.detail}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="ui-overview-panel rounded-xl overflow-hidden p-0">
        <div className="ui-settings-panel-body ui-token-launch-footer mx-auto flex w-full max-w-2xl flex-col items-center space-y-4 py-5 text-center sm:py-6">
          <label className="flex w-full cursor-pointer items-start justify-center gap-3 text-sm sm:items-center">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(value: boolean) => setConfirmed(value === true)}
              className="mt-0.5 shrink-0 sm:mt-0"
            />
            <span className="text-left text-muted-foreground leading-relaxed sm:text-center">
            {isRobinhood ? (
              <>
                I confirm launching <span className="font-medium text-foreground">{selectedAgent.name}</span> on Robinhood Chain. Gas is paid from the agent EVM wallet.
              </>
            ) : isMetaplex ? (
              <>
                I confirm launching Metaplex Genesis for{" "}
                <span className="font-medium text-foreground">{selectedAgent.name}</span> ({metaplexLaunchCostLabel} from agent wallet).
              </>
            ) : (
              <>
                I confirm launching a Pump.fun token for{" "}
                <span className="font-medium text-foreground">{selectedAgent.name}</span> ({pumpLaunchCostLabel} network cost).
              </>
            )}
            </span>
          </label>
          <div className="flex w-full flex-col items-center gap-3">
            {error || rh.error ? (
              <p className="text-destructive text-sm">{error ?? rh.error}</p>
            ) : null}
            {!canLaunch && launchBlockers.length > 0 && !loading && !rh.sendingTx ? (
              <p className="text-sm text-amber-500">{launchBlockers[0]}</p>
            ) : null}
        {(loading || rh.sendingTx) &&
        (isRobinhood
          ? rh.phase !== "idle" && rh.phase !== "error" && rh.phase !== "done"
          : isMetaplex
            ? metaplexPhase !== "idle" && metaplexPhase !== "error" && metaplexPhase !== "done"
            : phase !== "idle" && phase !== "error") ? (
          <div className="space-y-2 rounded-lg border border-border bg-[#212121] p-3 text-left w-full">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Launch in progress
            </p>
            <p className="text-muted-foreground text-xs">
              Do not close this tab until confirmation completes.
            </p>
            {isRobinhood ? (
              <p className="text-muted-foreground text-xs capitalize">{rh.phase}…</p>
            ) : isMetaplex ? (
              <div className="space-y-1 pt-1">
                {METAPLEX_PROGRESS_STEPS.map((step, idx) => {
                  const activeIdx = resolveMetaplexProgressStepIndex(metaplexPhase);
                  const status: "completed" | "active" | "pending" =
                    activeIdx < 0
                      ? "pending"
                      : idx < activeIdx
                        ? "completed"
                        : idx === activeIdx
                          ? "active"
                          : "pending";
                  return (
                    <div key={step.key} className="flex items-center gap-2 text-xs">
                      {status === "completed" ? (
                        <Check className="text-emerald-500 h-3.5 w-3.5 shrink-0" aria-hidden />
                      ) : status === "active" ? (
                        <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <span className="text-muted-foreground/40 h-3.5 w-3.5 shrink-0 text-center">-</span>
                      )}
                      <span
                        className={
                          status === "completed"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : status === "active"
                              ? "text-foreground font-medium"
                              : "text-muted-foreground/50"
                        }
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
            <div className="space-y-1 pt-1">
              {PROGRESS_STEPS.map((step, idx) => {
                const activeIdx = resolveProgressStepIndex(phase);
                const status: "completed" | "active" | "pending" =
                  activeIdx < 0
                    ? "pending"
                    : idx < activeIdx
                      ? "completed"
                      : idx === activeIdx
                        ? "active"
                        : "pending";
                return (
                  <div key={step.key} className="flex items-center gap-2 text-xs">
                    {status === "completed" ? (
                      <Check className="text-emerald-500 h-3.5 w-3.5 shrink-0" aria-hidden />
                    ) : status === "active" ? (
                      <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    ) : (
                      <span className="text-muted-foreground/40 h-3.5 w-3.5 shrink-0 text-center">-</span>
                    )}
                    <span
                      className={
                        status === "completed"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : status === "active"
                            ? "text-foreground font-medium"
                            : "text-muted-foreground/50"
                      }
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        ) : null}
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className={cn("w-full max-w-sm", !canLaunch && "opacity-80")}
          disabled={!canLaunch || loading || rh.sendingTx}
          onClick={() => void onLaunch()}
        >
          {loading || rh.sendingTx ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              {isRobinhood
                ? rh.phase === "preparing"
                  ? "Preparing transaction…"
                  : rh.phase === "signing"
                    ? "Confirm in wallet…"
                    : rh.phase === "indexing"
                      ? "Indexing launch…"
                      : "Launching…"
                : isMetaplex
                  ? METAPLEX_PHASE_LABELS[metaplexPhase]
                  : PHASE_BUTTON_LABELS[phase]}
            </>
          ) : phase === "done" || metaplexPhase === "done" ? (
            <>
              <Check className="mr-2 h-4 w-4" aria-hidden />
              {PHASE_BUTTON_LABELS.done}
            </>
          ) : isRobinhood && !evmConfigured ? (
            <>
              <Rocket className="mr-2 h-4 w-4" aria-hidden />
              Set up EVM wallet to launch
            </>
          ) : (
            <>
              <Rocket className="mr-2 h-4 w-4" aria-hidden />
              {isRobinhood ? "EVM Launch" : isMetaplex ? "Metaplex Genesis launch" : PHASE_BUTTON_LABELS.idle}
            </>
          )}
        </Button>
        </div>
        </div>
      </div>
      {/* ── Robinhood Launch Confirmation Modal ── */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="ui-overview-panel w-full max-w-md overflow-hidden rounded-xl p-0 shadow-2xl">
            <div className="ui-overview-panel-header flex items-center justify-between px-5 py-4">
              <h2 className="text-base font-semibold">Confirm Robinhood Chain launch</h2>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setShowConfirmModal(false); setConfirmChecked(false); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <dl className="ui-overview-metric grid gap-2 rounded-lg p-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Token</dt>
                  <dd className="font-medium">{form.tokenName || displayName} (${form.tokenSymbol || displaySymbol})</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Chain</dt>
                  <dd className="font-medium">Robinhood Chain · 4663</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Creator wallet</dt>
                  <dd className="font-medium font-mono text-xs">
                    {evmConfigured && evmAddress
                      ? shortenEvmAddress(evmAddress)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Network cost</dt>
                  <dd className="font-medium">
                    {rh.launchFeeEth == null
                      ? "—"
                      : Number(rh.launchFeeEth) > 0
                        ? `${rh.launchFeeEth} ETH`
                        : "Gas only"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Est. gas</dt>
                  <dd className="font-medium">{estimatedGasCostEthDisplay ? `~${Number.parseFloat(estimatedGasCostEthDisplay).toFixed(6).replace(/\.?0+$/, "")} ETH` : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Est. total</dt>
                  <dd className="font-semibold">{requiredEthDisplay ? `~${requiredEthDisplay} ETH` : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Liquidity</dt>
                  <dd className="font-medium">V3 launch infrastructure</dd>
                </div>
              </dl>
              <div className="rounded-lg border border-border/60 bg-[#212121] p-3">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  The selected agent EVM wallet will be the on-chain creator and receive creator rights and creator fees.
                </p>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <Checkbox
                  checked={confirmChecked}
                  onCheckedChange={(v) => setConfirmChecked(v === true)}
                  className="mt-0.5 shrink-0"
                />
                <span className="text-muted-foreground leading-relaxed">
                  I confirm launching from the agent EVM wallet on Robinhood Chain. Gas costs are non-refundable.
                </span>
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => { setShowConfirmModal(false); setConfirmChecked(false); }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={!confirmChecked || loading}
                  onClick={() => void doRobinhoodLaunch()}
                >
                  {loading ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Launching…</>
                  ) : (
                    "Launch on Robinhood Chain"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showMetaplexConfirmModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="ui-overview-panel w-full max-w-md overflow-hidden rounded-xl p-0 shadow-2xl">
            <div className="ui-overview-panel-header flex items-center justify-between px-5 py-4">
              <h2 className="text-base font-semibold">Confirm Metaplex Genesis launch</h2>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => {
                  setShowMetaplexConfirmModal(false);
                  setMetaplexBindChecked(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <dl className="ui-overview-metric grid gap-2 rounded-lg p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Token</dt>
                  <dd className="font-medium text-right">
                    {form.tokenName || selectedAgent.name} (${form.tokenSymbol || displaySymbol})
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Network</dt>
                  <dd className="font-medium">{networkLabel}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">First buy</dt>
                  <dd className="font-medium">{firstBuySol.trim() || "0"} SOL</dd>
                </div>
              </dl>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-sm leading-relaxed">
                  This token will be permanently bound to the Metaplex agent Core asset and cannot be
                  replaced or unset.
                </p>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <Checkbox
                  checked={metaplexBindChecked}
                  onCheckedChange={(v) => setMetaplexBindChecked(v === true)}
                  className="mt-0.5 shrink-0"
                />
                <span className="text-muted-foreground leading-relaxed">
                  I understand this binding is permanent. Creator fees route to the agent asset signer
                  PDA. Launched via AgentRanking attribution will be embedded; AR verification is
                  separate.
                </span>
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowMetaplexConfirmModal(false);
                    setMetaplexBindChecked(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={!metaplexBindChecked || loading}
                  onClick={() => void doMetaplexLaunch()}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Launching…
                    </>
                  ) : (
                    "Launch on Metaplex Genesis"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
