"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import {
  getAgentListStatusBadges,
  type AgentListBadge,
  type AgentListBadgeInput,
} from "@/lib/agent-list-status-badges";
import { cn, getScoreColor } from "@/lib/utils";
import type { MetaplexAgentCardRow } from "@/components/metaplex/metaplex-agent-card";
const BADGE_PRIORITY: Record<string, number> = {
  metaplexBoundToken: 0,
  metaplexRegistered: 1,
  metaplex: 2,
  mcp: 3,
  x402: 4,
  verified: 5,
  unverified: 99,
};
function shortenAddress(value: string | null | undefined, chars = 4): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.length <= chars * 2 + 3) return v;
  return `${v.slice(0, chars)}…${v.slice(-chars)}`;
}
function pickMetaplexRowBadges(agent: AgentListBadgeInput): AgentListBadge[] {
  const all = getAgentListStatusBadges(agent);
  const hasMetaplexSignal = all.some((b) =>
    ["metaplex", "metaplexRegistered", "metaplexBoundToken"].includes(b.id),
  );
  const filtered = hasMetaplexSignal
    ? all.filter((b) => b.id !== "unverified" && b.id !== "metaplex")
    : all.filter((b) => b.id !== "metaplex");
  return [...filtered]
    .sort((a, b) => (BADGE_PRIORITY[a.id] ?? 50) - (BADGE_PRIORITY[b.id] ?? 50))
    .slice(0, 2);
}
function firstServiceLabel(services: Array<{ name: string }> | undefined): string | null {
  const name = services?.[0]?.name?.trim();
  if (!name) return null;
  return name.toUpperCase();
}
export function MetaplexAgentListRow({
  agent,
}: {
  readonly agent: MetaplexAgentCardRow & {
    rank?: number;
    isVerified?: boolean;
    isPremiumVerified?: boolean;
    listingRegistrySource?: string | null;
  };
}) {
  const href = agent.profilePath;
  const badges = pickMetaplexRowBadges(agent);
  const asset = shortenAddress(agent.metaplexAssetAddress);
  const serviceLabel = firstServiceLabel(agent.services);
  const description = agent.description?.trim() ?? "";
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-start gap-3 border-l-2 border-transparent px-3 py-3 transition-colors sm:items-center sm:px-4",
        "hover:border-violet-500/40 hover:bg-violet-500/5",
      )}
    >
      <AgentAvatar
        name={agent.name}
        image={agent.image}
        size="sm"
        className="h-8 w-8 shrink-0 rounded-md"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-1.5">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground group-hover:text-violet-100">
            {agent.name}
          </span>
          {description ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground sm:before:mr-1.5 sm:before:text-muted-foreground/50 sm:before:content-['·']">
              {description}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {asset ? (
            <span className="rounded border border-border/45 bg-background/45 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Asset {asset}
            </span>
          ) : null}
          {serviceLabel ? (
            <span className="shrink-0 rounded border border-sky-500/30 bg-sky-950/25 px-1 py-px text-[9px] font-medium uppercase tracking-tight text-sky-200/90">
              {serviceLabel}
            </span>
          ) : null}
          {badges.map((b) => (
            <span
              key={b.id}
              className={cn(
                "shrink-0 rounded-full border px-1.5 py-px text-[9px] font-medium leading-tight",
                b.className,
              )}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/45 bg-background/45 px-2 py-1">
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            getScoreColor(agent.agentRankScore),
          )}
        >
          {agent.agentRankScore.toFixed(1)}
        </span>
        <ChevronRight
          className="size-4 text-muted-foreground/50 transition-colors group-hover:text-violet-300/80"
          aria-hidden
        />
      </div>
    </Link>
  );
}
