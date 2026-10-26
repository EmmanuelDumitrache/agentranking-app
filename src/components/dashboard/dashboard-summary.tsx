"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useTransientState } from "@/hooks/use-transient-state";
import { useCallback, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  BarChart3,
  Bot,
  Brain,
  Copy,
  Coins,
  Cpu,
  ExternalLink,
  Fingerprint,
  IdCard,
  Loader2,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Wallet,
  X,
} from "lucide-react";
import { AgentProfileEditLink } from "@/components/dashboard/agent-profile-edit-link";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { RegisteredTick } from "@/components/shared/registered-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DashboardWalletTransferModal } from "@/components/dashboard/wallet-transfer-modal";
import { DashboardEvmSendModal } from "@/components/dashboard/evm-send-modal";
import { LlmCreditTopUpDialog } from "@/components/dashboard/llm-credit-top-up-dialog";
import {
  EvmWalletFundsChart,
  SolanaWalletFundsChart,
} from "@/components/dashboard/wallet-funds-chart";
import { showToast } from "@/components/ui/toast-simple";
import { formatCompact, formatSol } from "@/lib/solana-format";
import { shortenEvmAddress, evmExplorerUrl, robinhoodChainExplorerUrl, robinhoodChainExplorerTxUrl, formatEthCompact } from "@/lib/evm-wallet-utils";
import { EthereumIcon } from "@/components/shared/ethereum-icon";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import { useAgentEvmWalletSetup } from "@/lib/use-agent-evm-wallet-setup";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { cn } from "@/lib/utils";
import type { AppAccountSummary } from "@/lib/app-account-summary";
import type { DashboardAgentOverviewDto } from "@/lib/dashboard/agent-overview";
import { agentPublicPath } from "@/lib/agent-public-url";
import type { DepositListItem } from "@/lib/llm-credits/types";
import {
  useCancelLlmDeposit,
  useLlmCreditBalance,
  useLlmDeposits,
} from "@/features/agent-chat/client/query-hooks";
type EvmWalletOverview = {
  configured: boolean;
  address: string | null;
  status: string;
  ethBalance: string | null;
  robinhoodEthBalance: string | null;
  ethPrice: number | null;
  provider?: string | null;
  isCustodial?: boolean;
};
type SolBalanceInitialDto = {
  readonly solBalanceLamports: number | null;
  readonly usdcBalanceRaw: string;
  readonly arBalanceRaw: string;
};
type Props = {
  readonly data: DashboardAgentOverviewDto;
  readonly account: AppAccountSummary;
  readonly solPrice: number | null;
  readonly initialSolBalance: SolBalanceInitialDto;
  readonly evmWallet?: EvmWalletOverview | null;
  readonly initialTransfers: TransferRow[];
  readonly initialEvmActivity: EvmActivityRow[];
  /** When false, show a soft prompt to enable 2FA / email OTP. */
  readonly mfaEnabled?: boolean;
};
function shortenAddr(value: string, chars = 4): string {
  if (value.length <= chars * 2 + 1) return value;
  return `${value.slice(0, chars)}…${value.slice(-chars)}`;
}
/** Format raw SPL token balance (bigint as string) with `decimals` places. */
function formatSplBalance(raw: string, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  if (n >= 1_000) return formatCompact(n);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals > 2 ? 4 : decimals,
  });
}
/* ────────────────────────────────────────────────────────────────────
   Section-level sub-components
   ──────────────────────────────────────────────────────────────────── */
