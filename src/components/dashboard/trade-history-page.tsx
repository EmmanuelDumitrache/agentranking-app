"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Button } from "@/components/ui/button";
import type { DashboardTradeHistoryPageData } from "@/lib/agent-trading/trade-history-page.server";
import { cn } from "@/lib/utils";

type Props = {
  initialData: DashboardTradeHistoryPageData;
};

function formatSol(lamports: number | null): string {
  if (lamports == null) return "—";
  return (lamports / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatUsdc(raw: string | null, decimals: number): string {
  if (!raw) return "0.00";
  const value = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(value)) return "0.00";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function solscanTxUrl(signature: string, isDevnet: boolean): string {
  const base = `https://solscan.io/tx/${signature}`;
  return isDevnet ? `${base}?cluster=devnet` : base;
}

export function DashboardTradeHistoryPage({ initialData }: Props) {
  const data = initialData;
  const agentDbId = data.agent.id;
  const swapHref = `/dashboard/agents/${agentDbId}/trade/swap`;
  const isDevnet = data.config.network === "devnet";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 py-2">
      <div className="flex items-start gap-4">
        <AgentAvatar image={data.agent.image} name={data.agent.name} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Trade history</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirmed Jupiter swaps executed by this agent&apos;s custodial wallet.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SOL</p>
          <p className="mt-1 text-xl font-semibold">{formatSol(data.agent.solBalanceLamports)}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">USDC</p>
          <p className="mt-1 text-xl font-semibold">
            {formatUsdc(data.agent.usdcBalanceRaw, data.agent.usdcDecimals)}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Confirmed</p>
          <p className="mt-1 text-xl font-semibold">{data.stats.confirmed}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="mt-1 text-xl font-semibold">{data.stats.total}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link href={swapHref}>New swap</Link>
        </Button>
        {data.agent.walletSolscanUrl ? (
          <Button variant="outline" size="sm" asChild>
            <a href={data.agent.walletSolscanUrl} target="_blank" rel="noreferrer">
              View wallet
              <ExternalLink className="ml-1.5 size-3.5" />
            </a>
          </Button>
        ) : null}
      </div>

      {data.trades.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
          No trades yet. Execute a swap from Terminal or Swap to record history here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 bg-card/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Side</th>
                <th className="px-4 py-3 font-medium">Token</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((trade) => (
                <tr key={trade.id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(trade.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "font-medium capitalize",
                        trade.side === "buy" ? "text-emerald-600" : "text-amber-600",
                      )}
                    >
                      {trade.side}
                    </span>
                  </td>
                  <td className="px-4 py-3">{trade.tokenSymbol ?? trade.tokenName ?? "—"}</td>
                  <td className="px-4 py-3 capitalize">{trade.status}</td>
                  <td className="px-4 py-3">
                    {trade.signature ? (
                      <a
                        href={solscanTxUrl(trade.signature, isDevnet)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {trade.signature.slice(0, 8)}…
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
