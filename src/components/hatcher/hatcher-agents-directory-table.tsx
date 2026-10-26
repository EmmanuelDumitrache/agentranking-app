"use client";
import Link from "next/link";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { cn, timeAgo } from "@/lib/utils";
import { HATCHER_INDEXED_BADGE_LABEL, HATCHER_PARTNER_SOURCE_LABEL } from "@/lib/hatcher/config";
import { getHatcherListDisplayFields } from "@/lib/hatcher/list-display";
type HatcherDirectoryAgent = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string;
  slug?: string | null;
  profilePath: string;
  score: number;
  listedAt?: string | null;
  createdAt: string;
  metadata?: Array<{ key: string; value: string }>;
};
function formatStatusLabel(status: string, normalized: string): string {
  if (normalized === "active") return "Active";
  if (normalized === "sleeping") return "Sleeping";
  return status || "—";
}
export function HatcherAgentsDirectoryTable({
  agents,
}: {
  readonly agents: HatcherDirectoryAgent[];
}) {
  const cell = "border border-border/40 px-2 py-1.5 align-middle text-[11px]";
  return (
    <div className="overflow-x-auto rounded-lg border border-emerald-500/20">
      <table className="w-full min-w-[880px] border-collapse text-left">
        <thead>
          <tr className="bg-muted/25 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className={cn(cell, "min-w-[180px]")}>Agent</th>
            <th className={cell}>Partner</th>
            <th className={cell}>Status</th>
            <th className={cell}>Framework</th>
            <th className={cell}>Discovery</th>
            <th className={cn(cell, "text-right")}>Messages</th>
            <th className={cell}>Passport</th>
            <th className={cell}>MCP</th>
            <th className={cn(cell, "text-right")}>Age</th>
          </tr>
        </thead>
        <tbody>
          {agents.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                No Hatcher agents found.
              </td>
            </tr>
          ) : (
            agents.map((agent) => {
              const fields = getHatcherListDisplayFields({
                metadata: agent.metadata,
                score: agent.score,
              });
              const href = agent.profilePath;
              const ageSource = agent.listedAt ?? agent.createdAt;
              return (
                <tr key={`${agent.chainId}-${agent.agentId}`} className="border-t border-border/30 hover:bg-muted/10">
                  <td className={cell}>
                    <Link href={href} className="flex items-center gap-2 min-w-0 group">
                      <AgentAvatar image={agent.image} name={agent.name} size="sm" className="h-7 w-7" />
                      <div className="min-w-0">
                        <span className="block truncate font-medium group-hover:text-emerald-400">{agent.name}</span>
                        <span className="block text-[9px] text-emerald-400/80">{HATCHER_INDEXED_BADGE_LABEL}</span>
                      </div>
                    </Link>
                  </td>
                  <td className={cell}>
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                      {HATCHER_PARTNER_SOURCE_LABEL}
                    </span>
                  </td>
                  <td className={cell}>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                        fields.statusNormalized === "active"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-muted/60 text-muted-foreground",
                      )}
                    >
                      {formatStatusLabel(fields.status, fields.statusNormalized)}
                    </span>
                  </td>
                  <td className={cell}>{fields.framework}</td>
                  <td className={cn(cell, "tabular-nums font-semibold text-emerald-400")}>
                    {Math.round(fields.discoveryScore)}
                  </td>
                  <td className={cn(cell, "text-right tabular-nums")}>{fields.messageCount}</td>
                  <td className={cell}>{fields.hasPassport ? "Yes" : "—"}</td>
                  <td className={cell}>{fields.hasMcp ? "Yes" : "—"}</td>
                  <td className={cn(cell, "text-right text-muted-foreground whitespace-nowrap")}>
                    {ageSource ? timeAgo(ageSource) : "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
