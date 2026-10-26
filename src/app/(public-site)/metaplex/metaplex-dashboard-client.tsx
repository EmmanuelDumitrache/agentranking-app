"use client";
import Image from "next/image";
import { Coins, Hexagon, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AdminMetaplexHubState } from "@/lib/admin/operations/metaplex-types";
import type { MetaplexDashboardPayload } from "@/lib/metaplex/metaplex-dashboard";
import { METAPLEX_HUB_INTRO } from "@/lib/metaplex/config";
import { METAPLEX_LOGO_SRC } from "@/lib/metaplex/urls";
import { MetaplexAdminHubActions } from "@/components/metaplex/metaplex-admin-hub-actions";
import { MetaplexDashboardAgentsTable } from "@/components/metaplex/metaplex-dashboard-agents-table";
function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
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
    <Card className="overflow-hidden border-border/60 bg-card/45 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 pb-1 pt-3 sm:px-4">
        <CardTitle className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
        <span className="rounded-full border border-border/50 bg-background/55 p-1">
          <Icon className={cn("h-3.5 w-3.5", iconClassName)} aria-hidden />
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 sm:px-4">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
export function MetaplexDashboardClient({
  data,
  initialAdminState,
}: {
  readonly data: MetaplexDashboardPayload;
  readonly initialAdminState?: AdminMetaplexHubState;
}) {
  const { stats, agents } = data;
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-3 py-3 sm:px-4 md:px-6 md:py-6 2xl:max-w-[88rem]">
      <header className="overflow-hidden rounded-2xl border border-violet-500/25 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.18),transparent_34%),linear-gradient(135deg,rgba(139,92,246,0.08),rgba(15,23,42,0.35))] p-4 shadow-sm sm:p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Image
              src={METAPLEX_LOGO_SRC}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 rounded-md object-contain"
              unoptimized
            />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-200/80">
                Solana registry
              </p>
              <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
                Metaplex Agent Registry
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {METAPLEX_HUB_INTRO}
              </p>
            </div>
          </div>
          <div className="shrink-0 sm:items-end">
            <MetaplexAdminHubActions initialData={initialAdminState} />
          </div>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:gap-3">
        <StatCard
          icon={Hexagon}
          iconClassName="text-violet-400"
          label="Agents indexed"
          value={fmtInt(stats.indexedCount)}
          hint="Active listings with Metaplex registry signals"
        />
        <StatCard
          icon={ShieldCheck}
          iconClassName="text-emerald-400"
          label="Registry detected"
          value={fmtInt(stats.verifiedCount)}
          hint="Plugin + identity PDA validated on-chain"
        />
        <StatCard
          icon={Coins}
          iconClassName="text-amber-400"
          label="Bound agent tokens"
          value={fmtInt(stats.boundTokenCount)}
          hint="Agents with an agent token mint linked"
        />
      </div>
      <MetaplexDashboardAgentsTable agents={agents} />
    </div>
  );
}
