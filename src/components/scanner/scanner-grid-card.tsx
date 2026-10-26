import Link from "next/link";
import { memo } from "react";
import { BadgeCheck } from "lucide-react";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { ScannerPill } from "@/components/scanner/scanner-pills";
import {
  scannerArScoreClass,
  scannerTrustClass,
} from "@/components/scanner/scanner-row-model";
import { VerifiedAgentBadge } from "@/components/verification/verified-agent-badge";
import { resolveChainIconUrl } from "@/lib/chain-icon-url";
import type { ScannerAgentRow, ScannerViewMode } from "@/components/scanner/types";
import { cn, timeAgo } from "@/lib/utils";
export const ScannerGridCard = memo(function ScannerGridCard({
  row,
  mode = "full",
  isNew = false,
}: {
  readonly row: ScannerAgentRow;
  readonly mode?: ScannerViewMode;
  readonly isNew?: boolean;
}) {
  const statusPills = row.statusBadgeIds
    .map((id, i) => ({ id, label: row.statusLabels[i] }))
    .filter((p): p is { id: (typeof row.statusBadgeIds)[number]; label: string } => !!p.label)
    .slice(0, 3);
  return (
    <Link
      href={row.href}
      className={cn(
        "scanner-grid-card",
        row.isVerified && "scanner-agent-verified",
        isNew && "scanner-grid-card--fresh",
      )}
    >
      <div className="scanner-grid-card-top">
        <span className="scanner-grid-card-rank tabular-nums" title={row.rankTitle}>
          {row.rankLabel}
        </span>
        {row.age ? (
          <span className="scanner-grid-card-age tabular-nums">{timeAgo(row.age)}</span>
        ) : null}
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
            {row.isVerified ? (
              <BadgeCheck className="scanner-verified-badge h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : null}
            {row.kyaRiskTier && row.kyaRiskTier !== "UNRATED" ? (
              <VerifiedAgentBadge
                tier={row.kyaRiskTier}
                score={row.kyaRiskScore}
                href={row.kyaPassportId ? `/verify/passport/${row.kyaPassportId}` : undefined}
                compact
                className="ml-0.5"
              />
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
        <ScannerPill label={row.protocolLabel} />
      </div>
      {statusPills.length > 0 ? (
        <div className="scanner-grid-card-pills">
          {statusPills.map((pill) => (
            <ScannerPill key={pill.id} id={pill.id} label={pill.label} />
          ))}
        </div>
      ) : null}
      {mode === "full" ? (
        <div className="scanner-grid-card-metrics">
          <div className="scanner-grid-card-metric">
            <span className="scanner-grid-card-metric-label">AR</span>
            <span className={cn("scanner-grid-card-metric-value", scannerArScoreClass(row.ar, row.arEmpty))}>
              {row.arEmpty ? "—" : row.ar}
            </span>
          </div>
          <div className="scanner-grid-card-metric">
            <span className="scanner-grid-card-metric-label">Trust</span>
            <span className={cn("scanner-grid-card-metric-value", scannerTrustClass(row.trustLabel))}>
              {row.trustLabel}
            </span>
          </div>
          <div className="scanner-grid-card-metric">
            <span className="scanner-grid-card-metric-label">Reviews</span>
            <span
              className={cn(
                "scanner-grid-card-metric-value",
                row.reviews <= 0 && "text-[var(--ar-text-muted)] opacity-50",
              )}
            >
              {row.reviews > 0 ? row.reviews.toLocaleString() : "—"}
            </span>
          </div>
        </div>
      ) : null}
    </Link>
  );
});
function ScannerGridCardSkeleton() {
  return (
    <div className="scanner-grid-card scanner-grid-card--skeleton" aria-hidden>
      <div className="scanner-grid-card-skeleton-block scanner-grid-card-skeleton-block--sm" />
      <div className="scanner-grid-card-skeleton-row">
        <div className="scanner-grid-card-skeleton-avatar" />
        <div className="scanner-grid-card-skeleton-lines">
          <div className="scanner-grid-card-skeleton-block" />
          <div className="scanner-grid-card-skeleton-block scanner-grid-card-skeleton-block--short" />
        </div>
      </div>
      <div className="scanner-grid-card-skeleton-block scanner-grid-card-skeleton-block--xs" />
    </div>
  );
}
export function ScannerCardGrid({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return <div className={cn("scanner-card-grid", className)}>{children}</div>;
}
export function ScannerCardGridSkeleton({ count = 8 }: { readonly count?: number }) {
  return (
    <ScannerCardGrid>
      {Array.from({ length: count }, (_, i) => (
        <ScannerGridCardSkeleton key={`sk-${i}`} />
      ))}
    </ScannerCardGrid>
  );
}