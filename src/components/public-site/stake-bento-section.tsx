"use client";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CircleDollarSign,
  Coins,
  ExternalLink,
  Gift,
  LockKeyhole,
  Radio,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import type { PublicStakeSummary } from "@/lib/public-stake-summary";
import { cn } from "@/lib/utils";
const EMPTY_SUMMARY: PublicStakeSummary = {
  generatedAt: "",
  stakingSource: "synced",
  stakingEnabled: false,
  poolConfigured: false,
  clusterLabel: "Solana",
  totalStakedAr: null,
  activeStakers: null,
  stakingRewardsAr: null,
  bonusRewardsVaultAr: null,
  buybacksUsd: null,
  buybacksAr: null,
  buybacksSol: null,
  feesToFlywheelUsd: null,
  priceUsd: null,
  marketCapUsd: null,
};
type BentoMetricProps = {
  readonly label: string;
  readonly value: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly featured?: boolean;
  readonly status?: string;
};
function BentoMetric({
  label,
  value,
  description,
  icon: Icon,
  featured = false,
  status,
}: BentoMetricProps) {
  return (
    <article
      className={cn(
        "ui-public-site-card relative flex min-h-[8.75rem] flex-col overflow-hidden p-4",
        "bg-[linear-gradient(145deg,color-mix(in_oklab,var(--app-panel)_96%,white_4%),var(--app-panel))]",
        featured && "min-h-[12rem] p-5 sm:min-h-[13rem]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/8 text-foreground/75">
            <Icon className="size-4" aria-hidden />
          </span>
          <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.12em] uppercase">
            {label}
          </p>
        </div>
        {status ? (
          <span className="inline-flex items-center gap-1 text-[9px] font-semibold tracking-wide text-emerald-500 uppercase">
            <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
            {status}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-5 truncate text-2xl font-semibold tabular-nums tracking-tight",
          featured && "text-3xl sm:text-4xl",
        )}
      >
        {value}
      </p>
      <p className="text-muted-foreground mt-auto pt-3 text-[11px] leading-relaxed">
        {description}
      </p>
    </article>
  );
}
function formatAr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString("en-US")} $AR`;
}
function formatInteger(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}
function formatUsd(value: number | null, price = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (price && value < 0.01) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
  }
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}
function formatBuybacks(summary: PublicStakeSummary): string {
  if (summary.buybacksAr != null && summary.buybacksAr > 0) {
    return formatAr(summary.buybacksAr);
  }
  if (summary.buybacksUsd != null && summary.buybacksUsd > 0) {
    return formatUsd(summary.buybacksUsd);
  }
  if (summary.buybacksSol != null && summary.buybacksSol > 0) {
    return `${summary.buybacksSol.toLocaleString("en-US", {
      maximumFractionDigits: 2,
    })} SOL`;
  }
  return "—";
}
function formatStakingRewards(summary: PublicStakeSummary): string {
  // Prefer reward-vault inventory; fall back to bonus vault if pools are empty.
  if (summary.stakingRewardsAr != null && summary.stakingRewardsAr > 0) {
    return formatAr(summary.stakingRewardsAr);
  }
  if (summary.bonusRewardsVaultAr != null && summary.bonusRewardsVaultAr > 0) {
    return formatAr(summary.bonusRewardsVaultAr);
  }
  return formatAr(summary.stakingRewardsAr);
}
export function StakeBentoSection({ initialSummary }: { readonly initialSummary?: PublicStakeSummary | null }) {
  const summaryQuery = useQuery({
    queryKey: ["public", "staking-summary"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/public/staking-summary", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Staking summary unavailable");
      return (await response.json()) as PublicStakeSummary;
    },
    initialData: initialSummary ?? undefined,
    initialDataUpdatedAt: initialSummary?.generatedAt
      ? Date.parse(initialSummary.generatedAt)
      : undefined,
    refetchOnMount: false,
    retry: 1,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const summary = summaryQuery.data ?? EMPTY_SUMMARY;
  const loading = summaryQuery.isPending;
  const error = summaryQuery.isError;
  const live =
    summary.poolConfigured &&
    summary.stakingSource === "onchain" &&
    !error;
  const pending = loading ? "…" : "—";
  let syncLabel = "Read only";
  if (loading) syncLabel = "Syncing";
  else if (live) syncLabel = `${summary.clusterLabel} live`;
  return (
    <section id="stake" className="border-t border-border/50 py-10 sm:py-12">
      <div className="ui-page-stack">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 max-w-2xl">
            <div className="mb-2 flex items-center gap-2">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                Live staking flywheel
              </p>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase",
                  live
                    ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-500"
                    : "border-border/70 text-muted-foreground",
                )}
              >
                <Radio className="size-2.5" aria-hidden />
                {syncLabel}
              </span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Stake $AR. Earn from the flywheel.
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Streamflow-powered, non-custodial locks on Solana. Selected platform fees fund
              $AR buybacks and variable staking rewards—never fixed APY.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
            <a
              href={publicSiteRoutes.stake}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-btn ui-btn-primary justify-center whitespace-nowrap"
            >
              Stake $AR
              <ArrowRight className="ml-1.5 size-4" aria-hidden />
            </a>
            <a
              href={publicSiteRoutes.stakeDocs}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-btn ui-btn-secondary justify-center whitespace-nowrap"
            >
              How it works
            </a>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-12">
          <div className="col-span-2 lg:col-span-4">
            <BentoMetric
              featured
              label="Total staked"
              value={loading ? pending : formatAr(summary.totalStakedAr)}
              description="Total $AR held across the four official Streamflow lock pools."
              icon={LockKeyhole}
              status={live ? "On-chain" : undefined}
            />
          </div>
          <div className="col-span-2 lg:col-span-4">
            <BentoMetric
              featured
              label="Staking rewards"
              value={loading ? pending : formatStakingRewards(summary)}
              description="Live $AR in Streamflow reward vaults, funded from the bonus rewards vault."
              icon={Gift}
              status={live ? "Live" : undefined}
            />
          </div>
          <div className="col-span-2 lg:col-span-4">
            <BentoMetric
              featured
              label="Buybacks"
              value={loading ? pending : formatBuybacks(summary)}
              description="On-chain $AR acquired by the ops wallet from fee-funded market buys."
              icon={TrendingUp}
              status={live ? "On-chain" : undefined}
            />
          </div>
          <div className="col-span-1 lg:col-span-4">
            <BentoMetric
              label="Live price"
              value={loading ? pending : formatUsd(summary.priceUsd, true)}
              description="Current $AR market price."
              icon={CircleDollarSign}
            />
          </div>
          <div className="col-span-1 lg:col-span-4">
            <BentoMetric
              label="Market cap"
              value={loading ? pending : formatUsd(summary.marketCapUsd)}
              description="Live market capitalization."
              icon={Coins}
            />
          </div>
          <div className="col-span-2 lg:col-span-4">
            <BentoMetric
              label="Active stakers"
              value={loading ? pending : formatInteger(summary.activeStakers)}
              description="Unique wallets with open on-chain stake entries."
              icon={Users}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border/60 bg-foreground/[0.025] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Four lock tiers. Variable fee-backed rewards.</p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Choose 7, 30, 90, or 180 days. Longer commitments receive a larger share of each
              eligible reward distribution.
            </p>
          </div>
          <a
            href={publicSiteRoutes.stake}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-btn ui-btn-secondary w-full shrink-0 justify-center sm:w-auto"
          >
            Open staking dashboard
            <ExternalLink className="ml-1.5 size-3.5" aria-hidden />
          </a>
        </div>
        {error ? (
          <button
            type="button"
            onClick={() => void summaryQuery.refetch()}
            className="text-muted-foreground mt-3 text-left text-[11px] hover:text-foreground"
          >
            Live staking metrics are temporarily unavailable. Retry →
          </button>
        ) : (
          <p className="text-muted-foreground mt-3 text-[10px]">
            Read-only snapshot · Streamflow accounts, AgentRanking flywheel records, and Solana
            market data · refreshes every minute
          </p>
        )}
      </div>
    </section>
  );
}
