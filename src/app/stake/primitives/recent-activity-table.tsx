import { ExternalLink } from "lucide-react";
import type { StakeActivityRow } from "@/lib/stake-page-data";
import {
  STAKE_ACTIVITY_EMPTY,
  STAKE_ACTIVITY_PLACEHOLDER_ROWS,
} from "@/lib/stake-page-data";
import { cn } from "@/lib/utils";
import styles from "@/app/stake/styles/stake-content.module.css";
import stakeStyles from "@/app/stake/styles/stake-page.module.css";
function solscanUrl(txHash: string): string {
  return `https://solscan.io/tx/${txHash}`;
}
function ActivitySkeletonRows() {
  return (
    <ul className="mt-4 space-y-2" aria-hidden>
      {STAKE_ACTIVITY_PLACEHOLDER_ROWS.map((row) => (
        <li
          key={row.id}
          className={cn(
            "flex items-center justify-between gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3",
            stakeStyles.skeletonRow,
          )}
        >
          <span className="text-sm text-muted-foreground">{row.label}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Pending</span>
        </li>
      ))}
    </ul>
  );
}
function ActivityMobileCards({ rows }: { readonly rows: readonly StakeActivityRow[] }) {
  return (
    <ul className="space-y-2 md:hidden">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">{row.source}</span>
            <span className="text-xs text-muted-foreground">{row.timeAgo}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="tabular-nums text-foreground">{row.amount}</span>
            <span className="text-muted-foreground">{row.action}</span>
            {row.txHash ? (
              <a
                href={solscanUrl(row.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary"
              >
                Tx
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : (
              <span className="text-muted-foreground">{row.status}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
export function RecentActivityTable({ rows }: { readonly rows: readonly StakeActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] px-5 py-8 sm:px-6 sm:py-10",
          styles.premiumCard,
        )}
      >
        <p className="text-sm font-semibold text-foreground">No activity yet</p>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">{STAKE_ACTIVITY_EMPTY}</p>
        <ActivitySkeletonRows />
      </div>
    );
  }
  return (
    <>
      <ActivityMobileCards rows={rows} />
      <div className="hidden overflow-x-auto rounded-xl border border-white/[0.06] md:block">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Time</th>
              <th className="px-4 py-3 font-semibold">Source</th>
              <th className="px-4 py-3 font-semibold">$AR bought</th>
              <th className="px-4 py-3 font-semibold">Reward distribution</th>
              <th className="px-4 py-3 font-semibold">Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-white/[0.04] last:border-0">
                <td className="px-4 py-3 text-muted-foreground">{row.timeAgo}</td>
                <td className="px-4 py-3 font-medium">{row.source}</td>
                <td className="px-4 py-3 tabular-nums">{row.amount}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.action}</td>
                <td className="px-4 py-3">
                  {row.txHash ? (
                    <a
                      href={solscanUrl(row.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      View tx
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{row.status}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
