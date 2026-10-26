"use client";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ExternalLink, Hexagon, Activity, Database, TrendingUp, Wallet } from "lucide-react";
import type { SapDashboardPayload } from "@/lib/sap-dashboard";
import { SapDashboardAgentsTable } from "@/components/sap/sap-dashboard-agents-table";
import { SapOobeReferralStrip } from "@/components/sap/sap-oobe-referral-strip";
import { SapIndexAttribution } from "@/components/sap/sap-index-attribution";
import { OOBE_SYNAPSE_REFERRAL_STRIP_ENABLED } from "@/lib/oobe-synapse-referral-config";
function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtIntEnUs(n: number): string {
  return n.toLocaleString("en-US");
}
/** SS-safe: avoids `toLocaleString` / default locale drift between Node and browser. */
function formatIsoUtcTimestamp(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[1]} ${m[2]}:${m[3]}:${m[4]} UTC`;
}
export function SapDashboardClient({ data }: { readonly data: SapDashboardPayload }) {
  const { totals, growth, recentSyncs, oobeExplorer: oobe, sapAgentsTable, sapAgentsTableHasMore } =
    data;
  const oobeLiveCount = oobe.liveAgentsFromApi.length;
  const registrationExtra = totals.sapVerifiedAgents - totals.sapUniqueAgents;
  const lastSync = recentSyncs[0];
  const lastSyncSummary = lastSync
    ? `Last indexer sync ${formatIsoUtcTimestamp(lastSync.syncedAt)} — found ${fmtIntEnUs(lastSync.agentsFound)}, upserted ${fmtIntEnUs(lastSync.agentsUpserted)} (${fmtIntEnUs(lastSync.durationMs)} ms)`
    : null;
  const oobeChartData = oobe.volumeDailySeries.map((d) => ({
    day: d.day.slice(0, 10),
    lamports: Number(d.amount) || 0,
  }));
  const volHint = "Sum of perf USD volume for SAP listings";
  const txHint = "Indexed wallet tx count rollup";
  return (
    <div className="mx-auto w-full max-w-7xl space-y-3 px-4 py-3 sm:space-y-4 sm:py-4 md:px-6 md:py-6 2xl:max-w-[88rem]">
      <h1 className="sr-only">SAP ecosystem</h1>
      <div className="rounded-lg border border-border/65 bg-card/40 p-2 sm:p-2.5 md:p-3">
        <div className="grid min-w-0 grid-cols-2 gap-1.5 lg:grid-cols-4 lg:gap-2">
          <CompactSapStat
            icon={Hexagon}
            iconClassName="text-emerald-400"
            label="Unique SAP agents"
            value={fmtIntEnUs(totals.sapUniqueAgents)}
            statTitle={[
              `${fmtIntEnUs(totals.sapVerifiedAgents)} on-chain registration rows in AgentRanking`,
              registrationExtra > 0
                ? `${fmtIntEnUs(registrationExtra)} extra registration${registrationExtra === 1 ? "" : "s"} share a slug with another row`
                : null,
              oobeLiveCount > 0
                ? `${fmtIntEnUs(oobeLiveCount)} on OOBE Explorer API${oobeLiveCount > totals.sapUniqueAgents ? " — run SAP sync if DB lags" : ""}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            emphasize
          />
          <CompactSapStat
            icon={Database}
            iconClassName="text-emerald-400/80"
            label="Capabilities registered"
            value={fmtIntEnUs(totals.capabilitiesRegistered)}
          />
          <CompactSapStat
            icon={Wallet}
            iconClassName="text-violet-400"
            label="Execution wallet volume (est.)"
            value={fmtUsd(totals.executionWalletVolumeUsd)}
            statTitle={volHint}
          />
          <CompactSapStat
            icon={Activity}
            iconClassName="text-violet-400"
            label="Execution tx count (sum)"
            value={totals.executionTxCountSum == null ? "—" : fmtIntEnUs(totals.executionTxCountSum)}
            statTitle={txHint}
          />
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/90 sm:text-[11px]">
          {fmtIntEnUs(totals.sapVerifiedAgents)} on-chain registrations
          {registrationExtra > 0 ? ` (${fmtIntEnUs(registrationExtra)} duplicate normalized name${registrationExtra === 1 ? "" : "s"})` : ""}
          {oobeLiveCount > 0 ? ` · ${fmtIntEnUs(oobeLiveCount)} on OOBE Explorer` : ""}
        </p>
        <nav
          className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/40 pt-2 text-[11px] font-medium leading-none sm:gap-x-2.5 sm:text-xs"
          aria-label="SAP ecosystem navigation"
        >
          <Link
            href="/agents?sapVerified=true"
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/45 bg-emerald-500/[0.12] px-2 py-1 text-emerald-100 transition-colors hover:bg-emerald-500/20"
          >
            <Hexagon className="h-3 w-3 shrink-0" aria-hidden />
            Browse agents
          </Link>
          <Link
            href="/sap/capabilities"
            className="inline-flex items-center rounded-md border border-border/55 bg-transparent px-2 py-1 text-emerald-200/90 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.08]"
          >
            Capabilities
          </Link>
          <span className="hidden text-border sm:inline sm:px-0.5" aria-hidden>
            ·
          </span>
          <a href="/api/sap/stats" className="inline-flex items-center gap-1 px-1 py-0.5 text-violet-200/90 hover:text-violet-100">
            Trust Oracle API <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          </a>
          <span className="text-border" aria-hidden>
            ·
          </span>
          <a href="/api/sap/explorer-proxy" className="inline-flex items-center gap-1 px-1 py-0.5 text-muted-foreground hover:text-emerald-200/90">
            Explorer API snapshot <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          </a>
          <span className="text-border" aria-hidden>
            ·
          </span>
          <a
            href="https://explorer.oobeprotocol.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-1 py-0.5 text-muted-foreground hover:text-foreground"
          >
            Explorer <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          </a>
        </nav>
      </div>
      <div className="space-y-1">
        {OOBE_SYNAPSE_REFERRAL_STRIP_ENABLED ? <SapOobeReferralStrip /> : null}
        <SapDashboardAgentsTable
          agents={sapAgentsTable}
          liveAgentsFromApi={oobe.liveAgentsFromApi}
          liveAgentsListError={oobe.liveAgentsListError}
          sapAgentsTableHasMore={sapAgentsTableHasMore}
          uniqueTotal={totals.sapUniqueAgents}
          registrationTotal={totals.sapVerifiedAgents}
          lastSyncSummary={lastSyncSummary}
        />
      </div>
      {oobe.available && (oobe.networkMetrics || oobe.volume || oobe.escrowAlerts) ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Card className="border-border/80 border-teal-500/20 bg-card/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-teal-200/95">OOBE network (Explorer)</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Live <span className="font-mono">/api/v1/network/metrics</span> — not AgentRanking DB
              </p>
              <p className="text-[10px] text-muted-foreground/80">Fetched {formatIsoUtcTimestamp(oobe.fetchedAt)}</p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              {oobe.networkMetrics ? (
                <>
                  <OobeKV label="Agents" value={oobe.networkMetrics.totalAgents} />
                  <OobeKV label="Active" value={oobe.networkMetrics.activeAgents} />
                  <OobeKV label="Tools" value={String(oobe.networkMetrics.totalTools)} />
                  <OobeKV label="Capabilities" value={String(oobe.networkMetrics.totalCapabilities)} />
                  <OobeKV label="Vol (lamports)" value={oobe.networkMetrics.totalVolumeLamports} className="font-mono" />
                  <OobeKV label="Calls settled" value={oobe.networkMetrics.totalCallsSettled} />
                  <OobeKV label="Escrows" value={`${oobe.networkMetrics.activeEscrows} active / ${oobe.networkMetrics.totalEscrows} total`} />
                </>
              ) : (
                <p className="col-span-full text-muted-foreground">No network metrics parsed</p>
              )}
            </CardContent>
          </Card>
          <Card className="border-border/80 border-teal-500/20 bg-card/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-teal-200/95">Volume &amp; escrows (Explorer)</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-mono">/api/v1/volume</span> ·{" "}
                <span className="font-mono">/api/v1/escrows/alerts</span>
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {oobe.volume ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <OobeKV label="Settled (lamports)" value={oobe.volume.totalSettledLamports} className="font-mono" />
                  {oobe.volume.totalSettledSol ? (
                    <OobeKV label="Settled (SOL)" value={oobe.volume.totalSettledSol} className="font-mono" />
                  ) : null}
                  <OobeKV label="Calls settled" value={oobe.volume.totalCallsSettled} />
                  <OobeKV
                    label="Escrows"
                    value={`${oobe.volume.activeEscrows} act. / ${oobe.volume.totalEscrows} total`}
                  />
                </div>
              ) : (
                <p className="text-muted-foreground">No volume aggregate parsed</p>
              )}
              {oobe.escrowAlerts ? (
                <p className="text-muted-foreground">
                  Escrow alerts:{" "}
                  <span className="text-foreground">
                    {oobe.escrowAlerts.expiringCount} expiring · {oobe.escrowAlerts.lowBalanceCount} low balance
                  </span>
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
      {oobe.available && oobeChartData.length > 0 ? (
        <Card className="border-border/80 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Explorer settled volume (daily lamports)</CardTitle>
            <p className="text-[11px] text-muted-foreground">OOBE `/api/v1/volume/daily` — may be empty when no activity</p>
          </CardHeader>
          <CardContent className="h-[220px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={oobeChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 10 }} width={48} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="lamports" stroke="hsl(173, 80%, 42%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : null}
      <Card className="border-border/80 bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-violet-400" />
            Registrations over time (90d)
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">Agents with SAP registration date, bucketed by UTC day</p>
        </CardHeader>
        <CardContent className="h-[280px] w-full pt-2">
          {growth.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No registration timestamps in range yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growth} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 10 }} width={32} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="count" stroke="hsl(142, 76%, 45%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      <Card className="border-border/80 border-emerald-500/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Indexer runs</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Recent SAP sync jobs — not a live Solana transaction feed
          </p>
          {lastSyncSummary ? (
            <p className="text-[11px] font-medium text-emerald-200/90">{lastSyncSummary}</p>
          ) : null}
        </CardHeader>
        <CardContent className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
          {recentSyncs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sync logs yet</p>
          ) : (
            recentSyncs.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2 text-[11px] space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {new Date(r.syncedAt).toISOString()}
                  </span>
                  <span className="text-muted-foreground">{r.durationMs} ms</span>
                </div>
                <div className="flex gap-3 text-foreground">
                  <span>
                    found <strong>{r.agentsFound}</strong>
                  </span>
                  <span>
                    upserted <strong>{r.agentsUpserted}</strong>
                  </span>
                </div>
                {r.errors != null && r.errors !== false ? (
                  <pre className="max-h-24 overflow-auto rounded bg-background/80 p-2 text-[10px] text-destructive/90">
                    {typeof r.errors === "string" ? r.errors : JSON.stringify(r.errors, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <SapIndexAttribution
        variant="compact"
        sapLastSyncedAt={data.recentSyncs[0]?.syncedAt ?? null}
        className="pt-1"
      />
    </div>
  );
}
/** Dense stat chip for SAP overview — hints via `statTitle`; optional shorter `label` with full text in `labelTitle`. */
function CompactSapStat({
  icon: Icon,
  iconClassName = "text-violet-400",
  label,
  labelTitle,
  value,
  statTitle,
  emphasize,
}: {
  readonly icon: LucideIcon;
  readonly iconClassName?: string;
  readonly label: string;
  readonly labelTitle?: string;
  readonly value: string;
  readonly statTitle?: string;
  readonly emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 sm:gap-2 sm:px-2.5 sm:py-1.5",
        emphasize ? "border-emerald-500/25 bg-emerald-500/[0.04]" : "border-border/45 bg-background/30",
      )}
      title={statTitle}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0 opacity-95 sm:h-4 sm:w-4", iconClassName)} aria-hidden />
      <div className="min-w-0 flex-1 leading-tight">
        <div
          className="line-clamp-2 text-[8px] font-semibold uppercase leading-[1.1] tracking-wide text-muted-foreground sm:text-[9px]"
          title={labelTitle ?? label}
        >
          {label}
        </div>
        <div className="text-[15px] font-semibold tabular-nums tracking-tight sm:text-base">{value}</div>
      </div>
    </div>
  );
}
function OobeKV({
  label,
  value,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly className?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border/50 bg-muted/10 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 break-words font-medium text-foreground", className)}>{value}</div>
    </div>
  );
}