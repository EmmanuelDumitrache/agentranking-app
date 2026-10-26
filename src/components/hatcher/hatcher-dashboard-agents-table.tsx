"use client";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, FileText, MessageCircle, Server } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { HATCHER_DISCOVERY_SCORE_LABEL } from "@/lib/hatcher/config";
import { hatcherProfilePath } from "@/lib/hatcher/paths";
import type { HatcherDashboardAgentRow } from "@/lib/hatcher/dashboard-types";
import { HATCHER_LOGO_SRC } from "@/lib/hatcher/urls";
function formatFramework(fw: string | undefined): string {
  if (!fw?.trim()) return "—";
  const s = fw.trim();
  if (s.toLowerCase() === "openclaw") return "OpenClaw";
  if (s.toLowerCase() === "hermes") return "Hermes";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function formatStatus(status: string | undefined): string {
  if (!status?.trim()) return "—";
  const s = status.toLowerCase();
  if (s === "active" || s === "running") return "Active";
  if (s === "sleeping" || s === "dormant") return "Sleeping";
  return status;
}
function statusDotClass(status: string | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "active" || s === "running") return "bg-emerald-400";
  return "bg-muted-foreground/50";
}
export function HatcherDashboardAgentsTable({
  agents,
  emptyMessage = "No agents match your filters.",
}: {
  readonly agents: HatcherDashboardAgentRow[];
  readonly emptyMessage?: string;
}) {
  const stickyCell =
    "sticky left-0 z-10 border-r border-border/60 bg-card shadow-[2px_0_8px_-4px_rgba(0,0,0,0.45)]";
  const cellBorder = "border border-border/45 px-2 py-1.5 align-middle text-[11px]";
  return (
    <Card className="border-border/80 border-emerald-500/20 bg-card/50 overflow-hidden">
      <CardHeader className="space-y-2 border-b border-border/35 px-3 py-2 sm:px-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
            <Image
              src={HATCHER_LOGO_SRC}
              alt=""
              width={16}
              height={16}
              className="h-4 w-4 object-contain rounded-full"
              unoptimized
            />
            Hatcher directory
          </CardTitle>
          <Link
            href="/agents?hatcher=true"
            className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
          >
            Open full directory →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className={cn(stickyCell, cellBorder, "min-w-[180px]")}>Agent</th>
                <th className={cellBorder}>Framework</th>
                <th className={cellBorder}>Status</th>
                <th className={cellBorder}>{HATCHER_DISCOVERY_SCORE_LABEL}</th>
                <th className={cn(cellBorder, "text-right")}>Messages</th>
                <th className={cellBorder}>Passport</th>
                <th className={cellBorder}>MCP</th>
                <th className={cellBorder}>Links</th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                agents.map((row) => {
                  const snap = row.hatcher.hatcher;
                  const href = hatcherProfilePath(row.agentId, row.name);
                  const passportSnap = snap?.passportSnapshot;
                  const mcpSnap = snap?.mcpManifestSnapshot;
                  const passportOk = passportSnap != null && typeof passportSnap === "object";
                  const mcpOk = mcpSnap != null && typeof mcpSnap === "object";
                  const links = snap?.links;
                  return (
                    <tr key={row.id} className="border-b border-border/30 hover:bg-muted/10">
                      <td className={cn(stickyCell, cellBorder)}>
                        <Link href={href} className="flex items-center gap-2 min-w-0 group">
                          <AgentAvatar
                            image={row.image}
                            name={row.name}
                            size="sm"
                            className="h-7 w-7 shrink-0"
                          />
                          <div className="min-w-0">
                            <span className="flex items-center gap-1.5 truncate font-medium group-hover:text-emerald-400">
                              <span
                                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(snap?.status))}
                                aria-hidden
                              />
                              {row.name}
                            </span>
                            <span className="block truncate text-[9px] text-muted-foreground font-mono">
                              {snap?.publicId ?? snap?.slug ?? row.slug}
                            </span>
                          </div>
                        </Link>
                      </td>
                      <td className={cellBorder}>{formatFramework(snap?.framework)}</td>
                      <td className={cellBorder}>
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                            snap?.status === "active" || snap?.status === "running"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {formatStatus(snap?.status)}
                        </span>
                      </td>
                      <td className={cn(cellBorder, "tabular-nums font-semibold text-emerald-400/90")}>
                        {row.hatcher.partnerScore}
                      </td>
                      <td className={cn(cellBorder, "text-right tabular-nums")}>
                        {snap?.messageCount ?? 0}
                      </td>
                      <td className={cellBorder}>{passportOk ? "Yes" : "—"}</td>
                      <td className={cellBorder}>{mcpOk ? "Yes" : "—"}</td>
                      <td className={cellBorder}>
                        <div className="flex items-center gap-0.5">
                            {links?.chat ? (
                              <a
                                href={links.chat}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-0.5 text-muted-foreground hover:text-emerald-400"
                                aria-label="Chat on Hatcher"
                              >
                                <MessageCircle className="h-3 w-3" />
                              </a>
                            ) : null}
                            {passportOk && links?.passport ? (
                              <a
                                href={links.passport}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-0.5 text-muted-foreground hover:text-emerald-400"
                                aria-label="Passport"
                              >
                                <FileText className="h-3 w-3" />
                              </a>
                            ) : null}
                            {mcpOk && links?.mcpManifest ? (
                              <a
                                href={links.mcpManifest}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-0.5 text-muted-foreground hover:text-emerald-400"
                                aria-label="MCP manifest"
                              >
                                <Server className="h-3 w-3" />
                              </a>
                            ) : null}
                            {links?.profile ? (
                              <a
                                href={links.profile}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-0.5 text-muted-foreground hover:text-emerald-400"
                                aria-label="Hatcher profile"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-[10px] text-muted-foreground border-t border-border/30">
          Partner source — indexed from Hatcher&apos;s public feed, not an on-chain registry.
        </p>
      </CardContent>
    </Card>
  );
}
