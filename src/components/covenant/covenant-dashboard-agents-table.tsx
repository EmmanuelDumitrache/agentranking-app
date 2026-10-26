"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Hexagon } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { getChainByChainId } from "@/lib/chains";
import type { CovenantDashboardAgentRow } from "@/lib/covenant/covenant-dashboard";
import { covenantPartnerVerificationStatusLabel } from "@/lib/covenant/ui-copy";
import { COVENANT_LOGO_SRC } from "@/lib/covenant/urls";
import { SapListingChip } from "@/components/agents/sap-tag";
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
function formatIsoUtcDateLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
function truncateRoot(hex: string | null | undefined): string {
  if (!hex?.trim()) return "—";
  const h = hex.trim();
  if (h.length <= 18) return h;
  return `${h.slice(0, 10)}…${h.slice(-8)}`;
}
export function CovenantDashboardAgentsTable({
  agents,
}: {
  readonly agents: CovenantDashboardAgentRow[];
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const pda = a.sapAgentPda?.toLowerCase() ?? "";
      return (
        a.name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        String(a.agentId).includes(q) ||
        String(a.chainId).includes(q) ||
        pda.includes(q)
      );
    });
  }, [agents, query]);
  const stickyCell =
    "sticky left-0 z-10 border-r border-border/60 bg-card shadow-[2px_0_8px_-4px_rgba(0,0,0,0.45)]";
  const cellBorder = "border border-border/45 px-2 py-2 align-middle text-xs sm:px-3";
  return (
    <Card className="border-border/80 border-teal-500/20 bg-card/50 overflow-hidden">
      <CardHeader className="space-y-2 border-b border-border/35 px-3 py-2.5 sm:px-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
            <Image
              src={COVENANT_LOGO_SRC}
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 object-contain invert brightness-200"
              unoptimized
            />
            Covenant agents
          </CardTitle>
          <Link
            href="/agents?covenant=true"
            className="text-[11px] font-medium text-teal-400 hover:text-teal-300"
          >
            Open full directory →
          </Link>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, slug, PDA, or ID…"
          className="h-8 max-w-md bg-background/60 text-xs"
          aria-label="Search Covenant agents"
        />
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className={cn(stickyCell, cellBorder, "min-w-[200px]")}>Agent</th>
                <th className={cellBorder}>Chain</th>
                <th className={cellBorder}>Registry</th>
                <th className={cellBorder}>Runtime</th>
                <th className={cellBorder}>Verification</th>
                <th className={cellBorder}>Audit root</th>
                <th className={cellBorder}>x402</th>
                <th className={cellBorder}>AR score</th>
                <th className={cellBorder}>Last verified</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {agents.length === 0
                      ? "No Covenant agents indexed yet."
                      : "No agents match your search."}
                  </td>
                </tr>
              ) : (
                filtered.map((agent, idx) => {
                  const chain = getChainByChainId(agent.chainId);
                  const verification = covenantPartnerVerificationStatusLabel(agent.covenant);
                  return (
                    <tr
                      key={agent.id}
                      className={cn(
                        "hover:bg-muted/15",
                        idx % 2 === 1 ? "bg-muted/[0.03]" : undefined,
                      )}
                    >
                      <td className={cn(stickyCell, cellBorder)}>
                        <Link
                          href={agent.profilePath}
                          className="flex min-w-0 items-center gap-2 group"
                        >
                          <AgentAvatar
                            image={agent.image}
                            name={agent.name}
                            size="sm"
                            className="!h-8 !w-8 shrink-0"
                            loading="lazy"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium group-hover:text-teal-300">
                              {agent.name}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-muted-foreground">
                              {agent.slug}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className={cellBorder}>
                        {chain ? (
                          <AgentListChainCell
                            chainId={agent.chainId}
                            chain={chain}
                            icon={chain.icon}
                            size="sm"
                          />
                        ) : (
                          <span className="font-mono text-[10px]">
                            {agent.chainId === SOLANA_CHAIN_ID ? "SOL" : agent.chainId}
                          </span>
                        )}
                      </td>
                      <td className={cellBorder}>
                        <SapListingChip />
                      </td>
                      <td className={cellBorder}>
                        <span className="inline-flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-200">
                          <Image
                            src={COVENANT_LOGO_SRC}
                            alt=""
                            width={12}
                            height={12}
                            className="h-3 w-3 invert brightness-200"
                            unoptimized
                          />
                          Covenant Runtime
                        </span>
                      </td>
                      <td className={cellBorder}>
                        <span className="text-[11px] font-medium">{verification}</span>
                      </td>
                      <td className={cellBorder}>
                        <span
                          className="font-mono text-[10px] text-muted-foreground"
                          title={agent.covenant.rootHashHex ?? undefined}
                        >
                          {truncateRoot(agent.covenant.rootHashHex)}
                        </span>
                      </td>
                      <td className={cellBorder}>
                        {agent.x402Support ? (
                          <span className="text-emerald-400/90">Yes</span>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </td>
                      <td className={cellBorder}>
                        <span className="font-mono tabular-nums">{Math.round(agent.agentRankScore)}</span>
                      </td>
                      <td className={cellBorder}>
                        <span className="tabular-nums text-[11px] text-muted-foreground">
                          {formatIsoUtcDateLabel(agent.covenant.rootCheckedAt ?? null)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 ? (
          <p className="border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground flex items-center gap-1">
            <Hexagon className="h-3 w-3 text-teal-400/80" aria-hidden />
            Indexed via SAP · Covenant verification is separate from SAP owner KYA
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
