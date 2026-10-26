"use client";
import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { ExternalLink, Hexagon } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, truncateAddress } from "@/lib/utils";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { resolveChainIconUrl } from "@/lib/chain-icon-url";
import type { SapDashboardPayload } from "@/lib/sap-dashboard";
import { oobeExplorerAccountUrl } from "@/components/agents/sap-verified-badge";
import { SapListingChip } from "@/components/agents/sap-tag";
type SapTableAgent = SapDashboardPayload["sapAgentsTable"][number];
type LiveApiAgent = SapDashboardPayload["oobeExplorer"]["liveAgentsFromApi"][number];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
function formatIsoUtcDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  return `${MONTHS_SHORT[mo]} ${day}, ${y}`;
}
function fmtIntEnUs(n: number): string {
  return n.toLocaleString("en-US");
}
function AlternatePdasBadge({ agent }: { readonly agent: SapTableAgent }) {
  if (agent.alternatePdaCount <= 0) return null;
  const label = `+${agent.alternatePdaCount} PDA${agent.alternatePdaCount === 1 ? "" : "s"}`;
  const detail =
    agent.alternateAgentIds.length > 0
      ? `${agent.alternatePdaCount} additional on-chain registration${agent.alternatePdaCount === 1 ? "" : "s"} share this agent name.`
      : `${agent.alternatePdaCount} duplicate registration${agent.alternatePdaCount === 1 ? "" : "s"}.`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="h-5 shrink-0 border-amber-500/35 bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-100/90"
        >
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        <p>{detail}</p>
        {agent.alternateAgentIds.length > 0 ? (
          <p className="mt-1 text-muted-foreground">
            IDs:{" "}
            {agent.alternateAgentIds
              .slice(0, 3)
              .map((id) => `${id.chainId}:${id.agentId}`)
              .join(", ")}
            {agent.alternateAgentIds.length > 3 ? "…" : ""}
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
function SapAgentRowLinks({ agent }: { readonly agent: SapTableAgent }) {
  if (!agent.sapAgentPda) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a
        href={oobeExplorerAccountUrl(agent.sapAgentPda)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-400/90 hover:text-emerald-300 inline-flex items-center gap-0.5"
      >
        OOBE <ExternalLink className="h-3 w-3" />
      </a>
      <a
        href={`https://solscan.io/account/${encodeURIComponent(agent.sapAgentPda)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
      >
        Solscan <ExternalLink className="h-3 w-3" />
      </a>
    </span>
  );
}
function SapAgentCard({
  agent,
  rank,
  oobeRep,
}: {
  readonly agent: SapTableAgent;
  readonly rank: number;
  readonly oobeRep: number | null | undefined;
}) {
  const chainIcon = resolveChainIconUrl(agent.chainId);
  return (
    <article className="rounded-lg border border-border/50 bg-muted/5 p-3 space-y-2.5">
      <div className="flex items-start gap-3">
        <span className="mt-1 w-6 shrink-0 text-center font-mono text-xs tabular-nums text-muted-foreground">
          {rank}
        </span>
        <Link href={agent.profilePath} className="flex min-w-0 flex-1 items-center gap-3 group">
          <AgentAvatar
            image={agent.image}
            name={agent.name}
            size="md"
            className="!h-10 !w-10 rounded-full shrink-0"
            loading="lazy"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-foreground group-hover:text-emerald-400 truncate">{agent.name}</span>
              <SapListingChip />
              <AlternatePdasBadge agent={agent} />
            </span>
            <span className="block font-mono text-[11px] text-muted-foreground truncate" title={agent.slug}>
              {agent.slug}
            </span>
          </span>
        </Link>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm tabular-nums text-emerald-200/90">{Math.round(agent.score)}</p>
          <p className="text-[10px] text-muted-foreground">trust</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] border-t border-border/40 pt-2">
        <div>
          <dt className="text-muted-foreground">Chain</dt>
          <dd className="flex items-center gap-1.5 mt-0.5">
            {chainIcon ? (
              <Image src={chainIcon} alt="" width={14} height={14} className="rounded-full" unoptimized />
            ) : null}
            <span>{agent.chainId === SOLANA_CHAIN_ID ? "Solana" : `Chain ${agent.chainId}`}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">OOBE rep</dt>
          <dd className="font-mono tabular-nums mt-0.5">{oobeRep ?? "—"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground">SAP registered</dt>
          <dd className="mt-0.5 tabular-nums">
            {agent.sapRegisteredAt ? formatIsoUtcDateLabel(agent.sapRegisteredAt) : "—"}
          </dd>
        </div>
        {agent.sapOwnerWallet ? (
          <div className="col-span-2">
            <dt className="text-muted-foreground">Owner</dt>
            <dd className="font-mono text-[10px] mt-0.5">{truncateAddress(agent.sapOwnerWallet, 6)}</dd>
          </div>
        ) : null}
        <div className="col-span-2">
          <dt className="text-muted-foreground">Explorer</dt>
          <dd className="mt-0.5">
            <SapAgentRowLinks agent={agent} />
          </dd>
        </div>
      </dl>
    </article>
  );
}
export function SapDashboardAgentsTable({
  agents,
  liveAgentsFromApi,
  liveAgentsListError,
  sapAgentsTableHasMore,
  uniqueTotal,
  registrationTotal,
  lastSyncSummary,
}: {
  readonly agents: SapTableAgent[];
  readonly liveAgentsFromApi: LiveApiAgent[];
  readonly liveAgentsListError?: string;
  readonly sapAgentsTableHasMore: boolean;
  readonly uniqueTotal: number;
  readonly registrationTotal: number;
  readonly lastSyncSummary?: string | null;
}) {
  const [query, setQuery] = useState("");
  const oobeRepByPda = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const a of liveAgentsFromApi) {
      const k = a.pda.trim();
      if (k) m.set(k, a.reputationScore);
    }
    return m;
  }, [liveAgentsFromApi]);
  const notIndexedFromApiCount = useMemo(() => {
    const db = new Set<string>();
    for (const a of agents) {
      const p = a.sapAgentPda?.trim();
      if (p) db.add(p);
    }
    let n = 0;
    for (const row of liveAgentsFromApi) {
      const p = row.pda.trim();
      if (p && !db.has(p)) n++;
    }
    return n;
  }, [agents, liveAgentsFromApi]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const pda = a.sapAgentPda?.toLowerCase() ?? "";
      const owner = a.sapOwnerWallet?.toLowerCase() ?? "";
      const idStr = String(a.agentId);
      return (
        a.name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        idStr.includes(q) ||
        String(a.chainId).includes(q) ||
        pda.includes(q) ||
        owner.includes(q)
      );
    });
  }, [agents, query]);
  const stickyCell =
    "sticky left-0 z-10 border-r border-border/60 bg-card shadow-[2px_0_8px_-4px_rgba(0,0,0,0.45)]";
  const cellBorder = "border border-border/45 px-2 py-2 align-middle text-xs sm:px-3";
  const duplicateRegistrations = Math.max(0, registrationTotal - uniqueTotal);
  return (
    <TooltipProvider delayDuration={200}>
      <Card className="border-border/80 border-emerald-500/20 bg-card/50 overflow-hidden">
        <CardHeader className="space-y-2 border-b border-border/35 px-3 py-2.5 sm:px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold leading-snug">
                <Hexagon className="h-3.5 w-3.5 shrink-0 text-emerald-400 sm:h-4 sm:w-4" />
                SAP agents
              </CardTitle>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {fmtIntEnUs(uniqueTotal)} unique
                {duplicateRegistrations > 0 ? (
                  <>
                    {" "}
                    · {fmtIntEnUs(registrationTotal)} on-chain registrations
                  </>
                ) : null}
                {sapAgentsTableHasMore ? ` · top ${agents.length} by trust` : ""}
              </p>
            </div>
            <Link
              href="/agents?sapVerified=true"
              className="shrink-0 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 sm:whitespace-nowrap"
            >
              Open full directory →
            </Link>
          </div>
          {lastSyncSummary ? (
            <p className="text-[10px] text-muted-foreground/90">{lastSyncSummary}</p>
          ) : null}
          {agents.length > 0 ? (
            <div className="relative w-full sm:max-w-md">
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, slug, ID, PDA, owner…"
                className="h-8 rounded-md border-border/65 bg-background text-xs placeholder:text-muted-foreground/70"
                aria-label="Search SAP agents"
              />
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-2 px-0 pb-3 pt-0 sm:pb-4">
          {agents.length === 0 ? (
            <div className="space-y-3 px-4 py-2 text-center sm:px-6">
              <p className="text-sm text-muted-foreground">
                {liveAgentsFromApi.length > 0
                  ? "None in AgentRanking DB yet — run the authenticated SAP sync action."
                  : registrationTotal === 0 && lastSyncSummary
                    ? "Sync may still be running — check indexer runs below."
                    : "No SAP agents in this database yet. Run the authenticated SAP sync action or check DATABASE_URL."}
              </p>
              {liveAgentsListError ? (
                <p className="text-sm text-destructive/90 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  OOBE agent list failed: {liveAgentsListError}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="space-y-2 px-3 md:hidden">
                {filtered.map((a, i) => {
                  const pdaKey = a.sapAgentPda?.trim() ?? "";
                  const oobeRep = pdaKey ? oobeRepByPda.get(pdaKey) : undefined;
                  return <SapAgentCard key={`${a.chainId}-${a.agentId}`} agent={a} rank={i + 1} oobeRep={oobeRep} />;
                })}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse border border-emerald-500/20 text-sm">
                  <thead className="bg-emerald-950/25 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className={cn(cellBorder, "w-10 text-center font-medium")}>
                        #
                      </th>
                      <th
                        scope="col"
                        className={cn(cellBorder, "min-w-[200px] text-left font-medium", stickyCell)}
                      >
                        Agent
                      </th>
                      <th scope="col" className={cn(cellBorder, "text-left font-medium whitespace-nowrap")}>
                        Chain
                      </th>
                      <th scope="col" className={cn(cellBorder, "text-right font-medium whitespace-nowrap")}>
                        Trust
                      </th>
                      <th scope="col" className={cn(cellBorder, "text-right font-medium whitespace-nowrap")}>
                        OOBE rep
                      </th>
                      <th scope="col" className={cn(cellBorder, "text-left font-medium whitespace-nowrap")}>
                        Registered
                      </th>
                      <th scope="col" className={cn(cellBorder, "text-left font-medium min-w-[120px]")}>
                        Explorer
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-foreground">
                    {filtered.map((a, i) => {
                      const pdaKey = a.sapAgentPda?.trim() ?? "";
                      const oobeRep = pdaKey ? oobeRepByPda.get(pdaKey) : undefined;
                      const chainIcon = resolveChainIconUrl(a.chainId);
                      return (
                        <tr
                          key={`${a.chainId}-${a.agentId}`}
                          className="transition-colors hover:bg-emerald-500/[0.05]"
                        >
                          <td className={cn(cellBorder, "text-center font-mono tabular-nums text-muted-foreground")}>
                            {i + 1}
                          </td>
                          <td className={cn(cellBorder, "min-w-[200px]", stickyCell)}>
                            <Link
                              href={a.profilePath}
                              className="flex items-center gap-2.5 min-w-0 group/link"
                            >
                              <AgentAvatar
                                image={a.image}
                                name={a.name}
                                size="md"
                                className="rounded-full shrink-0 !h-10 !w-10 text-[10px]"
                                loading="lazy"
                              />
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-foreground group-hover/link:text-emerald-400 truncate">
                                    {a.name}
                                  </span>
                                  <SapListingChip />
                                  <AlternatePdasBadge agent={a} />
                                </span>
                                <span
                                  className="block font-mono text-[11px] text-muted-foreground truncate"
                                  title={a.slug}
                                >
                                  {a.slug}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className={cn(cellBorder)}>
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              {chainIcon ? (
                                <Image
                                  src={chainIcon}
                                  alt=""
                                  width={16}
                                  height={16}
                                  className="rounded-full"
                                  unoptimized
                                />
                              ) : null}
                              <span className="text-xs">
                                {a.chainId === SOLANA_CHAIN_ID ? "Solana" : a.chainId}
                              </span>
                            </span>
                          </td>
                          <td className={cn(cellBorder, "text-right font-mono tabular-nums text-emerald-200/90")}>
                            {Math.round(a.score)}
                          </td>
                          <td className={cn(cellBorder, "text-right font-mono tabular-nums text-muted-foreground")}>
                            {oobeRep ?? "—"}
                          </td>
                          <td className={cn(cellBorder, "whitespace-nowrap text-muted-foreground tabular-nums text-[11px]")}>
                            {a.sapRegisteredAt ? formatIsoUtcDateLabel(a.sapRegisteredAt) : "—"}
                          </td>
                          <td className={cn(cellBorder)}>
                            <SapAgentRowLinks agent={a} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {query.trim() && filtered.length === 0 ? (
            <p className="border-t border-border/50 px-4 py-4 text-center text-sm text-muted-foreground sm:px-6">
              No agents match your search.
            </p>
          ) : null}
          {liveAgentsListError ? (
            <p className="mx-4 text-[11px] text-amber-200/90 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 sm:mx-6">
              OOBE agent list warning: {liveAgentsListError} — OOBE rep column may be incomplete.
            </p>
          ) : null}
          {notIndexedFromApiCount > 0 ? (
            <div
              role="status"
              className="mx-4 rounded-lg border border-teal-500/25 bg-teal-950/15 px-3 py-2.5 text-[11px] text-muted-foreground sm:mx-6"
            >
              <span className="font-medium text-teal-100/90">{notIndexedFromApiCount}</span> agent
              {notIndexedFromApiCount === 1 ? " appears" : "s appear"} on the OOBE Explorer API but are not in this
              AgentRanking snapshot yet. {" "}
              <span className="font-medium">Run the authenticated SAP sync action</span> to mirror them.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}