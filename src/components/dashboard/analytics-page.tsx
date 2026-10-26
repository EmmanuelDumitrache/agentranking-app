"use client";
import { useTransientState } from "@/hooks/use-transient-state";
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Coins,
  Copy,
  ExternalLink,
  Gift,
  History,
  RefreshCw,
  Shield,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { DashboardAgentAnalyticsDto } from "@/lib/dashboard/analytics-snapshot-dto";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
type Props = Readonly<{
  initialData: DashboardAgentAnalyticsDto;
  agentDbId: number;
}>;
/* ─── Helpers ────────────────────────────────────────────────────── */
function formatSol(lamports: string | bigint | number | null): string {
  if (lamports == null) return "0";
  const num = typeof lamports === "number" ? lamports : Number(lamports);
  return (num / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}
function shortenAddr(value: string, chars = 4): string {
  if (value.length <= chars * 2 + 1) return value;
  return `${value.slice(0, chars)}…${value.slice(-chars)}`;
}
function timeAgo(date: string | Date | null): string {
  if (!date) return "—";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}
function transferTypeLabel(token: string, fromSelf: boolean): string {
  if (token !== "SOL") return `${token} transfer`;
  return fromSelf ? "Sent" : "Received";
}
/* ─── Sub-components ─────────────────────────────────────────────── */
function StatusPill({
  active,
  icon: Icon,
  label,
}: Readonly<{
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
        active
          ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
          : "bg-muted/50 text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
function VerifiedPill({ verified }: Readonly<{ verified: boolean }>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
        verified
          ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
          : "bg-muted/50 text-muted-foreground",
      )}
    >
      <BadgeCheck className="h-3.5 w-3.5" />
      {verified ? "Verified" : "Unverified"}
    </span>
  );
}
function MetricCard({
  icon: Icon,
  label,
  children,
  href,
}: Readonly<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  href?: string;
}>) {
  const content = (
    <div className="ui-overview-metric h-full p-5 transition-colors hover:bg-muted/30">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }
  return content;
}
function EmptyState({
  icon: Icon,
  title,
  description,
}: Readonly<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}>) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-[#212121] px-4 py-6 text-center">
      <Icon className="text-muted-foreground/40 mx-auto mb-3 h-8 w-8" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{description}</p>
    </div>
  );
}
function SectionHeader({
  icon: Icon,
  label,
}: Readonly<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}>) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold">
      <Icon className="h-4 w-4" />
      {label}
    </h2>
  );
}
type WalletSectionProps = {
  wallet: DashboardAgentAnalyticsDto["wallet"];
  agentDbId: number;
};
function WalletMetricCard({ wallet, agentDbId }: WalletSectionProps) {
  return (
    <MetricCard icon={Wallet} label="Wallet value" href={`/dashboard/agents/${agentDbId}/wallet`}>
      <p className="text-lg font-bold tabular-nums">{wallet.estimatedUsd ?? "—"}</p>
      {wallet.solBalanceLamports != null && (
        <p className="text-muted-foreground text-xs">
          {formatSol(wallet.solBalanceLamports)} SOL · 0 USDC · 0 $AR
        </p>
      )}
    </MetricCard>
  );
}
type TokenMetricCardProps = {
  token: NonNullable<DashboardAgentAnalyticsDto["token"]>;
  isLive: boolean;
  agentDbId: number;
  copied: string | null;
  onCopy: (value: string) => void;
};
function TokenMetricCard({ token, isLive, agentDbId, copied, onCopy }: TokenMetricCardProps) {
  return (
    <MetricCard icon={Coins} label="Token status" href={isLive ? `/dashboard/agents/${agentDbId}/launchpad` : undefined}>
      {isLive ? (
        <>
          <p className="text-lg font-bold">${token.symbol}</p>
          <p className="text-xs text-emerald-400 font-medium">Live</p>
          {token.mint && (
            <button
              type="button"
              className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px] font-mono hover:text-foreground"
              onClick={() => onCopy(token.mint!)}
            >
              {shortenAddr(token.mint)}
              <Copy className="h-3 w-3" />
              {copied === token.mint ? " Copied" : ""}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">Not launched</p>
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/dashboard/agents/${agentDbId}/launchpad`}>Launch token</Link>
          </Button>
        </>
      )}
    </MetricCard>
  );
}
function NoTokenMetricCard({ agentDbId }: { agentDbId: number }) {
  return (
    <MetricCard icon={Coins} label="Token status">
      <p className="text-muted-foreground text-sm">Not launched</p>
      <Button variant="secondary" size="sm" asChild>
        <Link href={`/dashboard/agents/${agentDbId}/launchpad`}>Launch token</Link>
      </Button>
    </MetricCard>
  );
}
type CreatorFeesMetricCardProps = {
  totalCreatorLamports: string;
  totalDistributedLamports: string;
};
function CreatorFeesMetricCard({ totalCreatorLamports, totalDistributedLamports }: CreatorFeesMetricCardProps) {
  if (BigInt(totalCreatorLamports) <= BigInt(0)) {
    return (
      <MetricCard icon={Gift} label="Creator fees">
        <p className="text-muted-foreground text-sm">No creator fees yet</p>
      </MetricCard>
    );
  }
  const pending = BigInt(totalCreatorLamports) - BigInt(totalDistributedLamports);
  return (
    <MetricCard icon={Gift} label="Creator fees">
      <p className="text-lg font-bold tabular-nums">{formatSol(totalCreatorLamports)} SOL</p>
      <div className="text-muted-foreground text-xs space-y-0.5">
        <p>Claimable: {formatSol(pending > BigInt(0) ? pending : BigInt(0))} SOL</p>
        <p>Distributed: {formatSol(totalDistributedLamports)} SOL</p>
      </div>
    </MetricCard>
  );
}
type VerificationMetricCardProps = {
  isVerified: boolean;
  verifiedAt: string | null;
  tokenStatus: string;
  agentDbId: number;
};
function VerificationMetricCard({ isVerified, verifiedAt, tokenStatus, agentDbId }: VerificationMetricCardProps) {
  if (isVerified) {
    return (
      <MetricCard icon={Shield} label="Verification">
        <p className="text-lg font-bold text-amber-400">Verified</p>
        {verifiedAt && <p className="text-muted-foreground text-xs">Agent verified {timeAgo(verifiedAt)}</p>}
        {tokenStatus === "verified" ? (
          <p className="text-xs text-amber-400">Token verified</p>
        ) : (
          <p className="text-muted-foreground text-xs">Token not verified</p>
        )}
      </MetricCard>
    );
  }
  return (
    <MetricCard icon={Shield} label="Verification" href={`/dashboard/agents/${agentDbId}/verify`}>
      <p className="text-muted-foreground text-sm">Unverified</p>
      <Button variant="secondary" size="sm" asChild>
        <Link href={`/dashboard/agents/${agentDbId}/verify`}>Verify now</Link>
      </Button>
    </MetricCard>
  );
}
type TokenPerformanceSectionProps = {
  token: NonNullable<DashboardAgentAnalyticsDto["token"]>;
  isLive: boolean;
};
function TokenPerformanceSection({ token, isLive }: TokenPerformanceSectionProps) {
  return (
    <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
      <div className="ui-overview-panel-header px-5 py-4">
        <SectionHeader icon={CoinIcon} label="Token Performance" />
      </div>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoTile label="Mint" value={shortenAddr(token.mint ?? "", 6)} mono />
        <InfoTile label="Network" value={token.network ?? "—"} capitalize />
        <InfoTile label="Status" value={token.launchStatus ?? "—"} capitalize highlight={isLive} />
        <InfoTile label="Creator share" value={`${token.creatorShareBps / 100}%`} bold />
        <InfoTile label="AR share" value={`${token.arShareBps / 100}%`} bold />
        <InfoTile
          label="Fee sharing"
          value={token.feeSharingStatus ?? "—"}
          capitalize
          highlight={token.feeSharingStatus === "active"}
        />
        {token.launchStatus === "completed" && (
          <div className="space-y-1 rounded-lg border border-border bg-[#212121] p-4">
            <p className="text-muted-foreground text-xs">Market data</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Dexscreener/Pump.fun data will appear after trading activity is indexed.
            </p>
          </div>
        )}
      </div>
      {token.mint && (
        <div className="flex flex-wrap gap-2 px-5 pb-4">
          <Button size="sm" variant="outline" asChild>
            <a href={`https://dexscreener.com/solana/${token.mint}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Dexscreener
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Solscan
            </a>
          </Button>
        </div>
      )}
    </section>
  );
}
function InfoTile({
  label,
  value,
  mono,
  capitalize,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="space-y-1 rounded-lg border border-border/40 bg-muted/10 p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={cn(
          "text-sm",
          bold && "font-semibold",
          mono && "font-mono",
          capitalize && "capitalize",
          highlight
            ? "font-medium text-emerald-400"
            : bold
              ? ""
              : "text-muted-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
function WalletActivitySection({
  transfers,
  walletPublicKey,
}: {
  transfers: DashboardAgentAnalyticsDto["walletActivity"]["recentTransfers"];
  walletPublicKey: string | null;
}) {
  return (
    <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
      <div className="ui-overview-panel-header px-5 py-4">
        <SectionHeader icon={Wallet} label="Wallet activity" />
      </div>
      {transfers.length > 0 ? (
        <div className="overflow-x-auto px-5 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">Asset</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((tx) => {
                const fromSelf = walletPublicKey != null && tx.fromPublicKey === walletPublicKey;
                return (
                  <tr key={tx.id} className="border-b border-border/20">
                    <td className="py-2.5 pr-4 text-muted-foreground tabular-nums">{timeAgo(tx.createdAt)}</td>
                    <td className="py-2.5 pr-4">{transferTypeLabel(tx.token, fromSelf)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{formatSol(tx.amountLamports)}</td>
                    <td className="py-2.5 pr-4">{tx.token}</td>
                    <td className="py-2.5 pr-4">
                      <span className={cn("inline-flex items-center gap-1 text-xs", tx.status === "confirmed" ? "text-emerald-400" : "text-amber-400")}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {tx.signature ? (
                        <a href={`https://solscan.io/tx/${tx.signature}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 pb-4">
          <EmptyState
            icon={Wallet}
            title="No wallet activity yet"
            description="Transfers, launches, verification payments, and fee claims will appear here."
          />
        </div>
      )}
    </section>
  );
}
function CreatorFeeHistorySection({
  token,
  creatorFees,
}: {
  token: NonNullable<DashboardAgentAnalyticsDto["token"]>;
  creatorFees: DashboardAgentAnalyticsDto["creatorFees"];
}) {
  const hasDistributions = BigInt(creatorFees.totalDistributedLamports) > BigInt(0);
  return (
    <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
      <div className="ui-overview-panel-header px-5 py-4">
        <SectionHeader icon={Gift} label="Creator fee history" />
      </div>
      <div className="space-y-3 px-5 py-4">
        <FeeRow label="Agent earns" value={`${token.creatorShareBps / 100}%`} />
        <FeeRow label="AgentRanking receives" value={`${token.arShareBps / 100}%`} />
        <FeeRow label="Total distributed" value={`${formatSol(creatorFees.totalDistributedLamports)} SOL`} />
        {creatorFees.lastDistributionAt && (
          <FeeRow label="Last distribution" value={timeAgo(creatorFees.lastDistributionAt)} muted />
        )}
        {creatorFees.recentDistributions.length > 0 && (
          <div className="mt-2 space-y-2">
            <p className="text-muted-foreground text-xs font-medium">Recent distributions</p>
            {creatorFees.recentDistributions.slice(0, 3).map((d) => (
              <div key={d.txSignature} className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/5 px-4 py-2 text-xs">
                <span className="font-semibold tabular-nums">{formatSol(d.creatorAmountLamports)} SOL to creator</span>
                <a href={`https://solscan.io/tx/${d.txSignature}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        )}
        {!hasDistributions && (
          <p className="text-muted-foreground text-xs">No distributions yet. Fees accrue when your token trades on Pump.fun.</p>
        )}
      </div>
    </section>
  );
}
function FeeRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/10 px-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", muted && "text-xs")}>{value}</span>
    </div>
  );
}
function TimelineSection({ events }: { events: DashboardAgentAnalyticsDto["timeline"] }) {
  const visible = events.slice(0, 15);
  return (
    <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
      <div className="ui-overview-panel-header px-5 py-4">
        <SectionHeader icon={History} label="Recent events" />
      </div>
      <div className="space-y-0 px-5 py-4">
        {visible.map((evt, i) => (
          <div key={`${evt.type}-${i}`} className="flex items-start gap-3 border-l-2 border-border/30 py-2.5 pl-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{evt.label}</p>
              <p className="text-muted-foreground text-xs tabular-nums">{timeAgo(evt.createdAt)}</p>
            </div>
            {evt.txSignature && (
              <a href={`https://solscan.io/tx/${evt.txSignature}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground shrink-0 hover:text-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        ))}
        {visible.length === 0 && (
          <EmptyState icon={History} title="No events yet" description="Activity will appear here as you use the agent." />
        )}
      </div>
    </section>
  );
}
function RecommendedActionsSection({
  actions,
}: {
  actions: DashboardAgentAnalyticsDto["recommendedActions"];
}) {
  if (actions.length === 0) return null;
  return (
    <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
      <div className="ui-overview-panel-header px-5 py-4">
        <SectionHeader icon={TrendingUp} label="Recommended actions" />
      </div>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
        {actions.map((action) => (
          <div key={action.id} className="rounded-xl border border-border/40 bg-muted/10 p-4">
            <p className="text-sm font-semibold">{action.label}</p>
            <p className="text-muted-foreground mt-1 text-xs">{action.description}</p>
            {action.href && (
              <Button variant="secondary" size="sm" className="mt-2" asChild>
                <Link href={action.href}>
                  Go <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
/* ─── Main component ─────────────────────────────────────────────── */
export function DashboardAnalyticsPage({ initialData, agentDbId }: Props) {
  const [copied, setCopied] = useTransientState<string | null>(null, 1500);
  const analyticsQuery = useQuery({
    queryKey: dashboardKeys.analytics(agentDbId),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/dashboard/agents/${agentDbId}/analytics`, {
        signal,
      });
      if (!response.ok) {
        throw new Error(`Failed to load analytics (${response.status})`);
      }
      const json = (await response.json()) as { snapshot: DashboardAgentAnalyticsDto };
      return json.snapshot;
    },
    initialData,
    refetchOnMount: false,
  });
  const data = analyticsQuery.data ?? initialData;
  const copyToClipboard = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      // ignore
    }
  }, [setCopied]);
  const { wallet, token, verification, creatorFees, walletActivity, timeline, recommendedActions } = data;
  const isVerified = verification.status === "verified";
  const isTokenLive = token != null && (token.launchStatus === "completed" || token.launchStatus === "live");
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity flex flex-col gap-4 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">Performance and on-chain activity for this agent.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <VerifiedPill verified={isVerified} />
            <StatusPill active={Boolean(isTokenLive)} icon={Coins} label={isTokenLive ? "Token live" : "No token"} />
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-[#272727] px-3 py-1.5 text-xs font-medium text-muted-foreground capitalize">
              {token?.network ?? "mainnet"}
            </span>
            <Button size="sm" variant="outline" onClick={() => void analyticsQuery.refetch()} disabled={analyticsQuery.isFetching}>
              <RefreshCw className={cn("mr-2 h-3.5 w-3.5", analyticsQuery.isFetching && "animate-spin")} aria-hidden />
              {analyticsQuery.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>
        <div className="ui-overview-metrics grid sm:grid-cols-2 lg:grid-cols-4">
          <WalletMetricCard wallet={wallet} agentDbId={agentDbId} />
          {token ? (
            <TokenMetricCard token={token} isLive={isTokenLive} agentDbId={agentDbId} copied={copied} onCopy={copyToClipboard} />
          ) : (
            <NoTokenMetricCard agentDbId={agentDbId} />
          )}
          <CreatorFeesMetricCard
            totalCreatorLamports={creatorFees.totalCreatorLamports}
            totalDistributedLamports={creatorFees.totalDistributedLamports}
          />
          <VerificationMetricCard
            isVerified={isVerified}
            verifiedAt={verification.verifiedAt}
            tokenStatus={verification.tokenStatus}
            agentDbId={agentDbId}
          />
        </div>
      </div>
      {/* Sections */}
      {token && <TokenPerformanceSection token={token} isLive={isTokenLive} />}
      <WalletActivitySection transfers={walletActivity.recentTransfers} walletPublicKey={wallet.publicKey} />
      {token && <CreatorFeeHistorySection token={token} creatorFees={creatorFees} />}
      <TimelineSection events={timeline} />
      <RecommendedActionsSection actions={recommendedActions} />
    </div>
  );
}
/* ─── Coin icon ──────────────────────────────────────────────────── */
function CoinIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 6v12M8 9h8M8 15h8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
