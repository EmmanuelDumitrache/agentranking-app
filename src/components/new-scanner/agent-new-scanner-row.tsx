"use client";
import Link from "next/link";
import { memo, type CSSProperties } from "react";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { AgentNewIdentityCell } from "@/components/new-scanner/agent-new-identity-cell";
import { resolveChainIconUrl } from "@/lib/chain-icon-url";
import type { NewAgentScannerRow } from "@/lib/new-agent-scanner/types";
import { cn, timeAgo } from "@/lib/utils";
export const AgentNewScannerRow = memo(function AgentNewScannerRow({
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
    <tr
      style={catchUpStyle}
      className={cn(
        "new-scanner-table-row",
        row.isVerified && "scanner-agent-verified",
        isNew && "new-scanner-table-row--fresh",
        catchUpIndex != null && "new-scanner-table-row--catch-up",
      )}
    >
      <td className="new-scanner-table-cell new-scanner-table-cell--launched">
        <span className="new-scanner-launched tabular-nums">{launched}</span>
      </td>
      <td className="new-scanner-table-cell new-scanner-table-cell--agent">
        <Link href={row.href} className="new-scanner-table-agent-link">
          <AgentNewIdentityCell row={row} />
        </Link>
      </td>
      <td className="new-scanner-table-cell new-scanner-table-cell--chain">
        <Link href={row.href} className="new-scanner-table-icon-link" aria-label={`View ${row.name}`}>
          <AgentListChainCell
            chainId={row.chainId}
            chain={row.chain}
            deploymentCount={row.deploymentCount}
            chainLogoStack={row.chainLogoStack}
            icon={resolveChainIconUrl(row.chainId, row.chain.icon)}
            iconOnly
            size="sm"
          />
        </Link>
      </td>
      <td className="new-scanner-table-cell new-scanner-table-cell--status">
        <Link href={row.href} className="new-scanner-table-status-link">
          <span className="new-scanner-status">{row.statusLabel}</span>
        </Link>
      </td>
    </tr>
  );
});