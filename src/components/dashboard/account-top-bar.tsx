"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { OPEN_AGENT_WALLET_EVENT } from "@/lib/dashboard/agent-wallet-ui";
import { useTransientState } from "@/hooks/use-transient-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Bot,
  Menu,
  Loader2,
  Plus,
  Wallet,
} from "lucide-react";
import type { AppAccountSummary } from "@/lib/app-account-summary";
import type { DashboardAgentSummary } from "@/lib/dashboard/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { RegisteredTick } from "@/components/shared/registered-badge";
import { isDashboardAgentVerified } from "@/lib/dashboard/agent-verification-display";
import { isDashboardAgentSolanaRegistered } from "@/lib/dashboard/agent-registration-display";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { formatCompact, formatSol } from "@/lib/solana-format";
import { formatEthCompact, evmExplorerUrl, robinhoodChainExplorerUrl } from "@/lib/evm-wallet-utils";
import { EthereumIcon } from "@/components/shared/ethereum-icon";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import { useAgentEvmWalletSetup, type EvmSetupState } from "@/lib/use-agent-evm-wallet-setup";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { useAsyncResource } from "@/hooks/use-async-resource";
import type { AgentWalletSummary } from "@/lib/agent-wallet-summary.server";

const LlmCreditTopUpDialog = dynamic(
  () =>
    import("@/components/dashboard/llm-credit-top-up-dialog").then(
      (module) => module.LlmCreditTopUpDialog,
    ),
  { ssr: false },
);
import { useStoredAgentId } from "@/hooks/use-stored-agent-id";
import { resolveActiveAgentDbId } from "@/lib/dashboard/active-agent";
import { parseDashboardAgentDbIdFromPath } from "@/lib/dashboard/navigation";
const llmBalanceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function formatSplBalance(raw: string, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  if (n >= 1_000) return formatCompact(n);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals > 2 ? 4 : decimals,
  });
}
/* ─── Inline token icons ───────────────────────────────────────────── */
function SolanaIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("shrink-0", className)} width="14" height="14" viewBox="0 0 101 88" fill="none" aria-hidden>
      <path d="M100.48 69.38L83.81 86.8a3.2 3.2 0 0 1-2.83.89H1.94A1.32 1.32 0 0 1 .52 84.83L17.21 67.41a3.2 3.2 0 0 1 2.82-.89h79.03c.58 0 1.04.47 1.04 1.05 0 .26-.11.51-.3.7l-.32.31ZM83.81 34.3a3.2 3.2 0 0 1-2.83.89H1.94A1.32 1.32 0 0 1 .52 36.28L17.21 53.7a3.2 3.2 0 0 1 2.82.89h79.03c.58 0 1.04-.47 1.04-1.05 0-.26-.11-.51-.3-.7l-.32-.31L83.81 34.3ZM1.94 21.79h79.03a3.2 3.2 0 0 1 2.84-.89l17.19-17.42a1.32 1.32 0 0 0-.52-2.17 1.32 1.32 0 0 0-1.04 0H20.03a3.2 3.2 0 0 1-2.82.89L.52 20.48a1.32 1.32 0 0 0 .33 1.07c.3.29.7.38 1.1.24Z" fill="url(#sol-grad)" />
      <defs><linearGradient id="sol-grad" x1="8.53" y1="90.1" x2="88.99" y2="-3.02" gradientUnits="userSpaceOnUse"><stop offset=".08" stopColor="#9945FF" /><stop offset=".3" stopColor="#8752F3" /><stop offset=".5" stopColor="#5497D5" /><stop offset=".6" stopColor="#43B4CA" /><stop offset=".72" stopColor="#28E0B9" /><stop offset=".97" stopColor="#19FB9B" /></linearGradient></defs>
    </svg>
  );
}
function UsdcIcon({ className }: { className?: string }) {
  return <RuntimeImage src="/chain-assets/usdc.webp" alt="USDC" aria-hidden className={cn("shrink-0 object-contain", className)} />;
}
function ArIcon({ className }: { className?: string }) {
  return <RuntimeImage src="/chain-assets/agentranking.png" alt="AR" aria-hidden className={cn("shrink-0 object-contain", className)} />;
}
/* ─── EVM wallet state sub-component ────────────────────────────────── */
function EvmWalletSection({
  evmConfigured,
  evmAddress,
  evmMainnetBalance,
  evmRobinhoodBalance,
  evmBalanceLoading,
  evmRefreshSpinning,
  evmSetupState,
  evmSetupError,
  onSetup,
  onRefresh,
}: {
  evmConfigured: boolean;
  evmAddress: string | null;
  evmMainnetBalance: string | null;
  evmRobinhoodBalance: string | null;
  evmBalanceLoading: boolean;
  evmRefreshSpinning: boolean;
  evmSetupState: EvmSetupState;
  evmSetupError: string | null;
  onSetup: () => void;
  onRefresh: () => void;
}) {
  const [copiedEvm, setCopiedEvm] = useTransientState(false, 1500);
  const copyEvm = useCallback(async () => {
    if (!evmAddress) return;
    try {
      await navigator.clipboard.writeText(evmAddress);
      setCopiedEvm(true);
    } catch { /* ignore */ }
  }, [evmAddress, setCopiedEvm]);
  if (!evmConfigured) {
    const isCreating = evmSetupState === "creating" || evmSetupState === "persisting";
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">Not set up</p>
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          Create an EVM wallet for launches, creator fees and activity across supported networks.
        </p>
        {evmSetupError ? <p className="text-destructive text-xs">{evmSetupError}</p> : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={isCreating}
          onClick={onSetup}
        >
          {isCreating ? (
            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Creating EVM wallet…</>
          ) : (
            <><Plus className="mr-1.5 h-3.5 w-3.5" /> Set up EVM wallet</>
          )}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="flex min-w-0 items-center gap-1.5">
          <EthereumIcon className="h-4 w-4 shrink-0" />
          <span className="text-muted-foreground truncate">Ethereum mainnet</span>
          {evmAddress ? (
            <a
              href={evmExplorerUrl(evmAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground/70 hover:text-foreground shrink-0 transition-colors"
              aria-label="View on Etherscan"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">
          {evmBalanceLoading ? "…" : formatEthCompact(evmMainnetBalance)} ETH
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="flex min-w-0 items-center gap-1.5">
          <RobinhoodChainIcon className="h-4 w-4 shrink-0" />
          <span className="text-muted-foreground truncate">Robinhood</span>
          {evmAddress ? (
            <a
              href={robinhoodChainExplorerUrl(evmAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground/70 hover:text-foreground shrink-0 transition-colors"
              aria-label="View on Robinhood Chain explorer"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">
          {evmBalanceLoading ? "…" : formatEthCompact(evmRobinhoodBalance)} ETH
        </span>
      </div>
      {evmAddress ? (
        <div className="pb-2">
          <div className="mt-0.5 flex items-center gap-1">
            <p className="text-muted-foreground text-[10px]">Address</p>
          </div>
          <p className="break-all font-mono text-[11px] leading-tight">{evmAddress}</p>
          <div className="mt-1 flex items-center gap-0.5">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onRefresh}
              disabled={evmRefreshSpinning}
              aria-label="Refresh EVM balance"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${evmRefreshSpinning ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={copyEvm}
              aria-label="Copy EVM address"
            >
              {copiedEvm ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
/* ─── Main component ────────────────────────────────────────────────── */
export function DashboardAccountTopBar({ initialSummary, ownedAgents, selectedAgentDbId, accountIsVerified, solPrice, ethPrice, onMobileMenuClick }: {
  readonly initialSummary: AppAccountSummary;
  readonly ownedAgents: DashboardAgentSummary[];
  readonly selectedAgentDbId: number | null;
  readonly accountIsVerified: boolean;
  readonly solPrice: number | null;
  readonly ethPrice: number | null;
  readonly onMobileMenuClick?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const pathAgentId = parseDashboardAgentDbIdFromPath(pathname);
  const storedAgentId = useStoredAgentId(ownedAgents);
  const activeAgentId = useMemo(
    () =>
      resolveActiveAgentDbId({
        pathAgentId,
        storedAgentId,
        selectedAgentDbId,
      }),
    [pathAgentId, storedAgentId, selectedAgentDbId],
  );
  const selectedAgent = useMemo(
    () => ownedAgents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, ownedAgents],
  );
  const summary = initialSummary;
  const [agentWalletOpen, setAgentWalletOpen] = useState(false);
  const [copiedAgent, setCopiedAgent] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const llmBalanceResourceKey = "account-top-bar-llm-balance";
  const loadLlmBalance = useCallback(async (signal: AbortSignal) => {
    const response = await fetch("/api/dashboard/credits/llm/balance", { signal });
    const payload = (await response.json().catch(() => ({}))) as {
      availableCents?: number;
    };
    if (!response.ok || typeof payload.availableCents !== "number") {
      throw new Error("Balance unavailable");
    }
    return payload.availableCents;
  }, []);
  const llmBalanceResource = useAsyncResource(
    llmBalanceResourceKey,
    loadLlmBalance,
    {
      initialData: summary.llmBalanceCents ?? summary.totalBalance,
      initialDataKey: llmBalanceResourceKey,
      revalidateOnMount: true,
    },
  );
  const llmBalanceCents =
    llmBalanceResource.data ?? summary.llmBalanceCents ?? summary.totalBalance;
  const llmBalanceLoading = llmBalanceResource.loading;
  const llmBalanceError = llmBalanceResource.error != null;
  const refetchLlmBalance = llmBalanceResource.refresh;
  const llmBalanceLabel = llmBalanceFormatter.format(llmBalanceCents / 100);
  type AgentWalletSnapshot = {
    readonly walletPublicKey: string | null;
    readonly solLamports: number | null;
    readonly usdcBalance: string;
    readonly arBalance: string;
    readonly evmConfigured: boolean;
    readonly evmAddress: string | null;
    readonly evmMainnetBalance: string | null;
    readonly evmRobinhoodBalance: string | null;
  };
  const selectedAgentId = selectedAgent?.id ?? null;
  const loadWalletSnapshot = useCallback(async (signal: AbortSignal): Promise<AgentWalletSnapshot | null> => {
    if (selectedAgentId == null) return null;
    const response = await fetch(`/api/dashboard/agents/${selectedAgentId}/wallets/summary`, { signal });
    if (!response.ok) return null;
    const summary = (await response.json()) as AgentWalletSummary;
    if (summary.agentId !== selectedAgentId) return null;
    const solLamportsRaw = summary.solana.balances.nativeRaw;
    const solLamports =
      solLamportsRaw != null && /^\d+$/.test(solLamportsRaw)
        ? Number(solLamportsRaw)
        : null;
    return {
      walletPublicKey: summary.solana.address,
      solLamports,
      usdcBalance: summary.solana.balances.usdc,
      arBalance: summary.solana.balances.ar,
      evmConfigured: summary.evm.configured,
      evmAddress: summary.evm.address,
      evmMainnetBalance: summary.evm.mainnet.balances.nativeDisplay,
      evmRobinhoodBalance: summary.evm.robinhood.balances.nativeDisplay,
    };
  }, [selectedAgentId]);
  const walletSnapshotResource = useAsyncResource(
    selectedAgentId != null ? `account-top-bar-wallet:${selectedAgentId}` : null,
    loadWalletSnapshot,
  );
  const walletSnapshot = walletSnapshotResource.data;
  const refreshWalletSnapshot = walletSnapshotResource.refresh;
  const walletSnapshotLoading = walletSnapshotResource.loading;
  const walletSourceKey = `${selectedAgentId ?? "none"}:${JSON.stringify(walletSnapshot)}`;
  // Solana state
  const [agentSolLamports, setAgentSolLamports] = useSourceDraft<number | null>(
    walletSourceKey,
    walletSnapshot?.solLamports ?? null,
  );
  const [agentUsdcBalance, setAgentUsdcBalance] = useSourceDraft(
    walletSourceKey,
    walletSnapshot?.usdcBalance ?? "0",
  );
  const [agentArBalance, setAgentArBalance] = useSourceDraft(
    walletSourceKey,
    walletSnapshot?.arBalance ?? "0",
  );
  const [agentWalletPubkey] = useSourceDraft<string | null>(
    walletSourceKey,
    walletSnapshot?.walletPublicKey ?? null,
  );
  const [solRefreshSpinning, setSolRefreshSpinning] = useState(false);
  // EVM state
  const [evmConfigured, setEvmConfigured] = useSourceDraft(
    walletSourceKey,
    walletSnapshot?.evmConfigured ?? false,
  );
  const [evmAddress, setEvmAddress] = useSourceDraft<string | null>(
    walletSourceKey,
    walletSnapshot?.evmAddress ?? null,
  );
  const [evmMainnetBalance, setEvmMainnetBalance] = useSourceDraft<string | null>(
    walletSourceKey,
    walletSnapshot?.evmMainnetBalance ?? null,
  );
  const [evmRobinhoodBalance, setEvmRobinhoodBalance] = useSourceDraft<string | null>(
    walletSourceKey,
    walletSnapshot?.evmRobinhoodBalance ?? null,
  );
  const [evmRefreshSpinning, setEvmRefreshSpinning] = useState(false);
  const solSyncInFlightRef = useRef(false);
  // Privy setup hook
  const { state: evmSetupState, error: evmSetupError, setupEvmWallet } =
    useAgentEvmWalletSetup(selectedAgentId);
  const isVerified = selectedAgent
    ? isDashboardAgentVerified(selectedAgent, accountIsVerified)
    : false;
  const isSolanaRegistered = selectedAgent
    ? isDashboardAgentSolanaRegistered(selectedAgent)
    : false;
  const syncAgentBalance = useCallback(async (userInitiated = false) => {
    const agentId = selectedAgent?.id;
    if (agentId == null) return;
    if (solSyncInFlightRef.current && !userInitiated) return;
    solSyncInFlightRef.current = true;
    // Keep amount "…" on first load; only spin the button when the user clicks refresh.
    if (userInitiated) setSolRefreshSpinning(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentId}/sync-balance`, { method: "POST" });
      const payload = (await res.json()) as {
        solBalanceLamports?: number; usdcBalanceRaw?: string | null; arBalanceRaw?: string | null;
      };
      if (res.ok) {
        if (typeof payload.solBalanceLamports === "number") setAgentSolLamports(payload.solBalanceLamports);
        if (payload.usdcBalanceRaw != null) setAgentUsdcBalance(formatSplBalance(payload.usdcBalanceRaw, 6));
        if (payload.arBalanceRaw != null) setAgentArBalance(formatSplBalance(payload.arBalanceRaw, 6));
      }
      if (userInitiated) {
        void refreshWalletSnapshot();
      }
    } finally {
      solSyncInFlightRef.current = false;
      setSolRefreshSpinning(false);
    }
  }, [selectedAgent?.id, setAgentArBalance, setAgentSolLamports, setAgentUsdcBalance, refreshWalletSnapshot]);
  const refreshEvmWallet = useCallback(async () => {
    setEvmRefreshSpinning(true);
    try {
      refreshWalletSnapshot();
    } finally {
      setEvmRefreshSpinning(false);
    }
  }, [refreshWalletSnapshot]);
  const handleAgentWalletOpenChange = useCallback((open: boolean) => {
    setAgentWalletOpen(open);
  }, []);
  useEffect(() => {
    if (selectedAgentId == null) return;
    const interval = window.setInterval(() => {
      void refreshWalletSnapshot();
      void refetchLlmBalance();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [selectedAgentId, refreshWalletSnapshot, refetchLlmBalance]);
  useEffect(() => {
    const openWallet = () => handleAgentWalletOpenChange(true);
    window.addEventListener(OPEN_AGENT_WALLET_EVENT, openWallet);
    return () => window.removeEventListener(OPEN_AGENT_WALLET_EVENT, openWallet);
  }, [handleAgentWalletOpenChange]);
  const copyAgentAddress = useCallback(async () => {
    if (!agentWalletPubkey) return;
    try {
      await navigator.clipboard.writeText(agentWalletPubkey);
      setCopiedAgent(true);
    } catch { /* ignore */ }
  }, [agentWalletPubkey]);
  const handleEvmSetup = useCallback(async () => {
    const result = await setupEvmWallet();
    if (result) {
      setEvmConfigured(true);
      setEvmAddress(result.address);
      setEvmMainnetBalance("0");
      setEvmRobinhoodBalance("0");
      refreshWalletSnapshot();
    }
  }, [refreshWalletSnapshot, setEvmAddress, setEvmConfigured, setEvmMainnetBalance, setEvmRobinhoodBalance, setupEvmWallet]);
  const agentSolDisplay = formatSol(agentSolLamports);
  // Total USD = Solana USD + EVM USD
  const totalUsdDisplay = (() => {
    const solUsd = agentSolLamports != null && solPrice != null
      ? (agentSolLamports / 1_000_000_000) * solPrice : 0;
    const usdcNum = Number.isFinite(+agentUsdcBalance) ? +agentUsdcBalance : 0;
    let evmUsd = 0;
    if (evmMainnetBalance && evmMainnetBalance !== "—" && ethPrice != null) {
      const ethNum = Number.parseFloat(evmMainnetBalance);
      if (Number.isFinite(ethNum)) evmUsd += ethNum * ethPrice;
    }
    if (evmRobinhoodBalance && evmRobinhoodBalance !== "—" && ethPrice != null) {
      const ethNum = Number.parseFloat(evmRobinhoodBalance);
      if (Number.isFinite(ethNum)) evmUsd += ethNum * ethPrice;
    }
    const total = solUsd + usdcNum + evmUsd;
    if (total >= 1_000) return `$${formatCompact(total)}`;
    return `$${total.toFixed(2)}`;
  })();
  return (
    <div className="ui-topbar-shell ui-youtube-topbar px-4">
      <div className="flex items-center justify-between gap-3">
        {onMobileMenuClick && (
          <button type="button" onClick={onMobileMenuClick}
            className="md:hidden inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/60 hover:bg-muted/50"
            aria-label="Open navigation menu"><Menu className="h-5 w-5" /></button>
        )}
        {/* Mobile: compact agent context */}
        {selectedAgent ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
            <AgentAvatar image={selectedAgent.image} name={selectedAgent.name} size="sm" />
            <div className="min-w-0 leading-none">
              <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider leading-none">
                Agent
              </p>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-medium leading-tight">{selectedAgent.name}</span>
                {isVerified ? <VerifiedTick size="sm" /> : null}
                {isSolanaRegistered ? <RegisteredTick size="sm" /> : null}
              </div>
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground flex-1 text-sm md:hidden">No agent selected</span>
        )}
        {/* Desktop: selected agent identity */}
        <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
          {process.env.NEXT_PUBLIC_BETA_APP_ENABLED === "1" ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-400"
              title={process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet-beta" ? "Beta · Mainnet" : "Beta"}>
              BETA{process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet-beta" ? <span className="text-amber-400/60">· MAINNET</span> : null}
            </span>
          ) : null}
          {selectedAgent ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <AgentAvatar image={selectedAgent.image} name={selectedAgent.name} size="sm" />
              <div className="min-w-0 leading-none">
                <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider leading-none">Selected</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium leading-tight">{selectedAgent.name}</span>
                  {isVerified ? <VerifiedTick size="sm" /> : null}
                  {isSolanaRegistered ? <RegisteredTick size="sm" /> : null}
                </div>
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">No agent selected</span>
          )}
        </div>
        {/* Right: multi-chain wallet pill + credits */}
        <div className="flex shrink-0 items-center gap-2">
          {selectedAgent ? (
            <>
              <button
                type="button"
                onClick={() => handleAgentWalletOpenChange(true)}
                className={cn(
                  "ui-youtube-topbar-control ui-youtube-topbar-control--compact flex items-center gap-1.5 text-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                aria-label={`Portfolio ${totalUsdDisplay}. Open wallet details`}
                title="Agent portfolio"
              >
                <Wallet className="ui-topbar-control-icon h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="ui-topbar-control-value tabular-nums">
                  {totalUsdDisplay}
                </span>
              </button>
              <Dialog
                open={agentWalletOpen}
                onOpenChange={handleAgentWalletOpenChange}
              >
                <DialogContent
                  className="max-h-[min(92dvh,36rem)] gap-0 overflow-y-auto p-0 sm:max-w-md"
                  overlayClassName="bg-black/50 backdrop-blur-md"
                >
                  <DialogHeader className="gap-0 space-y-0 border-b border-border/60 px-4 py-3 pr-12 text-left">
                    <div className="flex items-center gap-2.5">
                      <AgentAvatar
                        image={selectedAgent.image}
                        name={selectedAgent.name}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <DialogTitle className="truncate text-base font-medium">
                          {selectedAgent.name ?? "Agent wallet"}
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground text-xs">
                          Agent portfolio
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>
                  <div className="space-y-1 px-4 py-3 text-sm">
                    <div className="mb-2 flex items-center justify-between border-b border-border/40 pb-2">
                      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                        Portfolio total
                      </span>
                      <span className="font-semibold tabular-nums">
                        {totalUsdDisplay}
                      </span>
                    </div>
                    <p className="text-muted-foreground pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider">
                      Solana
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <SolanaIcon className="h-4 w-4 shrink-0" />
                        <span className="text-muted-foreground">SOL</span>
                        {agentWalletPubkey ? (
                          <a
                            href={`https://solscan.io/account/${agentWalletPubkey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground/70 hover:text-foreground shrink-0 transition-colors"
                            aria-label="View on Solscan"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {agentSolDisplay}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <UsdcIcon className="h-4 w-4" />
                        <span className="text-muted-foreground">USDC</span>
                      </span>
                      <span className="font-semibold tabular-nums">
                        {agentUsdcBalance}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pb-2">
                      <span className="flex items-center gap-2">
                        <ArIcon className="h-4 w-4" />
                        <span className="text-muted-foreground">$AR</span>
                      </span>
                      <span className="font-semibold tabular-nums">
                        {agentArBalance}
                      </span>
                    </div>
                    {agentWalletPubkey ? (
                      <div className="pb-2">
                        <div className="mt-0.5 flex items-center gap-1">
                          <p className="text-muted-foreground text-[10px]">
                            Address
                          </p>
                        </div>
                        <p className="break-all font-mono text-[11px] leading-tight">
                          {agentWalletPubkey}
                        </p>
                        <div className="mt-1 flex items-center gap-0.5">
                          <button
                            type="button"
                            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                            disabled={solRefreshSpinning || !selectedAgent}
                            onClick={() => void syncAgentBalance(true)}
                            aria-label="Refresh Solana balance"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${solRefreshSpinning ? "animate-spin" : ""}`}
                            />
                          </button>
                          <button
                            type="button"
                            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                            disabled={!agentWalletPubkey}
                            onClick={() => void copyAgentAddress()}
                            aria-label="Copy Solana address"
                          >
                            {copiedAgent ? (
                              <Check className="h-3.5 w-3.5 text-green-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <p className="text-muted-foreground pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider">
                      EVM wallet
                    </p>
                    <EvmWalletSection
                      evmConfigured={evmConfigured}
                      evmAddress={evmAddress}
                      evmMainnetBalance={evmMainnetBalance}
                      evmRobinhoodBalance={evmRobinhoodBalance}
                      evmBalanceLoading={walletSnapshotLoading}
                      evmRefreshSpinning={evmRefreshSpinning}
                      evmSetupState={evmSetupState}
                      evmSetupError={evmSetupError}
                      onSetup={handleEvmSetup}
                      onRefresh={() => void refreshEvmWallet()}
                    />
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <span className="text-muted-foreground rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-sm">
              No agent selected
            </span>
          )}
          {/* LLM credits — opens top-up dialog */}
          <button
            type="button"
            onClick={() => setTopUpOpen(true)}
            className={cn(
              "ui-youtube-topbar-control ui-youtube-topbar-control--compact flex items-center gap-1.5 text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            aria-label={
              llmBalanceLoading
                ? "Loading LLM credit balance"
                : llmBalanceError
                  ? "LLM credit balance unavailable. Retry"
                  : `LLM credit balance ${llmBalanceLabel}. Add funds`
            }
            title="LLM credits — click to add funds"
          >
            <Bot className="ui-topbar-control-icon h-3.5 w-3.5 shrink-0" aria-hidden />
            {llmBalanceLoading ? (
              <Loader2
                aria-hidden
                className="ui-topbar-control-icon h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
              />
            ) : llmBalanceError ? (
              <AlertCircle aria-hidden className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <span className="ui-topbar-control-value tabular-nums">
                {llmBalanceLabel}
              </span>
            )}
          </button>
        </div>
      </div>
      {topUpOpen ? (
        <LlmCreditTopUpDialog
          open
          onClose={() => setTopUpOpen(false)}
          onSettled={() => {
            void refetchLlmBalance();
          }}
        />
      ) : null}
    </div>
  );
}
