"use client";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, FileText, Hexagon, ShieldCheck, Wallet, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CovenantDashboardPayload } from "@/lib/covenant/covenant-dashboard";
import { CovenantDashboardAgentsTable } from "@/components/covenant/covenant-dashboard-agents-table";
import {
  COVENANT_EXTERNAL_SITE,
  COVENANT_LOGO_SRC,
  COVENANT_PARTNER_DOCS_HREF,
} from "@/lib/covenant/urls";
function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}
function formatIsoUtcTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[1]} ${m[2]}:${m[3]} UTC`;
}
function StatCard({
  icon: Icon,
  iconClassName,
  label,
  value,
  hint,
}: {
  readonly icon: typeof Hexagon;
  readonly iconClassName: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}) {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-3">
        <CardTitle className="text-[11px] font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn("h-3.5 w-3.5", iconClassName)} aria-hidden />
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
export function CovenantDashboardClient({ data }: { readonly data: CovenantDashboardPayload }) {
  const { stats, agents, agentsHasMore } = data;
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 md:px-6 md:py-6 2xl:max-w-[88rem]">
      <header className="rounded-xl border border-teal-500/25 bg-gradient-to-br from-teal-500/[0.08] via-card/50 to-card/30 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Image
              src={COVENANT_LOGO_SRC}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 object-contain invert brightness-200"
              unoptimized
            />
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Covenant Agents</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground leading-relaxed">
                Capability-based operating layer for autonomous agents — indexed, ranked, and verified by
                AgentRanking.
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                Registry: SAP · Runtime: Covenant · Verification separate from KYA
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Link
              href="/agents?covenant=true"
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-500 transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Explore Covenant Agents
            </Link>
            <a
              href={COVENANT_EXTERNAL_SITE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-3 py-2 text-xs font-medium hover:border-teal-500/40 transition-colors"
            >
              Visit Covenant <ExternalLink className="h-3 w-3" />
            </a>
            <Link
              href={COVENANT_PARTNER_DOCS_HREF}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-3 py-2 text-xs font-medium hover:border-teal-500/40 transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              View Docs
            </Link>
          </div>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard
          icon={Hexagon}
          iconClassName="text-teal-400"
          label="Covenant agents indexed"
          value={fmtInt(stats.indexedCount)}
          hint="SAP listings with covenant.runtime/v1"
        />
        <StatCard
          icon={ShieldCheck}
          iconClassName="text-emerald-400"
          label="Verified"
          value={fmtInt(stats.verifiedCount)}
          hint={`${fmtInt(stats.pendingCount)} pending audit checks`}
        />
        <StatCard
          icon={Zap}
          iconClassName="text-violet-400"
          label="x402 enabled"
          value={fmtInt(stats.x402EnabledCount)}
        />
        <StatCard
          icon={Wallet}
          iconClassName="text-cyan-400"
          label="Last sync / verified"
          value={formatIsoUtcTimestamp(stats.lastIndexedAt)}
          hint={
            stats.lastVerifiedAt
              ? `Last verified ${formatIsoUtcTimestamp(stats.lastVerifiedAt)}`
              : "Verification timestamps from Covenant snapshot"
          }
        />
      </div>
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Covenant directory</h2>
            <p className="text-xs text-muted-foreground">
              SAP-indexed agents running Covenant runtime — sorted by AgentRanking score.
            </p>
          </div>
          {agentsHasMore ? (
            <p className="text-[10px] text-muted-foreground">
              Showing top {agents.length} of {fmtInt(stats.indexedCount)}
            </p>
          ) : null}
        </div>
        <CovenantDashboardAgentsTable agents={agents} />
      </section>
    </div>
  );
}
