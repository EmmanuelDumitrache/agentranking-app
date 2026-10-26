"use client";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  ExternalLink,
  Lock,
  Radio,
  Shield,
  Sparkles,
} from "lucide-react";
import { ArTokenLockRegistry } from "@/components/public-site/ar-token-lock-registry";
import { Button } from "@/components/ui/button";
import { formatLockTokenAmount } from "@/lib/ar-token-locks";
import { AR_TOTAL_SUPPLY, formatArSupply } from "@/lib/ar-tokenomics";
import {
  buildLockRegistrySummaryLabels,
  formatLiveUpdatedLabel,
} from "@/lib/streamflow-locks-display";
import { useStreamflowLocks } from "@/lib/use-streamflow-locks";
import type { StreamflowLocksLivePayload } from "@/lib/streamflow-vesting-types";
import { getStakeSiteUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";
function HeroStat({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: Readonly<{
  icon: typeof Lock;
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}>) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/70 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg border",
            accent ?? "border-primary/35 bg-primary/10 text-primary",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-xl font-bold tabular-nums tracking-tight text-foreground sm:text-2xl">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
function RelatedLinkCard({
  href,
  title,
  description,
  external,
}: Readonly<{ href: string; title: string; description: string; external?: boolean }>) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="group flex flex-col gap-2 rounded-2xl border border-border bg-card/50 p-4 transition-all hover:border-primary/35 hover:bg-card/90"
    >
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
        {title}
        {external ? (
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" aria-hidden />
        ) : (
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
        )}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
    </Link>
  );
}
export function LockedSupplyPageContent({ initialLiveData }: { readonly initialLiveData?: StreamflowLocksLivePayload | null }) {
  const {
    staticTotals,
    liveTotals,
    livePayload,
    isError,
    fetchedAt,
  } = useStreamflowLocks(initialLiveData);
  const { lockCountLabel, lockedAmountLabel, plannedLabel, liveHint } = buildLockRegistrySummaryLabels({
    liveTotals,
    liveCount: livePayload?.locks.length ?? 0,
    staticTotals,
    isError,
  });
  const updatedLabel = formatLiveUpdatedLabel(fetchedAt);
  const hasLive = Boolean(liveTotals && (livePayload?.locks.length ?? 0) > 0);
  const teamPercent = liveTotals?.totalPercentOfSupply ?? staticTotals.totalPercentOfSupply;
  const teamDeposited =
    liveTotals?.totalDepositedTokens ?? staticTotals.totalLockedTokens;
  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden border-b border-border">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,hsl(145_55%_42%/0.16),transparent)]"
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
              <Shield className="h-3 w-3" aria-hidden />
              Public registry
            </span>
            {hasLive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Live on-chain
              </span>
            ) : null}
          </div>
          <h1 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            $AR locked supply
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Team cliff locks on Streamflow — balances, status, and unlock schedules read directly from Solana.
            Auto-refreshes every 30 seconds. Always verify on{" "}
            <a
              href="https://app.streamflow.finance"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              Streamflow
            </a>{" "}
            before trading.
          </p>
        </div>
      </div>
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6 sm:py-10">
        <section aria-labelledby="locked-supply-overview">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="locked-supply-overview" className="text-lg font-semibold tracking-tight">
                Overview
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {liveHint ?? "Published team allocation locked on Streamflow mainnet."}
              </p>
            </div>
            {updatedLabel ? (
              <p className="text-xs font-medium text-muted-foreground">{updatedLabel}</p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <HeroStat icon={Lock} label="Active locks" value={lockCountLabel} />
            <HeroStat
              icon={Sparkles}
              label="Locked on-chain"
              value={lockedAmountLabel}
              hint={hasLive ? "Remaining in vesting vaults" : undefined}
              accent="border-primary/35 bg-primary/10 text-primary"
            />
            <HeroStat
              icon={BarChart3}
              label="Team allocation"
              value={`${teamPercent}%`}
              hint={
                teamDeposited > 0
                  ? `${formatLockTokenAmount(teamDeposited)} of ${formatArSupply(AR_TOTAL_SUPPLY)}`
                  : "5% policy target"
              }
              accent="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            />
            <HeroStat
              icon={Radio}
              label="Data source"
              value={hasLive ? "Live RPC" : "Streamflow"}
              hint={hasLive ? "Solana mainnet · auto-sync" : "Connecting…"}
              accent="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            />
          </div>
          {plannedLabel !== "—" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Planned (not yet on-chain): <span className="font-medium text-foreground/90">{plannedLabel}</span>
            </p>
          ) : null}
        </section>
        <section aria-labelledby="locked-supply-contracts">
          <div className="mb-5">
            <h2 id="locked-supply-contracts" className="text-lg font-semibold tracking-tight">
              Published contracts
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Immutable cliff locks on Streamflow — amounts and unlock times update from chain. Always verify each
              contract on Streamflow before relying on any schedule.
            </p>
          </div>
          <ArTokenLockRegistry initialLiveData={initialLiveData} />
        </section>
        <section
          aria-labelledby="locked-supply-related"
          className="rounded-2xl border border-border bg-card/40 p-5 sm:p-6"
        >
          <h2 id="locked-supply-related" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Explore
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <RelatedLinkCard
              href={getStakeSiteUrl()}
              title="Staking"
              description="Node, Validator, and Core tiers on Streamflow."
            />
            <RelatedLinkCard
              href="/docs/staking#treasury-and-transparency"
              title="Supply safety"
              description="Policy context for emissions, locks, and team allocation."
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={getStakeSiteUrl()}>
                Open staking
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
