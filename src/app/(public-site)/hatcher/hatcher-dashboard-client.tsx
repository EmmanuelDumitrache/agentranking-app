"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Bot,
  ExternalLink,
  FileText,
  MessageCircle,
  MessagesSquare,
  Search,
  Server,
  Shield,
} from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { HatcherDashboardPayload, HatcherDashboardAgentRow } from "@/lib/hatcher/dashboard-types";
import { hatcherProfilePath } from "@/lib/hatcher/paths";
import { HatcherDashboardAgentsTable } from "@/components/hatcher/hatcher-dashboard-agents-table";
import { HatcherMobileAgentList } from "@/components/hatcher/hatcher-mobile-agent-list";
import {
  HATCHER_DISCOVERY_SCORE_LABEL,
  HATCHER_INDEXED_BADGE_LABEL,
  HATCHER_INDEXED_BY_AR_LABEL,
  HATCHER_INDEXED_SHORT_DISCLAIMER,
  HATCHER_VERIFIED_BADGE_LABEL,
} from "@/lib/hatcher/config";
import { HATCHER_EXTERNAL_SITE, HATCHER_LOGO_SRC } from "@/lib/hatcher/urls";
type HubFilter = "all" | "active" | "sleeping" | "passport" | "mcp";
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
  readonly icon: typeof Bot;
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
const FILTER_OPTIONS: Array<{ id: HubFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "sleeping", label: "Sleeping" },
  { id: "passport", label: "Passport" },
  { id: "mcp", label: "MCP" },
];
function hasPassport(row: HatcherDashboardAgentRow): boolean {
  const snap = row.hatcher.hatcher;
  const p = snap?.passportSnapshot;
  return p != null && typeof p === "object";
}
function hasMcp(row: HatcherDashboardAgentRow): boolean {
  const snap = row.hatcher.hatcher;
  const m = snap?.mcpManifestSnapshot;
  return m != null && typeof m === "object";
}
function matchesSearch(row: HatcherDashboardAgentRow, q: string): boolean {
  if (!q) return true;
  const snap = row.hatcher.hatcher;
  return (
    row.name.toLowerCase().includes(q) ||
    row.slug.toLowerCase().includes(q) ||
    row.description.toLowerCase().includes(q) ||
    (snap?.hatcherId?.toLowerCase().includes(q) ?? false) ||
    (snap?.publicId?.toLowerCase().includes(q) ?? false) ||
    (snap?.framework?.toLowerCase().includes(q) ?? false) ||
    (snap?.owner?.username?.toLowerCase().includes(q) ?? false)
  );
}
function FeaturedCarousel({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: HatcherDashboardAgentRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex gap-2 overflow-x-auto pb-1 snap-x">
        {rows.slice(0, 8).map((row) => {
          const snap = row.hatcher.hatcher;
          const href = hatcherProfilePath(row.agentId, row.name);
          const links = snap?.links;
          return (
            <div
              key={row.id}
              className="snap-start shrink-0 w-[200px] rounded-lg border border-emerald-500/25 bg-card/50 p-2.5"
            >
              <Link href={href} className="flex items-center gap-2 min-w-0 group">
                <AgentAvatar image={row.image} name={row.name} size="sm" className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate group-hover:text-emerald-400">{row.name}</p>
                  <span className="inline-flex mt-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[9px] font-medium text-emerald-300">
                    {HATCHER_INDEXED_BADGE_LABEL}
                  </span>
                </div>
              </Link>
              <p className="text-[10px] text-muted-foreground mt-2">
                {snap?.framework ?? "—"} · {snap?.status ?? "—"}
              </p>
              <p className="text-[10px] text-emerald-400/90 mt-0.5 tabular-nums">
                {snap?.messageCount ?? 0} msgs · {row.hatcher.partnerScore} score
              </p>
              <div className="flex gap-1 mt-2">
                {links?.profile ? (
                  <a
                    href={links.profile}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded border border-border/60 hover:border-emerald-500/40 text-muted-foreground hover:text-emerald-400"
                    aria-label="Hatcher profile"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
                {links?.chat ? (
                  <a
                    href={links.chat}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded border border-border/60 hover:border-emerald-500/40 text-muted-foreground hover:text-emerald-400"
                    aria-label="Chat"
                  >
                    <MessageCircle className="h-3 w-3" />
                  </a>
                ) : null}
                {links?.passport ? (
                  <a
                    href={links.passport}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded border border-border/60 hover:border-emerald-500/40 text-muted-foreground hover:text-emerald-400"
                    aria-label="Passport"
                  >
                    <FileText className="h-3 w-3" />
                  </a>
                ) : null}
                {links?.mcpManifest ? (
                  <a
                    href={links.mcpManifest}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded border border-border/60 hover:border-emerald-500/40 text-muted-foreground hover:text-emerald-400"
                    aria-label="MCP"
                  >
                    <Server className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
function TrueEmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-emerald-500/30 bg-card/30 px-6 py-10 text-center space-y-4">
      <p className="text-base font-semibold">No Hatcher agents loaded yet</p>
      <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
        Run the Hatcher synchronization job to populate agents from the public Explore feed.
      </p>
      <p className="text-xs font-mono text-muted-foreground">
        Run the authenticated Hatcher sync action, then inspect the worker logs if no rows appear.
      </p>
    </div>
  );
}
export function HatcherDashboardClient({ data }: { readonly data: HatcherDashboardPayload }) {
  const {
    stats,
    agents,
    agentsHasMore,
    dashboardSource,
  } = data;
  const [hubFilter, setHubFilter] = useState<HubFilter>("all");
  const [frameworkFilter, setFrameworkFilter] = useState("");
  const [search, setSearch] = useState("");
  const isTrueEmpty = stats.indexedCount === 0 && agents.length === 0;
  const firstProfileHref =
    agents.length > 0 ? hatcherProfilePath(agents[0].agentId, agents[0].name) : "/agents?hatcher=true";
  const frameworks = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      const fw = a.hatcher.hatcher?.framework?.trim();
      if (fw) set.add(fw);
    }
    return [...set].sort();
  }, [agents]);
  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((row) => {
      if (!matchesSearch(row, q)) return false;
      const snap = row.hatcher.hatcher;
      const status = snap?.status ?? "";
      if (hubFilter === "active" && status !== "active" && status !== "running") return false;
      if (hubFilter === "sleeping" && status !== "sleeping" && status !== "dormant") return false;
      if (hubFilter === "passport" && !hasPassport(row)) return false;
      if (hubFilter === "mcp" && !hasMcp(row)) return false;
      if (frameworkFilter && snap?.framework !== frameworkFilter) return false;
      return true;
    });
  }, [agents, hubFilter, frameworkFilter, search]);
  const topActive = useMemo(
    () =>
      [...agents]
        .filter((r) => {
          const s = r.hatcher.hatcher?.status ?? "";
          return s === "active" || s === "running";
        })
        .sort((a, b) => b.hatcher.partnerScore - a.hatcher.partnerScore),
    [agents],
  );
  const topMessages = useMemo(
    () =>
      [...agents].sort(
        (a, b) => (b.hatcher.hatcher?.messageCount ?? 0) - (a.hatcher.hatcher?.messageCount ?? 0),
      ),
    [agents],
  );
  const newest = useMemo(
    () =>
      [...agents].sort((a, b) => {
        const ta = Date.parse(a.listedAt ?? "") || 0;
        const tb = Date.parse(b.listedAt ?? "") || 0;
        return tb - ta;
      }),
    [agents],
  );
  const filterEmptyMessage = "No agents match your filters.";
  const clearFilters = () => {
    setHubFilter("all");
    setFrameworkFilter("");
    setSearch("");
  };
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 md:px-6 md:py-6 2xl:max-w-[88rem]">
      <header className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.12] via-card/60 to-card/20 p-5 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Image
              src={HATCHER_LOGO_SRC}
              alt="Hatcher Labs"
              width={72}
              height={72}
              className="h-16 w-16 sm:h-[72px] sm:w-[72px] shrink-0 rounded-full object-cover ring-2 ring-emerald-500/35 shadow-lg shadow-emerald-500/10"
              unoptimized
            />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/90">
                {HATCHER_INDEXED_BY_AR_LABEL}
              </p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl mt-1">Hatcher Agent Network</h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground leading-relaxed">
                Public Hatcher agents indexed by AgentRanking.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                  {HATCHER_INDEXED_BADGE_LABEL}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Verified partner feed is not available yet.
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 shrink-0">
            <Link
              href="/agents?hatcher=true"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
            >
              <Shield className="h-4 w-4" />
              Browse Hatcher agents
            </Link>
            <a
              href={HATCHER_EXTERNAL_SITE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card/80 px-4 py-2.5 text-sm font-medium hover:border-emerald-500/40 transition-colors"
            >
              Open Hatcher <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Link
              href={firstProfileHref}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              View indexed profiles
            </Link>
          </div>
        </div>
      </header>
      <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3 text-sm text-muted-foreground">
        <ul className="space-y-1.5 list-disc list-inside leading-relaxed">
          <li>
            <span className="font-semibold text-emerald-300">{HATCHER_INDEXED_BADGE_LABEL}</span> — pulled
            from Hatcher&apos;s public Explore feed (opt-in).
          </li>
          <li>
            <span className="font-semibold text-foreground/90">{HATCHER_VERIFIED_BADGE_LABEL}</span> — future
            dedicated partner feed only.
          </li>
          <li>
            Scores are {HATCHER_DISCOVERY_SCORE_LABEL.toLowerCase()} values — not on-chain, KYA, or AgentRanking
            protocol trust.
          </li>
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          icon={Bot}
          iconClassName="text-emerald-400"
          label="Indexed agents"
          value={fmtInt(stats.indexedCount)}
          hint="In AgentRanking index"
        />
        <StatCard
          icon={Bot}
          iconClassName="text-emerald-300"
          label="Active"
          value={fmtInt(stats.activeCount)}
          hint="Running on Hatcher"
        />
        <StatCard
          icon={Bot}
          iconClassName="text-slate-400"
          label="Sleeping"
          value={fmtInt(stats.sleepingCount)}
          hint="Dormant agents"
        />
        <StatCard
          icon={FileText}
          iconClassName="text-amber-400"
          label="Passport available"
          value={fmtInt(stats.passportCount)}
          hint="JSON snapshot indexed"
        />
        <StatCard
          icon={Server}
          iconClassName="text-blue-400"
          label="MCP available"
          value={fmtInt(stats.mcpCount)}
          hint="Manifest snapshot"
        />
        <StatCard
          icon={MessagesSquare}
          iconClassName="text-violet-400"
          label="Total messages"
          value={fmtInt(stats.totalMessages)}
          hint={`Last sync ${formatIsoUtcTimestamp(stats.lastIndexedAt)}`}
        />
      </div>
      {isTrueEmpty ? (
        <TrueEmptyState />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, slug, framework, owner…"
                className="h-9 pl-8 text-xs bg-background/60"
                aria-label="Search Hatcher agents"
              />
            </div>
            {frameworks.length > 0 ? (
              <select
                value={frameworkFilter}
                onChange={(e) => setFrameworkFilter(e.target.value)}
                className="h-9 rounded-md border border-border bg-background/60 px-2 text-xs"
                aria-label="Filter by framework"
              >
                <option value="">All frameworks</option>
                {frameworks.map((fw) => (
                  <option key={fw} value={fw}>
                    {fw}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setHubFilter(opt.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                  hubFilter === opt.id
                    ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-300"
                    : "border-border text-muted-foreground hover:border-emerald-500/30",
                )}
              >
                {opt.label}
              </button>
            ))}
            {hubFilter !== "all" || frameworkFilter || search ? (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-full px-3 py-1 text-xs font-medium border border-border text-muted-foreground hover:text-foreground"
              >
                Clear filters
              </button>
            ) : null}
          </div>
          <FeaturedCarousel title="Top active agents" rows={topActive} />
          <FeaturedCarousel title="Most used agents" rows={topMessages} />
          <FeaturedCarousel title="Newest indexed" rows={newest} />
          <section id="hatcher-directory" className="space-y-3 scroll-mt-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">Hatcher directory</h2>
                <p className="text-xs text-muted-foreground">
                  Partner-indexed agents — not on-chain ERC-8004 registrations.
                </p>
              </div>
              {agentsHasMore ? (
                <p className="text-[10px] text-muted-foreground">
                  Showing {filteredAgents.length} of {fmtInt(stats.indexedCount)}
                </p>
              ) : null}
            </div>
            {filteredAgents.length === 0 && agents.length > 0 ? (
              <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-6 text-center space-y-2">
                <p className="text-sm text-muted-foreground">{filterEmptyMessage}</p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-medium text-emerald-400 hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <>
                <HatcherMobileAgentList
                  agents={filteredAgents}
                  emptyMessage={filterEmptyMessage}
                />
                <div className="hidden md:block">
                  <HatcherDashboardAgentsTable
                    agents={filteredAgents}
                    emptyMessage={filterEmptyMessage}
                  />
                </div>
              </>
            )}
          </section>
        </>
      )}
      <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border/40 pt-4">
        {HATCHER_INDEXED_SHORT_DISCLAIMER}
      </p>
      {process.env.NODE_ENV === "development" ? (
        <p className="text-[10px] font-mono text-muted-foreground/60 break-all">
          dev: source={dashboardSource ?? "?"} indexed={stats.indexedCount} rows={agents.length}
        </p>
      ) : null}
    </div>
  );
}
