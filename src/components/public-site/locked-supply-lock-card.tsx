"use client";
import { useState } from "react";
import {
  Calendar,
  ChevronDown,
  Copy,
  ExternalLink,
  Lock,
  Shield,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast-simple";
import { AR_SOLANA_MINT } from "@/lib/ar-token-public";
import {
  formatLockTokenAmount,
  formatLockUnlockDate,
  formatPercentOfTotalSupply,
  streamflowContractUrl,
  type ArTokenLockStatus,
} from "@/lib/ar-token-locks";
import {
  formatTimeUntilUnlock,
  lockVaultProgressPercent,
  resolveLockAmountTokens,
  resolveLockPercentOfSupply,
  resolveLockRemainingTokens,
  resolveLockStatus,
  resolveLockUnlockIso,
  shortenSolanaAddress,
} from "@/lib/streamflow-locks-display";
import type { MergedArTokenLock } from "@/lib/use-streamflow-locks";
import { cn } from "@/lib/utils";
const STATUS_STYLES: Record<
  ArTokenLockStatus,
  { badge: string; ring: string; label: string }
> = {
  locked: {
    badge: "border-primary/40 bg-primary/15 text-primary",
    ring: "ring-primary/25",
    label: "Locked",
  },
  unlocking: {
    badge: "border-primary/40 bg-primary/15 text-primary",
    ring: "ring-primary/30",
    label: "Unlocking",
  },
  planned: {
    badge: "border-border bg-muted/50 text-muted-foreground",
    ring: "ring-border",
    label: "Planned",
  },
  completed: {
    badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
    ring: "ring-emerald-500/25",
    label: "Completed",
  },
};
async function copyText(value: string, message: string) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(message);
  } catch {
    showToast("Copy failed — try again", "error");
  }
}
function MetricCell({
  label,
  value,
  sub,
}: Readonly<{ label: string; value: string; sub?: string }>) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
export function LockedSupplyLockCard({ lock }: Readonly<{ lock: MergedArTokenLock }>) {
  const [expanded, setExpanded] = useState(false);
  const status = resolveLockStatus(lock);
  const styles = STATUS_STYLES[status];
  const deposited = resolveLockAmountTokens(lock);
  const remaining = resolveLockRemainingTokens(lock);
  const percent = resolveLockPercentOfSupply(lock);
  const unlockIso = resolveLockUnlockIso(lock);
  const countdown = formatTimeUntilUnlock(unlockIso);
  const progress =
    remaining != null ? lockVaultProgressPercent(deposited, remaining) : 0;
  const contractId = lock.streamflowContractId.trim();
  const hasContract = contractId.length > 0 && contractId.toUpperCase() !== "TBA";
  const streamflowUrl = hasContract ? streamflowContractUrl(contractId) : null;
  const isLive = Boolean(lock.live);
  const mint = lock.live?.mint ?? AR_SOLANA_MINT;
  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card/90 shadow-sm ring-1 ring-transparent transition-[box-shadow,border-color] duration-300",
        styles.ring,
        isLive && "border-primary/25",
      )}
    >
      <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary"
              aria-hidden
            >
              <Lock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("text-[10px] font-bold uppercase", styles.badge)}>
                  {styles.label}
                </Badge>
                {isLive ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/40 bg-emerald-500/10 text-[10px] font-bold uppercase text-emerald-400"
                  >
                    On-chain
                  </Badge>
                ) : null}
                <Badge variant="outline" className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {lock.category}
                </Badge>
              </div>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">{lock.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{lock.summary}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Allocation</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-primary">{percent}%</p>
            <p className="text-[11px] text-muted-foreground">of total supply</p>
          </div>
        </div>
        {remaining != null && status !== "completed" ? (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="font-medium text-muted-foreground">Vault fill</span>
              <span className="tabular-nums text-foreground/90">
                {progress < 0.5 ? "Fully locked" : `${progress.toFixed(1)}% released`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted/50">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  status === "unlocking"
                    ? "bg-gradient-to-r from-primary/80 to-primary"
                    : "bg-gradient-to-r from-primary/90 to-emerald-400/90",
                )}
                style={{ width: `${Math.max(2, 100 - progress)}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
      <div className="grid gap-2 px-4 py-4 sm:grid-cols-3 sm:px-5">
        <MetricCell label="Deposited" value={formatLockTokenAmount(deposited)} />
        <MetricCell
          label="Still locked"
          value={remaining != null ? formatLockTokenAmount(remaining) : "—"}
          sub={isLive ? "Solana balance" : undefined}
        />
        <MetricCell
          label="Cliff unlock"
          value={formatLockUnlockDate(unlockIso)}
          sub={countdown ?? undefined}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
        {streamflowUrl ? (
          <Button variant="default" size="sm" className="gap-1.5" asChild>
            <a href={streamflowUrl} target="_blank" rel="noopener noreferrer">
              Streamflow
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </Button>
        ) : null}
        {hasContract ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void copyText(contractId, "Contract copied")}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
            {shortenSolanaAddress(contractId, 6)}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto gap-1 text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "Less detail" : "More detail"}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        </Button>
      </div>
      {expanded ? (
        <div className="space-y-4 border-t border-border/60 bg-muted/15 px-4 py-4 sm:px-5">
          <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            {lock.details.map((line) => (
              <li key={line} className="flex gap-2">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {hasContract ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Contract
                </p>
                <p className="mt-1 break-all font-mono text-xs text-foreground">{contractId}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  SPL mint
                </p>
                <p className="mt-1 break-all font-mono text-xs text-foreground">{mint}</p>
              </div>
              {lock.live?.recipient ? (
                <div className="rounded-xl border border-border/70 bg-background/50 p-3 sm:col-span-2">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Wallet className="h-3 w-3" aria-hidden />
                    Recipient
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-foreground">{lock.live.recipient}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            <Calendar className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
            {formatPercentOfTotalSupply(percent)} — verify amount and unlock time on Streamflow before trading.
          </p>
        </div>
      ) : null}
    </article>
  );
}
