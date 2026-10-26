"use client";
import Link from "next/link";
import { memo, type CSSProperties } from "react";
import { BadgeCheck } from "lucide-react";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { ScannerPill } from "@/components/scanner/scanner-pills";
import { scannerArTone, scannerTrustTone } from "@/lib/new-agent-scanner/row-model";
import { resolveChainIconUrl } from "@/lib/chain-icon-url";
import type { NewAgentScannerRow } from "@/lib/new-agent-scanner/types";
import { cn, timeAgo } from "@/lib/utils";
export const AgentNewScannerGridCard = memo(function AgentNewScannerGridCard({
  row,
  isNew = false,
  catchUpIndex,
}: {
  readonly row: NewAgentScannerRow;
  readonly isNew?: boolean;
  readonly catchUpIndex?: number;
}) {
  const launched = row.age ? timeAgo(row.age) : "—";
  const catchUpStyle =
    catchUpIndex != null
      ? ({ "--new-catch-up-index": catchUpIndex } as CSSProperties)
      : undefined;
  return (
    <Link
      href={row.href}
      style={catchUpStyle}
      className={cn(
        "scanner-grid-card",
        row.isVerified && "scanner-agent-verified",
        isNew && "scanner-grid-card--fresh",
        catchUpIndex != null && "scanner-grid-card--catch-up",
      )}
    >
      <div className="scanner-grid-card-top">
        <span className="scanner-grid-card-age tabular-nums">{launched}</span>
      </div>
      <div className="scanner-grid-card-identity">
        <AgentAvatar
          image={row.image}
          name={row.name}
          size="md"
          className="scanner-grid-card-avatar"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="scanner-grid-card-name truncate">{row.name}</span>
            {row.isPremiumVerified ? (
              <BadgeCheck className="scanner-verified-badge h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : null}
          </div>
          <div className="scanner-grid-card-meta truncate">{row.metaLine}</div>
        </div>
      </div>
      <div className="scanner-grid-card-chain">
        <AgentListChainCell
          chainId={row.chainId}
          chain={row.chain}
          deploymentCount={row.deploymentCount}
          chainLogoStack={row.chainLogoStack}
          icon={resolveChainIconUrl(row.chainId, row.chain.icon)}
          iconOnly
          size="sm"
        />
        <ScannerPill label={row.statusLabel} />
      </div>
      {row.signalPills.length > 0 ? (
        <div className="scanner-grid-card-pills">
          {row.signalPills.map((pill) => (
            <ScannerPill key={pill.id} id={pill.id} label={pill.label} />
          ))}
        </div>
      ) : null}
      <div className="scanner-grid-card-metrics">
        <div className="scanner-grid-card-metric">
          <span className="scanner-grid-card-metric-label">AR</span>
          <span className={cn("scanner-grid-card-metric-value", scannerArTone(row.ar, row.arEmpty))}>
            {row.arEmpty ? "—" : row.ar}
          </span>
        </div>
        <div className="scanner-grid-card-metric">
          <span className="scanner-grid-card-metric-label">Trust</span>
          <span className={cn("scanner-grid-card-metric-value", scannerTrustTone(row.trustLabel))}>
            {row.trustLabel}
          </span>
        </div>
        <div className="scanner-grid-card-metric">
          <span className="scanner-grid-card-metric-label">Caps</span>
          <span className="scanner-grid-card-metric-value tabular-nums">{row.capsCount}</span>
        </div>
      </div>
    </Link>
  );
});