/* ── Summary pill (one metric column) ─────────────────────────────── */
function SummaryPill({
  label,
  value,
  hint,
  href,
  className,
}: Readonly<{
  label: string;
  value: string;
  hint?: string;
  href?: string;
  className?: string;
}>) {
  const inner = (
    <div className="ui-overview-metric-content min-w-0 space-y-0.5">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
        {label}
      </p>
      <p className="truncate text-sm font-semibold tabular-nums leading-tight sm:text-[15px]">
        {value}
      </p>
      {hint ? (
        <p
          className={cn(
            "truncate text-[11px] leading-snug",
            href ? "text-primary/80" : "text-muted-foreground",
          )}
          title={hint}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          "ui-overview-metric flex min-w-0 flex-col justify-center px-3 py-2.5 sm:px-4 sm:py-3",
          className,
        )}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div
      className={cn(
        "ui-overview-metric flex min-w-0 flex-col justify-center px-3 py-2.5 sm:px-4 sm:py-3",
        className,
      )}
    >
      {inner}
    </div>
  );
}
/* ── Quick action card ────────────────────────────────────────────── */
function QuickActionCard({
  href,
  icon: Icon,
  label,
}: Readonly<{
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}>) {
  return (
    <Link
      href={href}
      className="ui-action-card ui-overview-quick-action group"
    >
      <Icon className="text-muted-foreground h-4 w-4 shrink-0 group-hover:text-foreground transition-colors" aria-hidden />
      <span className="text-sm font-medium">{label}</span>
      <div className="ml-auto text-muted-foreground/40 text-sm transition-colors group-hover:text-muted-foreground">
        →
      </div>
    </Link>
  );
}
/* ── Empty state panel (scaffolded future-data area) ──────────────── */
function EmptyStatePanel({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <div className="rounded-lg border border-border/30 px-4 py-3">
      <p className="text-muted-foreground/70 text-xs font-medium">{title}</p>
      <p className="text-muted-foreground/40 mt-1 text-[11px] leading-relaxed">
        {description}
      </p>
    </div>
  );
}
/* ── Agent Wallet section ─────────────────────────────────────────── */
function AgentWalletSection({
  agentId,
  walletPublicKey,
  walletIsCustodial,
  walletSolscanUrl,
  solBalanceLamports,
  usdcBalance,
  balanceLoading,
  solDisplay,
  estimatedUsd,
  solPrice,
  provisionLoading,
  provisionError,
  onSyncBalance,
  onProvisionWallet,
  onCopyAddress,
  copied,
  onSendClick,
  evmWallet,
  evmSetupState,
  evmSetupError,
  onSetupEvm,
  onSyncEvmBalance,
  onEvmSendClick,
  evmBalanceLoading,
  initialTransfers,
  initialEvmActivity,
  activityRefreshRevision,
}: Readonly<{
  agentId: number;
  walletPublicKey: string | null;
  walletIsCustodial: boolean;
  walletSolscanUrl: string | null;
  solBalanceLamports: number | null;
  usdcBalance: string;
  balanceLoading: boolean;
  solDisplay: string;
  estimatedUsd: string;
  solPrice: number | null;
  provisionLoading: boolean;
  provisionError: string | null;
  onSyncBalance: () => void;
  onProvisionWallet: () => void;
  onCopyAddress: () => void;
  copied: boolean;
  onSendClick: () => void;
  readonly evmWallet?: EvmWalletOverview | null;
  evmSetupState?: string;
  evmSetupError?: string | null;
  onSetupEvm?: () => void;
  onSyncEvmBalance?: () => void;
  onEvmSendClick?: () => void;
  evmBalanceLoading?: boolean;
  initialTransfers: TransferRow[];
  initialEvmActivity: EvmActivityRow[];
  activityRefreshRevision: number;
}>) {
  const [evmCopied, setEvmCopied] = useState(false);
  const solanaUsd = (() => {
    const sol =
      solBalanceLamports != null && solPrice != null
        ? (solBalanceLamports / 1_000_000_000) * solPrice
        : 0;
    const usdc = Number.parseFloat(usdcBalance);
    return sol + (Number.isFinite(usdc) ? usdc : 0);
  })();
  const evmUsd = (() => {
    if (!evmWallet?.configured || evmWallet.ethPrice == null) return 0;
    let total = 0;
    for (const raw of [evmWallet.ethBalance, evmWallet.robinhoodEthBalance]) {
      if (!raw || raw === "—") continue;
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n)) total += n * evmWallet.ethPrice;
    }
    return total;
  })();
  return (
    <div className="ui-overview-panel rounded-xl p-0">
      {/* Header: balances stack under title on mobile to avoid overflow */}
      <div className="ui-overview-panel-header flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
          <h2 className="text-sm font-semibold">Agent wallet</h2>
        </div>
        {walletPublicKey && (
          <dl className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:gap-4">
            <div className="flex items-center gap-1">
              <dt className="flex items-center gap-0.5 text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
                <RuntimeImage src="/branding/solana/solanaLogoMark.svg" alt="" className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden />
                SOL
              </dt>
              <dd className="tabular-nums font-semibold">
                {balanceLoading && solBalanceLamports == null ? "..." : solDisplay}
              </dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="flex items-center gap-0.5 text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
                <RuntimeImage src="/chain-assets/usdc.webp" alt="" className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden />
                USDC
              </dt>
              <dd className="tabular-nums font-semibold">{usdcBalance}</dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="flex items-center gap-0.5 text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
                <EthereumIcon className="h-2.5 w-2.5 shrink-0 opacity-60" />
                ETH
              </dt>
              <dd className="tabular-nums font-semibold" title="Ethereum mainnet">
                {evmWallet?.configured && evmWallet.ethBalance ? formatEthCompact(evmWallet.ethBalance) : "0"}
              </dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="flex items-center gap-0.5 text-muted-foreground text-[10px] font-medium uppercase tracking-wider" title="Robinhood Chain — needed for launch">
                <RobinhoodChainIcon className="h-2.5 w-2.5" />
                RH
              </dt>
              <dd className="tabular-nums font-semibold">
                {evmWallet?.configured && evmWallet.robinhoodEthBalance ? formatEthCompact(evmWallet.robinhoodEthBalance) : "0"}
              </dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">USD</dt>
              <dd className="tabular-nums font-semibold">{estimatedUsd}</dd>
            </div>
          </dl>
        )}
      </div>
      <div className="px-5 py-4 space-y-5">
        {walletPublicKey ? (
          <>
            {/* Solana section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <RuntimeImage src="/branding/solana/solanaLogoMark.svg" alt="" className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                  Solana wallet
                </p>
                {walletIsCustodial && (
                  <Badge variant="outline" className="font-normal text-xs">Generated</Badge>
                )}
              </div>
              {/* Address row */}
              <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="min-w-0 truncate font-mono text-xs text-foreground/90">
                    {walletPublicKey}
                  </p>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                    onClick={onCopyAddress}
                    aria-label="Copy wallet address"
                  >
                    {copied ? (
                      <span className="text-[10px] font-medium text-emerald-400">✓</span>
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
              {/* Actions */}
              <div className="flex flex-wrap gap-2 mt-3">
                <Button type="button" size="sm" variant="secondary" disabled={balanceLoading} onClick={onSyncBalance}>
                  <RefreshCw className={`h-3.5 w-3.5 ${balanceLoading ? "animate-spin" : ""}`} aria-hidden />
                  Refresh
                </Button>
                {walletSolscanUrl && (
                  <Button size="sm" variant="secondary" asChild>
                    <a href={walletSolscanUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      Solscan
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={onSendClick}>
                  <Send className="h-3.5 w-3.5" aria-hidden />
                  Send
                </Button>
              </div>
              <div className="mt-3">
                <SolanaWalletFundsChart
                  agentDbId={agentId}
                  walletPublicKey={walletPublicKey}
                  currentUsd={solanaUsd}
                  solPrice={solPrice}
                />
              </div>
              {/* Activity area */}
              <div className="mt-3">
                <TransfersList
                  agentDbId={agentId}
                  walletPublicKey={walletPublicKey}
                  initialTransfers={initialTransfers}
                  refreshRevision={activityRefreshRevision}
                />
              </div>
            </div>
            {/* ── EVM wallet divider ──────────────────────────── */}
            <div className="border-t border-border/30" />
            {/* EVM section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <EthereumIcon className="h-4 w-4 shrink-0 opacity-90" />
                <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                  EVM wallet
                </p>
                {!evmWallet?.configured ? (
                  <Badge variant="outline" className="font-normal text-xs">Not set up</Badge>
                ) : (
                  <Badge variant="outline" className="font-normal text-xs">Generated</Badge>
                )}
              </div>
              {evmWallet?.configured && evmWallet.address ? (
                <>
                  <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="min-w-0 truncate font-mono text-xs text-foreground/90">
                        {evmWallet.address}
                      </p>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                        onClick={() => {
                          void navigator.clipboard.writeText(evmWallet.address!);
                          setEvmCopied(true);
                          showToast("Address copied");
                        }}
                        aria-label="Copy EVM address"
                      >
                        {evmCopied ? (
                          <span className="text-[10px] font-medium text-emerald-400">✓</span>
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
                    <div className="rounded-lg border border-border/60 px-3 py-2">
                      <p className="text-muted-foreground text-[10px] uppercase flex items-center gap-1">
                        <EthereumIcon className="h-2.5 w-2.5" />
                        Ethereum
                      </p>
                      <p className="font-semibold tabular-nums">{formatEthCompact(evmWallet.ethBalance)} ETH</p>
                    </div>
                    <div className="rounded-lg border border-border/60 px-3 py-2">
                      <p className="text-muted-foreground text-[10px] uppercase flex items-center gap-1">
                        <RobinhoodChainIcon className="h-2.5 w-2.5" />
                        Robinhood Chain
                      </p>
                      <p className="font-semibold tabular-nums">{formatEthCompact(evmWallet.robinhoodEthBalance)} ETH</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button size="sm" variant="secondary" disabled={evmBalanceLoading} onClick={onSyncEvmBalance}>
                      <RefreshCw className={`h-3.5 w-3.5 ${evmBalanceLoading ? "animate-spin" : ""}`} aria-hidden />
                      Refresh
                    </Button>
                    {evmWallet.address && (
                      <Button size="sm" variant="secondary" asChild>
                        <a href={evmExplorerUrl(evmWallet.address)} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          Etherscan
                        </a>
                      </Button>
                    )}
                    {evmWallet.address && (
                      <Button size="sm" variant="secondary" asChild>
                        <a href={robinhoodChainExplorerUrl(evmWallet.address)} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          Robinhood
                        </a>
                      </Button>
                    )}
                    {onEvmSendClick && (
                      <Button size="sm" variant="secondary" onClick={onEvmSendClick}>
                        <Send className="h-3.5 w-3.5" aria-hidden />
                        Send
                      </Button>
                    )}
                  </div>
                  <div className="mt-3">
                    <EvmWalletFundsChart currentUsd={evmUsd} />
                  </div>
                  <div className="mt-3">
                    <EvmActivityList
                      agentDbId={agentId}
                      evmAddress={evmWallet.address}
                      initialActivity={initialEvmActivity}
                      refreshRevision={activityRefreshRevision}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-muted-foreground text-xs">
                    Create an EVM wallet for launches, creator fees and activity across supported networks.
                  </p>
                  {evmSetupError ? <p className="text-destructive text-xs">{evmSetupError}</p> : null}
                  {onSetupEvm ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={evmSetupState === "creating" || evmSetupState === "persisting"}
                      onClick={onSetupEvm}
                    >
                      {evmSetupState === "creating" || evmSetupState === "persisting" ? (
                        <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Creating…</>
                      ) : (
                        <><Plus className="mr-1.5 h-3.5 w-3.5" /> Set up EVM wallet</>
                      )}
                    </Button>
                  ) : null}
                </div>
              )}
              <p className="text-muted-foreground mt-2 text-[10px] leading-relaxed">
                Secure embedded wallet infrastructure provided by Privy.
              </p>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              No wallet provisioned yet. Generate one to enable launches, fees, and transfers.
            </p>
            {provisionError && <p className="text-destructive text-xs">{provisionError}</p>}
            <Button type="button" size="sm" variant="secondary" disabled={provisionLoading} onClick={onProvisionWallet}>
              {provisionLoading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Provision wallet
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
/* ── Transfer activity list ─────────────────────────────────────────── */
type TransferRow = {
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
function TransfersList({
  agentDbId,
  walletPublicKey,
  initialTransfers,
  refreshRevision,
}: Readonly<{
  agentDbId: number;
  walletPublicKey: string | null;
  initialTransfers: TransferRow[];
  refreshRevision: number;
}>) {
  const resourceKey = walletPublicKey
    ? `dashboard-summary-transfers:${agentDbId}:${walletPublicKey}:${refreshRevision}`
    : null;
  const loadTransfers = useCallback(async (signal: AbortSignal) => {
    const res = await fetch(`/api/dashboard/agents/${agentDbId}/transfers`, { signal });
    if (!res.ok) throw new Error("Failed to load transfer activity");
    const data = (await res.json()) as { transfers: TransferRow[] };
    return data.transfers ?? [];
  }, [agentDbId]);
  const resource = useAsyncResource(resourceKey, loadTransfers, {
    initialData: initialTransfers,
    initialDataKey:
      refreshRevision === 0 && walletPublicKey
        ? `dashboard-summary-transfers:${agentDbId}:${walletPublicKey}:0`
        : null,
    revalidateOnMount: false,
  });
  const transfers = resource.data;
  if (!walletPublicKey) return null;
  if (resource.error) return null;
  if (resource.loading || transfers === null) {
    return (
      <div className="rounded-lg border border-border/30 px-4 py-3">
        <p className="text-muted-foreground text-xs">Loading activity…</p>
      </div>
    );
  }
  if (transfers.length === 0) {
    return (
      <EmptyStatePanel
        title="No recent activity"
        description="Transfers will appear here as they happen."
      />
    );
  }
  return (
    <div className="space-y-2">
      {transfers.map((tx) => {
        const isOutbound = tx.fromPublicKey === walletPublicKey;
        const amount = Number(tx.amountLamports) / 1_000_000_000;
        const statusLabel = tx.status === "confirmed" ? "Confirmed" : tx.status === "failed" ? "Failed" : "Pending";
        const statusColor = tx.status === "confirmed" ? "text-green-400" : tx.status === "failed" ? "text-red-400" : "text-amber-400";
        return (
          <div
            key={tx.id}
            className="flex flex-col rounded-lg border border-border/30 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-xs">
                <span className="font-medium">{isOutbound ? "Sent" : "Received"}</span>
                <span className="tabular-nums font-mono text-foreground/90">
                  {amount.toFixed(4)} {tx.token}
                </span>
              </p>
              <p className="text-muted-foreground mt-0.5 truncate font-mono text-[10px]">
                {isOutbound ? `To: ${shortenAddr(tx.toPublicKey)}` : `From: ${shortenAddr(tx.fromPublicKey)}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-0.5">
              <span className={`text-[10px] font-medium ${statusColor}`}>{statusLabel}</span>
              <span className="text-muted-foreground text-[10px]">
                {new Date(tx.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
/* ── EVM Activity list ──────────────────────────────────────────── */
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
function EvmActivityList({
  agentDbId,
  evmAddress,
  initialActivity,
  refreshRevision,
}: Readonly<{
  agentDbId: number;
  evmAddress: string | null;
  initialActivity: EvmActivityRow[];
  refreshRevision: number;
}>) {
  const resourceKey = evmAddress
    ? `dashboard-summary-evm-activity:${agentDbId}:${evmAddress}:${refreshRevision}`
    : null;
  const loadActivity = useCallback(async (signal: AbortSignal) => {
    const res = await fetch(`/api/dashboard/agents/${agentDbId}/evm-activity`, { signal });
    if (!res.ok) throw new Error("Failed to load EVM activity");
    const data = (await res.json()) as { activity: EvmActivityRow[] };
    return data.activity ?? [];
  }, [agentDbId]);
  const resource = useAsyncResource(resourceKey, loadActivity, {
    initialData: initialActivity,
    initialDataKey:
      refreshRevision === 0 && evmAddress
        ? `dashboard-summary-evm-activity:${agentDbId}:${evmAddress}:0`
        : null,
    revalidateOnMount: false,
  });
  const activity = resource.data;
  if (!evmAddress || resource.error) return null;
  if (resource.loading || activity === null) {
    return (
      <div className="rounded-lg border border-border/30 px-4 py-3">
        <p className="text-muted-foreground text-xs">Loading activity…</p>
      </div>
    );
  }
  if (activity.length === 0) {
    return (
      <EmptyStatePanel
        title="No recent activity"
        description="Launches and on-chain activity will appear here."
      />
    );
  }
  return (
    <div className="space-y-2">
      {activity.map((row) => {
        const tokenLabel = row.tokenSymbol ? `$${row.tokenSymbol}` : shortenAddr(row.tokenAddress);
        const dateLabel = new Date(row.blockTimestamp).toLocaleDateString();
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
                <span className="text-muted-foreground">&rarr;</span>
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
              <span className="text-green-400 text-[10px] font-medium">Confirmed</span>
              <span className="text-muted-foreground text-[10px]">{dateLabel}</span>
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
  );
}
/* ── LLM Credits section ──────────────────────────────────────────── */
const llmCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function formatDepositWhen(deposit: DepositListItem): string {
  const raw = deposit.settledAt ?? deposit.createdAt ?? deposit.quoteExpiresAt;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function depositStatusLabel(status: string): string {
  switch (status) {
    case "SETTLED":
      return "Settled";
    case "OVERPAID":
      return "Overpaid";
    case "UNDERPAID":
      return "Underpaid";
    case "AWAITING_PAYMENT":
    case "CREATED":
      return "Pending";
    case "EXPIRED":
      return "Expired";
    case "CANCELLED":
      return "Cancelled";
    case "FAILED":
      return "Failed";
    default:
      return status.replaceAll("_", " ").toLowerCase();
  }
}
function isCancellableDeposit(status: string): boolean {
  return status === "CREATED" || status === "AWAITING_PAYMENT";
}
function LlmBalanceSection({
  fallbackBalanceCents,
}: Readonly<{ fallbackBalanceCents: number }>) {
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const {
    data: balance,
    isLoading: balanceLoading,
    isError: balanceError,
    refetch: refetchBalance,
  } = useLlmCreditBalance();
  const {
    data: depositsData,
    isLoading: depositsLoading,
    isError: depositsError,
    refetch: refetchDeposits,
  } = useLlmDeposits(12);
  const cancelDeposit = useCancelLlmDeposit();
  const availableCents = balance?.availableCents ?? fallbackBalanceCents;
  const reservedCents = balance?.reservedCents ?? 0;
  const deposits = depositsData?.deposits ?? [];
  const hasActivity = !!balance?.lastLedgerAt || deposits.length > 0;
  const handleCancel = (depositId: string) => {
    setCancellingId(depositId);
    cancelDeposit.mutate(depositId, {
      onSettled: () => setCancellingId(null),
    });
  };
  return (
    <div className="ui-overview-panel rounded-xl p-0">
      <div className="ui-overview-panel-header flex items-center gap-2 px-5 py-4">
        <Bot className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
        <h2 className="text-sm font-semibold">LLM Balance</h2>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div>
          <p
            className={cn(
              "text-2xl font-semibold tabular-nums",
              availableCents > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : undefined,
            )}
          >
            {balanceLoading && balance == null
              ? "…"
              : llmCurrency.format(availableCents / 100)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {balanceError
              ? "Couldn’t refresh balance"
              : reservedCents > 0
                ? `Available for agent compute · ${llmCurrency.format(reservedCents / 100)} reserved`
                : hasActivity
                  ? "Available for agent compute"
                  : "Available for agent compute · No usage yet"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => setTopUpOpen(true)}
          >
            Add funds
          </Button>
          {balanceError || depositsError ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void refetchBalance();
                void refetchDeposits();
              }}
            >
              Retry
            </Button>
          ) : null}
        </div>
        {depositsLoading && deposits.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Loading billing history…
          </div>
        ) : deposits.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
              Recent deposits
            </p>
            <ul className="max-h-36 divide-y divide-border/40 overflow-y-auto rounded-lg border border-border/50">
              {deposits.map((deposit) => {
                const credited =
                  deposit.creditedCents ??
                  (deposit.status === "SETTLED" || deposit.status === "OVERPAID"
                    ? deposit.quotedCents
                    : null);
                const pending = isCancellableDeposit(deposit.status);
                const cancelling = cancellingId === deposit.id;
                return (
                  <li
                    key={deposit.id}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-1.5 text-xs",
                      deposit.status === "CANCELLED" && "opacity-60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <span className="shrink-0 font-medium">
                          {depositStatusLabel(deposit.status)}
                        </span>
                        <span className="truncate tabular-nums text-muted-foreground">
                          {credited != null
                            ? llmCurrency.format(credited / 100)
                            : `${deposit.displayAmount} ${deposit.asset}`}
                        </span>
                      </div>
                      <p className="text-muted-foreground truncate text-[10px] leading-tight">
                        {formatDepositWhen(deposit)}
                        {deposit.signature
                          ? ` · ${deposit.signature.slice(0, 8)}…`
                          : ""}
                      </p>
                    </div>
                    {deposit.signature ? (
                      <a
                        href={`https://solscan.io/tx/${deposit.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        aria-label="View on Solscan"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                    {pending ? (
                      <button
                        type="button"
                        className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md disabled:opacity-50"
                        aria-label="Cancel pending deposit"
                        title="Cancel"
                        disabled={cancelling || cancelDeposit.isPending}
                        onClick={() => handleCancel(deposit.id)}
                      >
                        {cancelling ? (
                          <Loader2
                            className="h-3 w-3 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <X className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <EmptyStatePanel
            title="No billing history yet"
            description="Deposits and usage will show up here after you add funds or run agent chat."
          />
        )}
      </div>
      <LlmCreditTopUpDialog
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        onSettled={() => {
          void refetchBalance();
          void refetchDeposits();
        }}
      />
    </div>
  );
}
/* ── Capabilities section ─────────────────────────────────────────── */
function CapabilitiesSection({ tags }: Readonly<{ tags: string[] }>) {
  const clean = tags.filter((t) => t && t.trim().length > 0 && t.length <= 40 && !/^[a-z]{2,4}$/i.test(t));
  return (
    <div className="ui-overview-panel rounded-xl p-0">
      <div className="ui-overview-panel-header flex items-center gap-2 px-5 py-4">
        <Settings className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
        <h2 className="text-sm font-semibold">Capabilities</h2>
      </div>
      <div className="px-5 py-4">
        {clean.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {clean.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border/60 bg-muted/10 px-2.5 py-1 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <EmptyStatePanel
            title="No capabilities configured yet"
            description="Capabilities will appear here as this agent is configured."
          />
        )}
      </div>
    </div>
  );
}
/* ────────────────────────────────────────────────────────────────────
   Main component
   ──────────────────────────────────────────────────────────────────── */
export function DashboardSummary({
  data,
  account,
  solPrice,
  initialSolBalance,
  evmWallet: initialEvmWallet,
  initialTransfers,
  initialEvmActivity,
  mfaEnabled = true,
}: Props) {
  const {
    agent,
    tokenStatus,
    agentWalletPublicKey,
    agentWalletSolscanUrl,
    agentWalletIsCustodial,
    capabilities,
  } = data;
  const base = `/dashboard/agents/${agent.id}`;
  const isVerified =
    account.accountIsVerified || data.agent.arVerificationStatus === "verified";
  const hasToken = tokenStatus.state !== "none";
  const tokenSymbol = hasToken && "symbol" in tokenStatus ? tokenStatus.symbol : null;
  const tokenChain = hasToken && "chain" in tokenStatus ? tokenStatus.chain : null;
  const tokenMint = hasToken && "mint" in tokenStatus ? tokenStatus.mint : null;
  const tokenPageHref =
    tokenChain === "robinhood" && tokenMint
      ? `/tokens/robinhood/${tokenMint}`
      : tokenMint
        ? `/tokens/${tokenMint}`
        : `${base}/launchpad`;
  const [copied, setCopied] = useTransientState(false, 1500);
  const [transferOpen, setTransferOpen] = useState(false);
  const [evmSendOpen, setEvmSendOpen] = useState(false);
  const [activityRefreshRevision, setActivityRefreshRevision] = useState(0);
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [walletPublicKey, setWalletPublicKey] = useSourceDraft(agentWalletPublicKey, agentWalletPublicKey);
  const [walletSolscanUrl, setWalletSolscanUrl] = useSourceDraft(agentWalletSolscanUrl, agentWalletSolscanUrl);
  const [walletIsCustodial, setWalletIsCustodial] = useSourceDraft(
    String(agentWalletIsCustodial),
    agentWalletIsCustodial,
  );
  // EVM wallet state
  const evmWalletSource = initialEvmWallet ?? null;
  const [evmWallet, setEvmWallet] = useSourceDraft(JSON.stringify(evmWalletSource), evmWalletSource);
  const { state: evmSetupState, error: evmSetupError, setupEvmWallet } = useAgentEvmWalletSetup(agent.id);
  const handleSetupEvm = useCallback(async () => {
    const result = await setupEvmWallet();
    if (result) {
      // Use the returned result directly — no need to refetch
      setEvmWallet({
        configured: true,
        address: result.address,
        status: "active",
        ethBalance: null,
        robinhoodEthBalance: null,
        ethPrice: solPrice,
      });
    }
  }, [setEvmWallet, setupEvmWallet, solPrice]);
  type SolBalanceSnapshot = {
    readonly solBalanceLamports: number | null;
    readonly usdcBalance: string;
    readonly arBalance: string;
  };
  const loadSolBalance = useCallback(async (signal: AbortSignal): Promise<SolBalanceSnapshot> => {
    if (!walletPublicKey) {
      return { solBalanceLamports: null, usdcBalance: "0", arBalance: "0" };
    }
    const res = await fetch(`/api/dashboard/agents/${agent.id}/sync-balance`, {
      method: "POST",
      signal,
    });
    const payload = (await res.json()) as {
      solBalanceLamports?: number;
      usdcBalanceRaw?: string | null;
      arBalanceRaw?: string | null;
    };
    if (!res.ok) throw new Error("Could not refresh wallet balance");
    return {
      solBalanceLamports:
        typeof payload.solBalanceLamports === "number" ? payload.solBalanceLamports : null,
      usdcBalance:
        payload.usdcBalanceRaw != null ? formatSplBalance(payload.usdcBalanceRaw, 6) : "0",
      arBalance: payload.arBalanceRaw != null ? formatSplBalance(payload.arBalanceRaw, 6) : "0",
    };
  }, [agent.id, walletPublicKey]);
  const solBalanceKey = `dashboard-summary-sol-balance:${agent.id}:${walletPublicKey ?? "none"}`;
  const initialSolBalanceSnapshot: SolBalanceSnapshot = {
    solBalanceLamports: initialSolBalance.solBalanceLamports,
    usdcBalance: formatSplBalance(initialSolBalance.usdcBalanceRaw, 6),
    arBalance: formatSplBalance(initialSolBalance.arBalanceRaw, 6),
  };
  const solBalanceResource = useAsyncResource(solBalanceKey, loadSolBalance, {
    initialData: initialSolBalanceSnapshot,
    initialDataKey: solBalanceKey,
    revalidateOnMount: false,
  });
  const solBalanceSnapshot = solBalanceResource.data ?? {
    solBalanceLamports: null,
    usdcBalance: "0",
    arBalance: "0",
  };
  const { solBalanceLamports, usdcBalance, arBalance } = solBalanceSnapshot;
  const balanceLoading = Boolean(walletPublicKey) && solBalanceResource.loading;
  const syncBalance = solBalanceResource.refresh;
  const loadEvmBalance = useCallback(async (signal: AbortSignal) => {
    if (!evmWallet?.address) return evmWallet;
    const res = await fetch(`/api/dashboard/agents/${agent.id}/evm-wallet`, { signal });
    if (!res.ok) return evmWallet;
    const payload = (await res.json()) as {
      balances?: {
        mainnet?: { ether?: string } | null;
        robinhood?: { ether?: string } | null;
      };
    };
    return {
      ...evmWallet,
      ethBalance: payload.balances?.mainnet?.ether ?? evmWallet.ethBalance,
      robinhoodEthBalance:
        payload.balances?.robinhood?.ether ?? evmWallet.robinhoodEthBalance,
    };
  }, [agent.id, evmWallet]);
  const evmBalanceKey = `dashboard-summary-evm-balance:${agent.id}:${evmWallet?.address ?? "none"}`;
  const evmBalanceResource = useAsyncResource(evmBalanceKey, loadEvmBalance, {
    initialData: evmWallet,
    initialDataKey: evmBalanceKey,
    revalidateOnMount: false,
  });
  const resolvedEvmWallet = evmBalanceResource.data ?? evmWallet;
  const evmBalanceLoading = Boolean(evmWallet?.address) && evmBalanceResource.loading;
  const syncEvmBalance = evmBalanceResource.refresh;
  const provisionWallet = useCallback(async () => {
    setProvisionLoading(true);
    setProvisionError(null);
    try {
      const res = await fetch(`/api/dashboard/agents/${agent.id}/provision-wallet`, {
        method: "POST",
      });
      const payload = (await res.json()) as {
        publicKey?: string;
        solscanUrl?: string;
        error?: string;
      };
      if (!res.ok || !payload.publicKey) {
        setProvisionError(payload.error ?? "Could not provision agent wallet");
        return;
      }
      setWalletPublicKey(payload.publicKey);
      setWalletSolscanUrl(payload.solscanUrl ?? null);
      setWalletIsCustodial(true);
    } catch {
      setProvisionError("Network error while provisioning wallet");
    } finally {
      setProvisionLoading(false);
    }
  }, [agent.id, setWalletIsCustodial, setWalletPublicKey, setWalletSolscanUrl]);
  const copyAddress = useCallback(async () => {
    if (!walletPublicKey) return;
    try {
      await navigator.clipboard.writeText(walletPublicKey);
      setCopied(true);
      showToast("Address copied to clipboard");
    } catch {
      showToast("Failed to copy address", "error");
    }
  }, [setCopied, walletPublicKey]);
  const estimatedUsd = (() => {
    const solUsd = solBalanceLamports != null && solPrice != null
      ? (solBalanceLamports / 1_000_000_000) * solPrice
      : 0;
    const usdcNum = Number.isFinite(+usdcBalance) ? +usdcBalance : 0;
    const ethPriceVal = resolvedEvmWallet?.ethPrice ?? null;
    let ethUsd = 0;
    if (ethPriceVal != null && resolvedEvmWallet?.configured) {
      const mainnetEth = Number.parseFloat(resolvedEvmWallet.ethBalance ?? "0");
      const rhEth = Number.parseFloat(resolvedEvmWallet.robinhoodEthBalance ?? "0");
      if (Number.isFinite(mainnetEth)) ethUsd += mainnetEth * ethPriceVal;
      if (Number.isFinite(rhEth)) ethUsd += rhEth * ethPriceVal;
    }
    const totalUsd = solUsd + usdcNum + ethUsd;
    if (totalUsd >= 1_000) return `$${formatCompact(totalUsd)}`;
    return `$${totalUsd.toFixed(2)}`;
  })();
  const solDisplay = formatSol(solBalanceLamports);
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      {!mfaEnabled ? (
        <Link
          href="/dashboard/settings?tab=account#security"
          className="ui-action-card group"
        >
          <Lock
            className="text-muted-foreground h-4 w-4 shrink-0 group-hover:text-foreground transition-colors"
            aria-hidden
          />
          <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-snug sm:text-[13px]">
            AgentRanking recommends enabling 2FA or email OTP.
          </p>
          <span className="text-foreground shrink-0 text-xs font-medium">
            Set up now
          </span>
          <span
            className="text-muted-foreground/40 text-sm transition-colors group-hover:text-muted-foreground"
            aria-hidden
          >
            →
          </span>
        </Link>
      ) : null}
      {/* ──────────── Top unified summary strip ──────────────── */}
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        {/* Identity */}
        <div className="ui-overview-identity flex min-w-0 items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5">
          <div className="shrink-0">
            <AgentAvatar image={agent.image} name={agent.name} size="lg" />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
                {agent.name}
              </h1>
              {isVerified ? <VerifiedTick size="md" /> : null}
              {agent.isSolanaRegistered ? <RegisteredTick size="md" /> : null}
            </div>
            {agent.description ? (
              <p
                className="text-muted-foreground mt-0.5 truncate text-xs leading-relaxed"
                title={agent.description}
              >
                {agent.description}
              </p>
            ) : null}
            {walletPublicKey || account.credentialPublicId ? (
              <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                {walletPublicKey ? shortenAddr(walletPublicKey, 5) : null}
                {walletPublicKey && account.credentialPublicId ? (
                  <span className="text-muted-foreground/50"> · </span>
                ) : null}
                {account.credentialPublicId ? (
                  <Link
                    href="/dashboard/credentials"
                    className="hover:text-foreground"
                    title="Account credential"
                  >
                    {account.credentialPublicId}
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center">
            <Link
              href={agentPublicPath({
                chainId: agent.chainId,
                agentId: agent.agentId,
                name: agent.name,
              })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[#212121] hover:text-foreground"
              aria-label="View public agent page"
              title="View public page"
            >
              <ExternalLink className="size-4" aria-hidden />
            </Link>
            <AgentProfileEditLink agentDbId={agent.id} />
          </div>
        </div>
        {/* Metrics — divided board; 2×2 on slim, 1×4 when wider */}
        <div className="ui-overview-metrics grid grid-cols-2 sm:grid-cols-4">
          <SummaryPill
            className="border-b border-r border-border/60 sm:border-b-0"
            label="Wallet"
            value={walletPublicKey ? estimatedUsd : "$0.00"}
            hint={
              walletPublicKey
                ? `${solDisplay} SOL · ${usdcBalance} USDC · ${arBalance} AR`
                : undefined
            }
          />
          <SummaryPill
            className="border-b border-border/60 sm:border-b-0 sm:border-r"
            label="LLM"
            value={`$${(account.totalBalance / 100).toFixed(2)}`}
            hint="Credits"
          />
          <SummaryPill
            className="border-r border-border/60"
            label="Status"
            value={isVerified ? "Verified" : "Unverified"}
            hint={isVerified ? "Premium" : "Verify"}
            href={isVerified ? undefined : "/dashboard/verify"}
          />
          <SummaryPill
            label="Token"
            value={hasToken && tokenSymbol ? `$${tokenSymbol}` : "None"}
            hint={
              hasToken
                ? tokenChain === "robinhood"
                  ? "Robinhood"
                  : "Manage"
                : "Launch"
            }
            href={hasToken ? tokenPageHref : `${base}/launchpad`}
          />
        </div>
      </div>
      {/* ──────────── Quick actions ──────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <QuickActionCard href={`${base}/chat`} icon={MessageSquare} label="Chat" />
        <QuickActionCard href={`${base}/memory`} icon={Brain} label="Memory" />
        <QuickActionCard href={hasToken ? tokenPageHref : `${base}/launchpad`} icon={Coins} label="Token" />
        <QuickActionCard href={`${base}/wallet`} icon={Wallet} label="Wallet" />
        <QuickActionCard href={`${base}/register`} icon={Fingerprint} label="Register" />
        <QuickActionCard href={`${base}/inference`} icon={Cpu} label="Inference" />
        <QuickActionCard href="/dashboard/verify" icon={BadgeCheck} label="Verification" />
        <QuickActionCard href="/dashboard/credentials" icon={IdCard} label="Credentials" />
        <QuickActionCard href={`${base}/analytics`} icon={BarChart3} label="Analytics" />
        <QuickActionCard href="/dashboard/settings" icon={Settings} label="Settings" />
      </div>
      {/* ──────────── Detail sections ───────────────────────── */}
      <div className="grid gap-4 min-w-0">
        <div className="space-y-4 min-w-0">
          <AgentWalletSection
            agentId={agent.id}
            walletPublicKey={walletPublicKey}
            walletIsCustodial={walletIsCustodial}
            walletSolscanUrl={walletSolscanUrl}
            solBalanceLamports={solBalanceLamports}
            usdcBalance={usdcBalance}
            balanceLoading={balanceLoading}
            solDisplay={solDisplay}
            estimatedUsd={estimatedUsd}
            solPrice={solPrice}
            provisionLoading={provisionLoading}
            provisionError={provisionError}
            onSyncBalance={syncBalance}
            onProvisionWallet={provisionWallet}
            onCopyAddress={copyAddress}
            copied={copied}
            onSendClick={() => setTransferOpen(true)}
            evmWallet={resolvedEvmWallet}
            evmSetupState={evmSetupState}
            evmSetupError={evmSetupError}
            onSetupEvm={handleSetupEvm}
            onSyncEvmBalance={syncEvmBalance}
            onEvmSendClick={() => setEvmSendOpen(true)}
            evmBalanceLoading={evmBalanceLoading}
            initialTransfers={initialTransfers}
            initialEvmActivity={initialEvmActivity}
            activityRefreshRevision={activityRefreshRevision}
          />
          <LlmBalanceSection fallbackBalanceCents={account.llmBalanceCents ?? account.totalBalance} />
          <CapabilitiesSection tags={capabilities} />
        </div>
      </div>
      {/* TRANSFER MODAL */}
      {walletPublicKey && (
        <DashboardWalletTransferModal
          agentDbId={agent.id}
          agentName={agent.name}
          agentWalletPublicKey={walletPublicKey}
          balanceSol={(solBalanceLamports ?? 0) / 1_000_000_000}
          solscanUrl={walletSolscanUrl}
          network={data.solanaNetwork}
          open={transferOpen}
          onClose={() => setTransferOpen(false)}
          onSent={() => {
            showToast("Transfer completed successfully");
            void syncBalance();
            setActivityRefreshRevision((revision) => revision + 1);
          }}
        />
      )}
      {/* EVM SEND MODAL */}
      {resolvedEvmWallet?.configured && resolvedEvmWallet.address && (
        <DashboardEvmSendModal
          agentDbId={agent.id}
          evmAddress={resolvedEvmWallet.address}
          mainnetBalanceEth={resolvedEvmWallet.ethBalance}
          robinhoodBalanceEth={resolvedEvmWallet.robinhoodEthBalance}
          custodial={Boolean(resolvedEvmWallet.isCustodial || resolvedEvmWallet.provider === "custodial")}
          open={evmSendOpen}
          onClose={() => setEvmSendOpen(false)}
          onSent={() => {
            showToast("ETH sent successfully");
            void syncEvmBalance();
            setActivityRefreshRevision((revision) => revision + 1);
          }}
        />
      )}
    </div>
  );
}
