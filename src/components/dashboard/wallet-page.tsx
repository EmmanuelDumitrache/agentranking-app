"use client";
import { useTransientState } from "@/hooks/use-transient-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardWalletTransferModal } from "@/components/dashboard/wallet-transfer-modal";
import { LlmCreditTopUpDialog } from "@/components/dashboard/llm-credit-top-up-dialog";
import { DashboardEvmSendModal } from "@/components/dashboard/evm-send-modal";
import { showToast } from "@/components/ui/toast-simple";
import type { DashboardWalletPageData } from "@/lib/dashboard/wallet-page";
import { cn } from "@/lib/utils";
import {
  evmExplorerUrl,
  formatEthCompact,
  robinhoodChainExplorerTxUrl,
  robinhoodChainExplorerUrl,
  shortenEvmAddress,
} from "@/lib/evm-wallet-utils";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import { EthereumIcon } from "@/components/shared/ethereum-icon";
import { useAgentEvmWalletSetup } from "@/lib/use-agent-evm-wallet-setup";
import { RobinhoodFeeClaimPanel } from "@/components/robinhood-chain/robinhood-fee-claim-panel";
import { useRobinhoodLaunchFlow } from "@/components/robinhood-chain/use-robinhood-launch-flow";
import { requestAgentLaunchFeeDistribution } from "@/lib/agent-launch/fee-distribution-client";
import type { AgentLaunchClaimableFeesDto } from "@/lib/agent-launch/claimable-fees";
type FeeData = AgentLaunchClaimableFeesDto;
type AgentTransfer = {
  id: string;
  token: string;
  fromPublicKey: string;
  toPublicKey: string;
  amountLamports: string;
  signature: string | null;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
};
type EvmActivityRow = {
  id: string;
  type: "launch";
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenAddress: string;
  txHash: string;
  sourceVerified: boolean;
  blockTimestamp: string;
};
type Props = {
  readonly initialData: DashboardWalletPageData;
};
function fmtSol(n: number | null): string {
  if (n == null || n <= 0) return "0";
  return n.toFixed(6).replace(/\.?0+$/, "");
}
function solscanAccountUrl(publicKey: string, network: string): string {
  const url = `https://solscan.io/account/${publicKey}`;
  return network === "devnet" ? `${url}?cluster=devnet` : url;
}
function solscanTxUrl(signature: string, network: string): string {
  const url = `https://solscan.io/tx/${signature}`;
  return network === "devnet" ? `${url}?cluster=devnet` : url;
}
function SolanaMark({ className }: { className?: string }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      viewBox="0 0 101 88"
      fill="none"
      aria-hidden
    >
      <path
        d="M100.48 69.38L83.81 86.8a3.2 3.2 0 0 1-2.83.89H1.94A1.32 1.32 0 0 1 .52 84.83L17.21 67.41a3.2 3.2 0 0 1 2.82-.89h79.03c.58 0 1.04.47 1.04 1.05 0 .26-.11.51-.3.7l-.32.31ZM83.81 34.3a3.2 3.2 0 0 1-2.83.89H1.94A1.32 1.32 0 0 1 .52 36.28L17.21 53.7a3.2 3.2 0 0 1 2.82.89h79.03c.58 0 1.04-.47 1.04-1.05 0-.26-.11-.51-.3-.7l-.32-.31L83.81 34.3ZM1.94 21.79h79.03a3.2 3.2 0 0 1 2.84-.89l17.19-17.42a1.32 1.32 0 0 0-.52-2.17 1.32 1.32 0 0 0-1.04 0H20.03a3.2 3.2 0 0 1-2.82.89L.52 20.48a1.32 1.32 0 0 0 .33 1.07c.3.29.7.38 1.1.24Z"
        fill="url(#wallet-sol-grad)"
      />
      <defs>
        <linearGradient
          id="wallet-sol-grad"
          x1="8.53"
          y1="90.1"
          x2="88.99"
          y2="-3.02"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset=".08" stopColor="#9945FF" />
          <stop offset=".3" stopColor="#8752F3" />
          <stop offset=".5" stopColor="#5497D5" />
          <stop offset=".6" stopColor="#43B4CA" />
          <stop offset=".72" stopColor="#28E0B9" />
          <stop offset=".97" stopColor="#19FB9B" />
        </linearGradient>
      </defs>
    </svg>
  );
}
export function DashboardWalletPage({ initialData }: Props) {
  const data = initialData;
  const rh = useRobinhoodLaunchFlow();
  const [account, setAccount] = useSourceDraft(
    `account:${data.account.profileId}:${data.account.accountWalletPublicKey ?? "none"}`,
    data.account,
  );
  const [agent, setAgent] = useSourceDraft(
    data.agent?.id ?? null,
    data.agent,
  );
  const agentId = agent?.id ?? null;
  const agentPubkey = agent?.agentWalletPublicKey ?? null;
  const [transferOpen, setTransferOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [solCopied, setSolCopied] = useTransientState(false, 1500);
  const [evmCopied, setEvmCopied] = useTransientState(false, 1500);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [rhFeeRefreshNonce, setRhFeeRefreshNonce] = useState(0);
  const [evmSendOpen, setEvmSendOpen] = useState(false);
  const [exportKeyTarget, setExportKeyTarget] = useState<"solana" | "evm" | null>(null);
  const [exportKeyValue, setExportKeyValue] = useState<string | null>(null);
  const [exportKeyVisible, setExportKeyVisible] = useState(false);
  const [exportKeyLoading, setExportKeyLoading] = useState(false);
  const [syncingAccount, setSyncingAccount] = useState(false);
  const [syncingAgent, setSyncingAgent] = useState(false);
  const [evmSyncing, setEvmSyncing] = useState(false);
  const [provisioningAccount, setProvisioningAccount] = useState(false);
  const [provisioningAgent, setProvisioningAgent] = useState(false);
  const accountRequestRef = useRef<AbortController | null>(null);
  const agentRequestRef = useRef<AbortController | null>(null);
  const evmRequestRef = useRef<AbortController | null>(null);
  const [agentTransfers, setAgentTransfers] = useSourceDraft(
    agentId != null ? `transfers:${agentId}:${agentPubkey ?? "none"}` : null,
    data.transfers,
  );
  const [evmActivity, setEvmActivity] = useSourceDraft(
    agentId != null ? `evm-activity:${agentId}` : null,
    data.evmActivity,
  );
  const [evmActivityError, setEvmActivityError] = useState(false);
  const syncAccountBalance = useCallback(async () => {
    accountRequestRef.current?.abort("account-balance-superseded");
    const controller = new AbortController();
    accountRequestRef.current = controller;
    setSyncingAccount(true);
    try {
      const response = await fetch("/api/dashboard/account/sync-balance", {
        method: "POST",
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        summary?: DashboardWalletPageData["account"];
        solBalanceLamports?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Could not refresh account balance");
      if (payload.summary) {
        setAccount(payload.summary);
      } else if (typeof payload.solBalanceLamports === "number") {
        setAccount((current) => ({
          ...current,
          solBalanceLamports: payload.solBalanceLamports ?? current.solBalanceLamports,
        }));
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        showToast(reason instanceof Error ? reason.message : "Could not refresh account balance", "error");
      }
    } finally {
      if (accountRequestRef.current === controller) {
        accountRequestRef.current = null;
        setSyncingAccount(false);
      }
    }
  }, [setAccount]);
  const refreshTransfers = useCallback(async () => {
    if (agentId == null) return;
    try {
      const response = await fetch(`/api/dashboard/agents/${agentId}/transfers`);
      if (!response.ok) return;
      const payload = (await response.json()) as { transfers?: AgentTransfer[] };
      setAgentTransfers(payload.transfers ?? []);
    } catch {
      // Transfer refresh follows an explicit send action and is best-effort.
    }
  }, [agentId, setAgentTransfers]);
  const syncAgentBalance = useCallback(async () => {
    if (agentId == null) return;
    agentRequestRef.current?.abort("agent-balance-superseded");
    const controller = new AbortController();
    agentRequestRef.current = controller;
    setSyncingAgent(true);
    try {
      const response = await fetch(`/api/dashboard/agents/${agentId}/sync-balance`, {
        method: "POST",
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        publicKey?: string;
        solBalanceLamports?: number;
        solscanUrl?: string | null;
        error?: string;
      };
      if (!response.ok || typeof payload.solBalanceLamports !== "number") {
        throw new Error(payload.error || "Could not refresh agent wallet balance");
      }
      setAgent((current) => current ? {
        ...current,
        agentWalletPublicKey: payload.publicKey ?? current.agentWalletPublicKey,
        agentWalletSolscanUrl: payload.solscanUrl ?? current.agentWalletSolscanUrl,
        solBalanceLamports: payload.solBalanceLamports ?? current.solBalanceLamports,
      } : current);
    } catch (reason) {
      if (!controller.signal.aborted) {
        showToast(reason instanceof Error ? reason.message : "Could not refresh agent balance", "error");
      }
    } finally {
      if (agentRequestRef.current === controller) {
        agentRequestRef.current = null;
        setSyncingAgent(false);
      }
    }
  }, [agentId, setAgent]);
  const evmWalletSourceKey = `${agentId ?? "none"}:${JSON.stringify(data.evmWallet ?? null)}`;
  const [evmWalletDraft, setEvmWalletDraft] = useSourceDraft(
    evmWalletSourceKey,
    data.evmWallet ?? null,
  );
  const {
    state: evmSetupState,
    error: evmSetupError,
    setupEvmWallet,
  } = useAgentEvmWalletSetup(agentId);
  const evmWallet = evmWalletDraft;
  const syncEvmBalance = useCallback(async () => {
    if (agentId == null || !evmWalletDraft?.address) return;
    evmRequestRef.current?.abort("evm-balance-superseded");
    const controller = new AbortController();
    evmRequestRef.current = controller;
    setEvmSyncing(true);
    try {
      const response = await fetch(`/api/dashboard/agents/${agentId}/evm-wallet`, {
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        configured?: boolean;
        address?: string | null;
        status?: string;
        provider?: string;
        isCustodial?: boolean;
        balances?: {
          mainnet?: { ether?: string } | null;
          robinhood?: { ether?: string } | null;
        };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Could not refresh EVM balances");
      setEvmWalletDraft((current) => current ? {
        ...current,
        configured: payload.configured ?? current.configured,
        address: payload.address ?? current.address,
        status: payload.status ?? current.status,
        provider: payload.provider ?? current.provider,
        isCustodial: payload.isCustodial ?? current.isCustodial,
        ethBalance: payload.balances?.mainnet?.ether ?? null,
        robinhoodEthBalance: payload.balances?.robinhood?.ether ?? null,
      } : current);
      setEvmActivityError(false);
      const activityResponse = await fetch(`/api/dashboard/agents/${agentId}/evm-activity`, {
        signal: controller.signal,
      });
      if (activityResponse.ok) {
        const activityPayload = (await activityResponse.json()) as { activity?: EvmActivityRow[] };
        setEvmActivity(activityPayload.activity ?? []);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setEvmActivityError(true);
        showToast(reason instanceof Error ? reason.message : "Could not refresh EVM balances", "error");
      }
    } finally {
      if (evmRequestRef.current === controller) {
        evmRequestRef.current = null;
        setEvmSyncing(false);
      }
    }
  }, [agentId, evmWalletDraft?.address, setEvmActivity, setEvmWalletDraft]);
  const provisionAccountWallet = useCallback(async () => {
    setProvisioningAccount(true);
    try {
      const response = await fetch("/api/dashboard/account/wallet/provision", { method: "POST" });
      const payload = (await response.json()) as {
        wallet?: { publicKey?: string; solscanUrl?: string; balanceSol?: number };
        error?: string;
      };
      if (!response.ok || !payload.wallet?.publicKey) {
        throw new Error(payload.error || "Could not provision account wallet");
      }
      const publicKey = payload.wallet.publicKey;
      setAccount((current) => ({
        ...current,
        accountWalletPublicKey: publicKey,
        accountWalletSource: "custodial",
        accountWalletSolscanUrl:
          payload.wallet?.solscanUrl ??
          solscanAccountUrl(publicKey, current.solanaNetwork),
        walletProvisionError: null,
      }));
      showToast("Account wallet provisioned", "success");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Could not provision account wallet", "error");
    } finally {
      setProvisioningAccount(false);
    }
  }, [setAccount]);
  const provisionAgentWallet = useCallback(async () => {
    if (agentId == null) return;
    setProvisioningAgent(true);
    try {
      const response = await fetch(`/api/dashboard/agents/${agentId}/provision-wallet`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        publicKey?: string;
        solscanUrl?: string;
        isCustodial?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.publicKey) {
        throw new Error(payload.error || "Could not provision agent wallet");
      }
      setAgent((current) => current ? {
        ...current,
        agentWalletPublicKey: payload.publicKey ?? current.agentWalletPublicKey,
        agentWalletSolscanUrl: payload.solscanUrl ?? current.agentWalletSolscanUrl,
        agentWalletIsCustodial: payload.isCustodial ?? true,
        canProvisionSolanaWallet: false,
        solanaWalletProvisionError: null,
      } : current);
      showToast("Agent wallet provisioned", "success");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Could not provision agent wallet", "error");
    } finally {
      setProvisioningAgent(false);
    }
  }, [agentId, setAgent]);
  const launchResourceKey =
    agentId != null ? `launch:${agentId}:${data.solanaNetwork}` : null;
  const launchResource = useAsyncResource(
    launchResourceKey,
    async (signal) => {
      const response = await fetch(
        `/api/agent-launch/drafts/by-agent?agentDbId=${agentId}&network=${data.solanaNetwork}`,
        { signal },
      );
      if (!response.ok) return null;
      const launch = (await response.json()) as { id?: string; launchStatus?: string };
      return launch.id && launch.launchStatus === "indexed" ? launch.id : null;
    },
    {
      initialData: data.solanaLaunchId,
      initialDataKey: launchResourceKey,
      revalidateOnMount: false,
    },
  );
  const launchId = launchResource.data ?? null;
  const feeResourceKey = launchId ? `fees:${launchId}` : null;
  const feeResource = useAsyncResource(
    feeResourceKey,
    async (signal) => {
      const response = await fetch(`/api/agent-launch/drafts/${launchId}/claimable-fees`, {
        signal,
        cache: "no-store",
      });
      const payload = (await response.json()) as FeeData & { error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to check fees");
      }
      return payload;
    },
    {
      initialData: data.solanaClaimableFees,
      initialDataKey: data.solanaClaimableFees ? feeResourceKey : null,
      revalidateOnMount: true,
    },
  );
  const feeData = feeResource.data;
  const feeCheckLoading = feeResource.loading;
  const feeError = claimError ?? feeResource.error?.message ?? null;
  const refreshFeeResource = feeResource.refresh;
  useEffect(() => {
    if (!feeResourceKey) return;
    const interval = window.setInterval(() => {
      refreshFeeResource();
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [feeResourceKey, refreshFeeResource]);
  const openExportKey = useCallback(
    async (target: "solana" | "evm") => {
      if (agentId == null) return;
      setExportKeyTarget(target);
      setExportKeyLoading(true);
      setExportKeyValue(null);
      setExportKeyVisible(false);
      try {
        const response = await fetch(
          `/api/dashboard/agents/${agentId}/export-key?chain=${target}`,
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "Failed to fetch key");
        }
        const payload = (await response.json()) as { key: string };
        setExportKeyValue(payload.key);
      } catch {
        setExportKeyValue(null);
      } finally {
        setExportKeyLoading(false);
      }
    },
    [agentId],
  );
  const resetExportKey = useCallback(() => {
    setExportKeyTarget(null);
    setExportKeyValue(null);
    setExportKeyVisible(false);
  }, []);
  function refreshFees() {
    setClaimError(null);
    setRhFeeRefreshNonce((nonce) => nonce + 1);
    feeResource.refresh();
  }
  async function claimFees(force = false) {
    if (!launchId) return;
    setClaimLoading(true);
    setClaimError(null);
    try {
      const result = await requestAgentLaunchFeeDistribution(launchId, {
        mode: force ? "recovery" : "standard",
        timeoutMs: force ? 120_000 : 45_000,
      });
      if (result.status === "failed") throw new Error(result.reason || "Distribution failed");
      if (result.timedOut) {
        feeResource.refresh();
        return;
      }
      if (result.status === "distributed") {
        feeResource.refresh();
      } else if (result.status === "skipped") {
        feeResource.setData((previous) =>
          previous
            ? { ...previous, reason: result.reason || "below threshold", canDistribute: false }
            : previous,
        );
      } else if (result.status === "queued" || result.status === "in_progress") {
        feeResource.refresh();
      }
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "Claim failed");
    } finally {
      setClaimLoading(false);
    }
  }
  function handleCopy(key: string, chain?: "sol" | "evm") {
    void navigator.clipboard.writeText(key);
    if (chain === "evm") setEvmCopied(true);
    else setSolCopied(true);
  }
  const solanaNetwork = data.solanaNetwork;
  const solPrice = data.solPrice;
  const accountSolLamports = account.solBalanceLamports;
  const canSyncAccountBalance =
    account.accountWalletSource === "custodial" ||
    account.accountWalletSource === "linked_solana";
  const canProvisionAccountWallet =
    account.accountId != null &&
    !account.accountWalletPublicKey &&
    account.walletProvisionError === "Account wallet is not provisioned yet.";
  const accountWalletExplorerUrl = account.accountWalletPublicKey
    ? account.accountWalletSource === "linked_evm"
      ? evmExplorerUrl(account.accountWalletPublicKey)
      : account.accountWalletSolscanUrl ??
        solscanAccountUrl(account.accountWalletPublicKey, solanaNetwork)
    : null;
  const agentSolLamports = agent?.solBalanceLamports ?? null;
  const agentBalanceSol = agentSolLamports
    ? agentSolLamports / 1_000_000_000
    : 0;
  const estimatedUsd =
    agentSolLamports != null && solPrice != null
      ? (() => {
          const usd = (agentSolLamports / 1_000_000_000) * solPrice;
          if (usd >= 1_000) return `$${usd.toFixed(0)}`;
          return `$${usd.toFixed(2)}`;
        })()
      : "$0.00";
  const canClaim =
    feeData?.canDistribute && feeData?.feeSharingStatus === "active";
  const accruedCreatorSol =
    feeData?.accruedCreatorSol ??
    (feeData?.claimableSol != null && feeData.agentShareBps != null
      ? (feeData.claimableSol * feeData.agentShareBps) / 10_000
      : null);
  const showForceClaim =
    Boolean(launchId) &&
    !claimLoading &&
    (accruedCreatorSol ?? 0) > 0 &&
    (!canClaim || Boolean(feeError));
  const showFeeReason =
    feeData?.reason && !feeData.canDistribute && (accruedCreatorSol ?? 0) > 0;
  return (
    <div className="ui-dashboard-overview ui-wallet-page mx-auto w-full max-w-5xl min-w-0 space-y-4 px-4 py-6 sm:px-6">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">
          {agent ? <AgentAvatar image={agent.image} name={agent.name} size="md" /> : <Bot className="h-8 w-8 text-muted-foreground" />}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {agent ? `${agent.name} wallet` : "Wallet"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {agent
                ? "On-chain wallet, funding, activity, and creator rewards."
                : "Account-level wallet, credits, and funding."}
            </p>
            {!agent ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Shared USDC funding is available from{" "}
                <Link href="/dashboard/card" className="underline underline-offset-2">
                  Card
                </Link>
                .
              </p>
            ) : null}
          </div>
        </div>
        <div className="ui-overview-metrics grid grid-cols-2 sm:grid-cols-4">
          <div className="ui-overview-metric px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Solana</p>
            <p className="mt-1 truncate text-sm font-semibold tabular-nums">
              {agent ? `${fmtSol(agentBalanceSol)} SOL` : accountSolLamports != null ? `${fmtSol(accountSolLamports / 1_000_000_000)} SOL` : "—"}
            </p>
          </div>
          <div className="ui-overview-metric px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">EVM</p>
            <p className="mt-1 truncate text-sm font-semibold">
              {evmWallet?.configured ? "Ready" : "Not set up"}
            </p>
          </div>
          <div className="ui-overview-metric px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Estimated value</p>
            <p className="mt-1 truncate text-sm font-semibold tabular-nums">{agent ? estimatedUsd : "—"}</p>
          </div>
          <div className="ui-overview-metric px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">LLM balance</p>
            <p className="mt-1 truncate text-sm font-semibold tabular-nums">${(account.totalBalance / 100).toFixed(2)}</p>
          </div>
        </div>
      </div>
      {/* CREATOR REWARDS */}
      {/* AGENT WALLET BALANCE PANEL */}
      {agent && (
        <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">Wallet activity</h2>
          </div>
          <div className="space-y-4 px-5 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <AgentAvatar image={agent.image} name={agent.name} size="md" />
              <div>
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Agent Wallet
                </p>
                <p className="text-2xl font-semibold tabular-nums">
                  {estimatedUsd}
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={syncingAgent || !agentPubkey}
              onClick={() => void syncAgentBalance()}
            >
              {syncingAgent ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Refresh balance
            </Button>
          </div>
          {/* Activity */}
          {agentTransfers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
              <p className="text-muted-foreground text-sm font-medium">
                No transaction history yet
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                On-chain activity will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {agentTransfers.map((tx) => {
                const isOutbound = tx.fromPublicKey === agentPubkey;
                const amount = Number(tx.amountLamports) / 1_000_000_000;
                const isConfirmed = tx.status === "confirmed";
                const isFailed = tx.status === "failed";
                return (
                  <div
                    key={tx.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/30 px-4 py-2.5 text-xs"
                  >
                    <span
                      className={`font-bold text-xs w-4 text-right tabular-nums ${isOutbound ? "text-red-400" : "text-green-400"}`}
                    >
                      {isOutbound ? "−" : "+"}
                    </span>
                    <span className="tabular-nums font-mono text-foreground/90">
                      {amount.toFixed(4)} {tx.token}
                    </span>
                    <span className="text-muted-foreground">
                      {isOutbound
                        ? `→ ${tx.toPublicKey.slice(0, 4)}…${tx.toPublicKey.slice(-4)}`
                        : `← ${tx.fromPublicKey.slice(0, 4)}…${tx.fromPublicKey.slice(-4)}`}
                    </span>
                    <span
                      className={`ml-auto shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${isConfirmed ? "bg-green-500/10 text-green-400" : isFailed ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}
                    >
                      {isConfirmed
                        ? "Confirmed"
                        : isFailed
                          ? "Failed"
                          : "Pending"}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </span>
                    {tx.signature ? (
                      <a
                        href={solscanTxUrl(tx.signature, solanaNetwork)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        <span>Solscan</span>
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </div>
      )}
      {/* AGENT WALLET ADDRESS */}
      {agent && !agentPubkey && (
        <div className="ui-overview-panel rounded-xl p-5 space-y-3">
          <div className="ui-overview-panel-header -mx-5 -mt-5 flex items-center gap-2 px-5 py-4">
            <SolanaMark className="h-4 w-4" />
            <h2 className="text-sm font-semibold">Solana wallet</h2>
            <Badge variant="outline" className="font-normal text-xs">
              Not provisioned
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Provisioning is an explicit action. No wallet is created merely by opening this page.
          </p>
          {agent.solanaWalletProvisionError ? (
            <p className="text-destructive text-xs">{agent.solanaWalletProvisionError}</p>
          ) : null}
          {agent.canProvisionSolanaWallet ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={provisioningAgent}
              onClick={() => void provisionAgentWallet()}
            >
              {provisioningAgent ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-2 h-3.5 w-3.5" />
              )}
              Provision Solana wallet
            </Button>
          ) : null}
        </div>
      )}
      {agent && agentPubkey && (
        <div className="ui-overview-panel rounded-xl p-5 space-y-3">
          <div className="ui-overview-panel-header -mx-5 -mt-5 flex items-center gap-2 px-5 py-4">
            <SolanaMark className="h-4 w-4" />
            <h2 className="text-sm font-semibold">Solana wallet</h2>
            {agent.agentWalletIsCustodial && (
              <Badge variant="outline" className="font-normal text-xs">
                Sol
              </Badge>
            )}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-border/60 p-3">
            <span className="font-mono text-sm min-w-0 truncate">
              {agentPubkey}
            </span>
            <div className="flex shrink-0 gap-1 self-end sm:self-auto">
              <Button
                size="sm"
                variant="ghost"
                disabled={syncingAgent || !agentPubkey}
                onClick={() => void syncAgentBalance()}
                title="Refresh SOL balance"
              >
                {syncingAgent ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(agentPubkey, "sol")}
              >
                {solCopied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a
                  href={agent.agentWalletSolscanUrl ?? solscanAccountUrl(agentPubkey, solanaNetwork)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!agentPubkey || agentBalanceSol <= 0}
                onClick={() => setTransferOpen(true)}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
              {agent.agentWalletIsCustodial && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void openExportKey("solana")}
                  title="Export private key"
                >
                  <Key className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-muted-foreground text-xs">SOL</p>
              <p className="font-semibold tabular-nums">
                {agentBalanceSol.toFixed(6).replace(/\.?0+$/, "")}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-muted-foreground text-xs">Estimated USD</p>
              <p className="font-semibold tabular-nums">
                {(() => {
                  if (agentSolLamports != null && solPrice != null) {
                    const val = (agentSolLamports / 1_000_000_000) * solPrice;
                    if (Number.isFinite(val))
                      return val >= 1_000
                        ? `$${val.toFixed(0)}`
                        : `$${val.toFixed(2)}`;
                  }
                  return "—";
                })()}
              </p>
            </div>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            This wallet belongs to the selected agent. It is used for token
            launches, creator fees, and agent-owned funds.
          </p>
        </div>
      )}
      {/* EVM WALLET CARD */}
      {agent && (
        <div className="ui-overview-panel rounded-xl p-5 space-y-3">
          <div className="ui-overview-panel-header -mx-5 -mt-5 flex items-center gap-2 px-5 py-4">
            <EthereumIcon className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">EVM wallet</h2>
            {evmWallet?.configured && (
              <Badge variant="outline" className="font-normal text-xs">
                {evmWallet.isCustodial || evmWallet.provider === "custodial"
                  ? "Custodial"
                  : "Privy"}
              </Badge>
            )}
          </div>
          {evmWallet?.configured && evmWallet.address ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-border/60 p-3">
                <span className="font-mono text-sm min-w-0 truncate">
                  {evmWallet.address}
                </span>
                <div className="flex shrink-0 gap-1 self-end sm:self-auto">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={evmSyncing}
                    onClick={() => void syncEvmBalance()}
                    title="Refresh ETH balance"
                  >
                    {evmSyncing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(evmWallet.address!);
                      setEvmCopied(true);
                    }}
                  >
                    {evmCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <a
                      href={evmExplorerUrl(evmWallet.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Etherscan"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <a
                      href={robinhoodChainExplorerUrl(evmWallet.address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Robinhood Chain explorer"
                    >
                      <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEvmSendOpen(true)}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                  {(evmWallet.isCustodial ||
                    evmWallet.provider === "custodial") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void openExportKey("evm")}
                      title="Export private key"
                    >
                      <Key className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="text-muted-foreground flex items-center gap-1 text-xs">
                    <EthereumIcon className="h-3 w-3" />
                    Ethereum mainnet
                  </p>
                  <p className="font-semibold tabular-nums">
                    {formatEthCompact(evmWallet.ethBalance)} ETH
                  </p>
                  <p className="text-muted-foreground mt-1 text-[11px] tabular-nums">
                    {(() => {
                      const eth = evmWallet.ethBalance;
                      const price = evmWallet.ethPrice;
                      if (eth && price != null) {
                        const val = Number.parseFloat(eth) * price;
                        if (Number.isFinite(val) && val > 0) {
                          return val >= 1_000
                            ? `~$${val.toFixed(0)}`
                            : `~$${val.toFixed(2)}`;
                        }
                      }
                      return "—";
                    })()}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="text-muted-foreground text-xs flex items-center gap-1">
                    <RobinhoodChainIcon className="h-3 w-3" />
                    Robinhood Chain
                  </p>
                  <p className="font-semibold tabular-nums">
                    {formatEthCompact(evmWallet.robinhoodEthBalance)} ETH
                  </p>
                  <p className="text-muted-foreground mt-1 text-[11px] tabular-nums">
                    {(() => {
                      const eth = evmWallet.robinhoodEthBalance;
                      const price = evmWallet.ethPrice;
                      if (eth && price != null) {
                        const val = Number.parseFloat(eth) * price;
                        if (Number.isFinite(val) && val > 0) {
                          return val >= 1_000
                            ? `~$${val.toFixed(0)}`
                            : `~$${val.toFixed(2)}`;
                        }
                      }
                      return "—";
                    })()}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-muted-foreground text-xs">
                  Total estimated USD
                </p>
                <p className="font-semibold tabular-nums">
                  {(() => {
                    const mainnetEth = evmWallet.ethBalance;
                    const rhEth = evmWallet.robinhoodEthBalance;
                    const price = evmWallet.ethPrice;
                    if (price != null) {
                      const main = mainnetEth
                        ? Number.parseFloat(mainnetEth)
                        : 0;
                      const rh = rhEth ? Number.parseFloat(rhEth) : 0;
                      const val =
                        (Number.isFinite(main) ? main : 0) * price +
                        (Number.isFinite(rh) ? rh : 0) * price;
                      if (Number.isFinite(val) && val > 0) {
                        return val >= 1_000
                          ? `$${val.toFixed(0)}`
                          : `$${val.toFixed(2)}`;
                      }
                    }
                    return "—";
                  })()}
                </p>
                <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                  Launch gas spends Robinhood Chain ETH. Bridge from mainnet if
                  needed.
                </p>
              </div>
              {/* EVM activity */}
              {evmActivityError ? (
                <div className="rounded-lg border border-border/30 px-4 py-3">
                  <p className="text-muted-foreground text-xs">
                    EVM activity could not be refreshed.
                  </p>
                </div>
              ) : evmActivity.length > 0 ? (
                <div className="space-y-2">
                  {evmActivity.map((row) => {
                    const tokenLabel = row.tokenSymbol
                      ? `$${row.tokenSymbol}`
                      : shortenEvmAddress(row.tokenAddress);
                    const dateLabel = new Date(
                      row.blockTimestamp,
                    ).toLocaleDateString();
                    return (
                      <div
                        key={row.id}
                        className="flex flex-col rounded-lg border border-border/30 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1 text-xs">
                            <span className="font-medium">Launched</span>
                            <span className="tabular-nums font-mono text-foreground/90">
                              {tokenLabel}
                            </span>
                            <span className="text-muted-foreground">
                              &rarr;
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground truncate">
                              {shortenEvmAddress(row.tokenAddress)}
                            </span>
                          </p>
                          {row.tokenName && (
                            <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
                              {row.tokenName}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-0.5">
                          <span className="text-green-400 text-[10px] font-medium">
                            Confirmed
                          </span>
                          <span className="text-muted-foreground text-[10px]">
                            {dateLabel}
                          </span>
                          <a
                            href={robinhoodChainExplorerTxUrl(row.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[10px]"
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            <span>Tx</span>
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <p className="text-muted-foreground text-xs leading-relaxed">
                Used for launches, ETH gas, creator fees and activity across
                supported networks. Secure embedded wallet infrastructure
                provided by Privy.
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <Badge variant="outline" className="font-normal text-xs">
                Not set up
              </Badge>
              <p className="text-muted-foreground text-sm">
                Used for launches, ETH gas, creator fees and activity across
                supported networks.
              </p>
              {evmSetupError ? (
                <p className="text-destructive text-xs">{evmSetupError}</p>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={
                  evmSetupState === "creating" || evmSetupState === "persisting"
                }
                onClick={async () => {
                  const result = await setupEvmWallet();
                  if (result) {
                    // Use the returned result directly — no need to refetch
                    setEvmWalletDraft({
                      configured: true,
                      address: result.address,
                      status: "active",
                      provider: result.provider,
                      isCustodial: result.isCustodial,
                      ethBalance: null,
                      robinhoodEthBalance: null,
                      ethPrice: data.ethPrice,
                    });
                  }
                }}
              >
                {evmSetupState === "creating" ||
                evmSetupState === "persisting" ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />{" "}
                    Creating EVM wallet…
                  </>
                ) : (
                  <>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Set up EVM wallet
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
      {/* CREATOR REWARDS */}
      {agent && (
        <div className="ui-overview-panel rounded-xl p-5 space-y-3">
          <div className="ui-overview-panel-header -mx-5 -mt-5 flex items-center justify-between px-5 py-4">
            <h2 className="text-sm font-semibold">Creator rewards</h2>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void refreshFees()}
              disabled={feeCheckLoading}
            >
              <RefreshCw
                className={cn(
                  "mr-1 h-3.5 w-3.5",
                  feeCheckLoading && "animate-spin",
                )}
              />
              {feeCheckLoading ? "Checking…" : "Refresh"}
            </Button>
          </div>
          {feeError && <p className="text-destructive text-xs">{feeError}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* ── Solana rewards ── */}
            <div className="rounded-lg border border-border/60 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <SolanaMark className="h-4 w-4 shrink-0" />
                <span className="text-xs font-semibold text-foreground">
                  Solana
                </span>
              </div>
              {feeData ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      Lifetime rewards
                    </span>
                    <span className="tabular-nums text-sm font-medium">
                      {feeData.earnedCreatorSol != null
                        ? `${fmtSol(feeData.earnedCreatorSol)} SOL`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      Claimed
                    </span>
                    <span className="tabular-nums text-sm font-medium">
                      {feeData.totalDistributedSol != null
                        ? `${fmtSol(feeData.totalDistributedSol)} SOL`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1.5">
                    <span className="text-muted-foreground text-xs">
                      Claimable now
                    </span>
                    <span className="tabular-nums text-sm font-semibold text-foreground">
                      {accruedCreatorSol != null && accruedCreatorSol > 0
                        ? `${fmtSol(accruedCreatorSol)} SOL`
                        : "0 SOL"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Est. USD</span>
                    <span className="tabular-nums">
                      {accruedCreatorSol != null &&
                      solPrice != null &&
                      accruedCreatorSol > 0
                        ? (() => {
                            const val = accruedCreatorSol * solPrice;
                            return val >= 1_000
                              ? `~$${val.toFixed(0)}`
                              : `~$${val.toFixed(2)}`;
                          })()
                        : "—"}
                    </span>
                  </div>
                  {canClaim && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full mt-1"
                      disabled={claimLoading}
                      onClick={() => void claimFees(false)}
                    >
                      {claimLoading ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{" "}
                          Claiming…
                        </>
                      ) : (
                        "Claim"
                      )}
                    </Button>
                  )}
                  {showForceClaim ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full mt-1"
                      disabled={claimLoading}
                      onClick={() => void claimFees(true)}
                    >
                      {claimLoading ? "Submitting…" : "Force claim"}
                    </Button>
                  ) : null}
                  {showFeeReason && (
                    <p className="text-muted-foreground text-[10px]">
                      {feeData!.reason}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            {/* ── Robinhood rewards ── */}
            <div className="rounded-lg border border-border/60 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <RobinhoodChainIcon className="h-4 w-4 shrink-0" />
                <span className="text-xs font-semibold text-foreground">
                  Robinhood
                </span>
              </div>
              {evmWallet?.configured && data.robinhoodLaunch && agent ? (
                <RobinhoodFeeClaimPanel
                  compact
                  agentDbId={agent.id}
                  launch={data.robinhoodLaunch}
                  evmAddress={evmWallet.address}
                  onRobinhoodChain={rh.onRobinhoodChain}
                  switchToRobinhood={rh.switchToRobinhood}
                  initialData={data.robinhoodClaimableFees}
                  custodial={Boolean(
                    evmWallet.isCustodial || evmWallet.provider === "custodial",
                  )}
                  refreshNonce={rhFeeRefreshNonce}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
      {/* ACCOUNT WALLET */}
      <div className="ui-overview-panel rounded-xl p-5 space-y-3">
        <div className="ui-overview-panel-header -mx-5 -mt-5 flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            LLM Wallet
          </h2>
          {account.accountWalletPublicKey && canSyncAccountBalance ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={syncingAccount}
              onClick={() => void syncAccountBalance()}
            >
              {syncingAccount ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Sync balance
            </Button>
          ) : !account.accountWalletPublicKey ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={provisioningAccount || !canProvisionAccountWallet}
              onClick={() => void provisionAccountWallet()}
            >
              {provisioningAccount ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-2 h-3.5 w-3.5" />
              )}
              Provision wallet
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          Used for account-level funding and balance.
        </p>
        {!account.accountWalletPublicKey && account.walletProvisionError ? (
          <p className="text-destructive text-xs">{account.walletProvisionError}</p>
        ) : null}
        {account.accountWalletPublicKey && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-border/60 p-3">
            <span className="font-mono text-sm min-w-0 truncate">
              {account.accountWalletPublicKey}
            </span>
            <div className="flex shrink-0 gap-1 self-end sm:self-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(account.accountWalletPublicKey!)}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a
                  href={accountWalletExplorerUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-muted-foreground text-xs">
              Account SOL ({solanaNetwork})
            </p>
            <p className="font-semibold tabular-nums">
              {accountSolLamports != null
                ? (accountSolLamports / 1_000_000_000)
                    .toFixed(6)
                    .replace(/\.?0+$/, "")
                : "—"}{" "}
              SOL
            </p>
          </div>
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-muted-foreground text-xs">Wallet status</p>
            <p className="font-medium capitalize text-sm">
              {account.accountWalletSource === "custodial"
                ? "Custodial · encrypted"
                : account.accountWalletSource.replace(/_/g, " ")}
            </p>
          </div>
        </div>
      </div>
      {/* LLM BALANCE */}
      <div className="ui-overview-panel rounded-xl p-5 space-y-3">
        <div className="ui-overview-panel-header -mx-5 -mt-5 px-5 py-4">
          <h2 className="text-sm font-semibold">LLM Balance</h2>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-border/60 p-4">
          <Sparkles className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-muted-foreground text-xs">Available balance</p>
            <p className="text-2xl font-semibold tabular-nums">
              ${(account.totalBalance / 100).toFixed(2)}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Platform {account.platformCredits.toLocaleString()} · LLM $
              {(account.llmBalanceCents / 100).toFixed(2)}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setTopUpOpen(true)}
        >
          Add funds
        </Button>
      </div>
      {/* BACK LINK */}
      {agent && (
        <p className="text-muted-foreground text-center text-xs">
          <Link
            href={`/dashboard/agents/${agent.id}`}
            className="text-foreground underline-offset-2 hover:underline"
          >
            Back to overview
          </Link>
        </p>
      )}
      {/* TRANSFER MODAL */}
      {agent && agentPubkey && (
        <DashboardWalletTransferModal
          agentDbId={agent.id}
          agentName={agent.name}
          agentWalletPublicKey={agentPubkey}
          balanceSol={agentBalanceSol}
          solscanUrl={agent.agentWalletSolscanUrl}
          network={solanaNetwork}
          open={transferOpen}
          onClose={() => setTransferOpen(false)}
          onSent={() => {
            void syncAgentBalance();
            void refreshTransfers();
          }}
        />
      )}
      <LlmCreditTopUpDialog
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        onSettled={() => {
          void syncAccountBalance();
        }}
      />
      {/* EVM SEND MODAL */}
      {agent && evmWallet?.configured && evmWallet.address && (
        <DashboardEvmSendModal
          agentDbId={agent.id}
          evmAddress={evmWallet.address}
          mainnetBalanceEth={evmWallet.ethBalance}
          robinhoodBalanceEth={evmWallet.robinhoodEthBalance}
          custodial={Boolean(
            evmWallet.isCustodial || evmWallet.provider === "custodial",
          )}
          open={evmSendOpen}
          onClose={() => setEvmSendOpen(false)}
          onSent={() => {
            showToast("ETH sent successfully");
            void syncEvmBalance();
          }}
        />
      )}
      {/* EXPORT PRIVATE KEY MODAL */}
      {exportKeyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="ui-overview-panel w-full max-w-md overflow-hidden rounded-xl p-0 shadow-2xl">
            <div className="ui-overview-panel-header flex items-center justify-between px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Export private key</h2>
                <p className="text-muted-foreground text-xs">
                  {exportKeyTarget === "solana"
                    ? "Solana wallet"
                    : "EVM wallet"}
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={resetExportKey}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="text-amber-600 dark:text-amber-400 text-xs font-medium leading-relaxed">
                  Never share your private key. Anyone with this key can control
                  your wallet and funds. AgentRanking is not responsible for
                  lost or stolen keys.
                </p>
              </div>
              {exportKeyLoading ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
                  <p className="text-sm">Retrieving key…</p>
                </div>
              ) : exportKeyValue ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="min-w-0 break-all font-mono text-xs text-foreground/90">
                        {exportKeyVisible
                          ? exportKeyValue
                          : "•".repeat(exportKeyTarget === "evm" ? 66 : 64)}
                      </p>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                        onClick={() => setExportKeyVisible((v) => !v)}
                        aria-label={exportKeyVisible ? "Hide key" : "Show key"}
                      >
                        {exportKeyVisible ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                        onClick={() => {
                          void navigator.clipboard.writeText(exportKeyValue);
                          showToast("Key copied to clipboard");
                          setTimeout(() => resetExportKey(), 1500);
                        }}
                        aria-label="Copy key"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-destructive text-sm">
                  {exportKeyTarget === "evm"
                    ? "Failed to retrieve EVM key. This wallet may not be custodial."
                    : "Failed to retrieve key. Please try again."}
                </p>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                onClick={resetExportKey}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
