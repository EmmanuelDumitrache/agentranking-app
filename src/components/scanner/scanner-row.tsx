"use client";
import Link from "next/link";
import { memo } from "react";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { ScannerIdentityCell } from "@/components/scanner/scanner-identity-cell";
import { ScannerMetricCell } from "@/components/scanner/scanner-cell";
import { ScannerPill } from "@/components/scanner/scanner-pills";
import { ScannerStatusCell } from "@/components/scanner/scanner-status-cell";
import { scannerArScoreClass, scannerTrustClass } from "@/components/scanner/scanner-row-model";
import {
  HOME_AR_SCORE_TOOLTIP,
  HOME_TRUST_TOOLTIP,
} from "@/lib/home-discovery-display";
import { resolveChainIconUrl } from "@/lib/chain-icon-url";
import type { ScannerTableLayout } from "@/lib/scanner-table-layout";
import type { ScannerAgentRow, ScannerViewMode } from "@/components/scanner/types";
import { cn, timeAgo } from "@/lib/utils";
export const ScannerRow = memo(function ScannerRow({
  row,
  mode = "full",
  layout = "multi",
  isNew = false,
}: {
  readonly row: ScannerAgentRow;
  readonly mode?: ScannerViewMode;
  readonly layout?: ScannerTableLayout;
  readonly isNew?: boolean;
}) {
  return (
    <Link
      href={row.href}
      className={cn(
        "scanner-grid-row",
        layout === "single" ? "scanner-grid-row--single" : "scanner-grid-row--multi",
        row.isVerified && "scanner-agent-verified",
        isNew && "animate-in fade-in duration-500",
      )}
    >
      <div className="scanner-grid-cell scanner-grid-cell--rank">
        <span
          className={cn("scanner-rank tabular-nums", row.rankCompact && "opacity-60")}
          title={row.rankTitle}
        >
          {row.rankLabel}
        </span>
      </div>
      <div className="scanner-grid-cell scanner-grid-cell--agent min-w-0">
        <ScannerIdentityCell row={row} layout={layout} />
      </div>
      <div className="scanner-grid-cell scanner-grid-cell--chain">
        <AgentListChainCell
          chainId={row.chainId}
          chain={row.chain}
          deploymentCount={row.deploymentCount}
          chainLogoStack={row.chainLogoStack}
          icon={resolveChainIconUrl(row.chainId, row.chain.icon)}
          iconOnly
          size="sm"
        />
      </div>
      <div className="scanner-grid-cell scanner-grid-cell--protocol">
        <ScannerPill label={row.protocolLabel} />
      </div>
      {mode === "full" ? (
        <>
          <div className="scanner-grid-cell scanner-grid-cell--status">
            <ScannerStatusCell verified={row.isVerified} layout={layout} />
          </div>
          <ScannerMetricCell
            value={row.arEmpty ? "—" : row.ar}
            empty={row.arEmpty}
            title={HOME_AR_SCORE_TOOLTIP}
            className={scannerArScoreClass(row.ar, row.arEmpty)}
          />
          <ScannerMetricCell
            value={row.trustLabel}
            title={HOME_TRUST_TOOLTIP}
            className={scannerTrustClass(row.trustLabel)}
          />
          <ScannerMetricCell
            value={row.reviews > 0 ? row.reviews.toLocaleString() : "—"}
            empty={row.reviews <= 0}
          />
        </>
      ) : null}
      <ScannerMetricCell value={row.age ? timeAgo(row.age) : "—"} empty={!row.age} />
    </Link>
  );
});