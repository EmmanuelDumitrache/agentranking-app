"use client";
import Link from "next/link";
import { memo } from "react";
import { BadgeCheck } from "lucide-react";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { resolveChainIconUrl } from "@/lib/chain-icon-url";
import { getAgentListStatusBadges } from "@/lib/agent-list-status-badges";
import { cn, timeAgo } from "@/lib/utils";
import { ScannerPill } from "@/components/scanner/scanner-pills";
import {
  scannerArScoreClass,
  scannerTrustClass,
} from "@/components/scanner/scanner-row-model";

import type { MiniAgent } from "@/components/home/home-types";
import type { ScannerAgentRow } from "@/components/scanner/types";
export const ScannerMobileRow = memo(function ScannerMobileRow({
  agent,
  row,
  isNew = false,
  minimal = false,
}: {
  readonly agent: MiniAgent;
  readonly row: ScannerAgentRow;
  readonly isNew?: boolean;
  readonly minimal?: boolean;
}) {
  const badges = getAgentListStatusBadges(agent, { variant: "home" }).slice(0, 2);
  return (
    <Link
      href={row.href}
      className={cn(
        "scanner-mobile-row",
        row.isVerified && "scanner-agent-verified",
        isNew && "animate-in fade-in duration-500",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="scanner-rank w-6 shrink-0 tabular-nums">{row.rankLabel}</span>
        <AgentAvatar
          image={row.image}
          name={row.name}
          size="sm"
          className="scanner-agent-avatar"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[var(--ar-text-base)] font-medium text-[var(--ar-text-primary)]">
              {row.name}
            </span>
            {row.isVerified ? (
              <BadgeCheck className="scanner-verified-badge h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[var(--ar-text-xs)] text-[var(--ar-text-tertiary)]">
            <AgentListChainCell
              chainId={row.chainId}
              chain={row.chain}
              deploymentCount={row.deploymentCount}
              chainLogoStack={row.chainLogoStack}
              icon={resolveChainIconUrl(row.chainId, row.chain.icon)}
              iconOnly
              size="sm"
            />
            <span aria-hidden>·</span>
            <span className="truncate">{row.protocolLabel}</span>
            {row.age ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{timeAgo(row.age)}</span>
              </>
            ) : null}
          </div>
          {!minimal && badges.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {badges.map((b) => (
                <ScannerPill key={b.id} id={b.id} label={b.label} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {!minimal ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--ar-border)] pt-2 text-[var(--ar-text-xs)] tabular-nums">
          <span className={cn("font-medium", scannerArScoreClass(row.ar, row.arEmpty))}>
            AR {row.arEmpty ? "—" : row.ar}
          </span>
          <span className={scannerTrustClass(row.trustLabel)}>{row.trustLabel}</span>
          <span className="text-[var(--ar-text-tertiary)]">
            {row.reviews > 0 ? `${row.reviews} rev` : "—"}
          </span>
        </div>
      ) : null}
    </Link>
  );
});