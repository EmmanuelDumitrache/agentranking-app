"use client";
import Link from "next/link";
import { AlertTriangle, BadgeCheck } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { WorkReadyBadge } from "@/components/jobs/work-ready-badge";
interface AgentNameWithRankProps {
  readonly name: string;
  readonly rank?: number | null;
  readonly image?: string | null;
  readonly chainId: number;
  readonly agentId: number;
  readonly showAvatar?: boolean;
  readonly href?: string;
  readonly className?: string;
  readonly nameClassName?: string;
  readonly rankClassName?: string;
  readonly hasDuplicateName?: boolean;
  readonly isVerified?: boolean;
  readonly isPremiumVerified?: boolean;
  readonly workReadyStatus?: string;
  readonly featuredWorkReady?: boolean;
}
export function AgentNameWithRank({
  name,
  rank,
  image,
  showAvatar = true,
  href,
  className = "",
  nameClassName = "font-medium text-sm hover:text-primary transition-colors",
  rankClassName = "text-[10px] text-muted-foreground",
  hasDuplicateName = false,
  isVerified = false,
  isPremiumVerified = false,
  workReadyStatus,
  featuredWorkReady,
}: AgentNameWithRankProps) {
  const goldenStyle = isPremiumVerified
    ? {
        background: "linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b)",
        WebkitBackgroundClip: "text" as const,
        WebkitTextFillColor: "transparent" as const,
        fontWeight: 700,
      }
    : undefined;
  const content = (
    <div className={className || "flex flex-col gap-0.5"}>
      <div className="flex items-center gap-2 min-w-0">
        {showAvatar && (
          <AgentAvatar image={image} name={name} size="sm" className="rounded-lg shrink-0" />
        )}
        {hasDuplicateName && !isPremiumVerified && (
          <span
            className="inline-flex items-center shrink-0 text-amber-500 cursor-help group relative"
            title="Verify before using — another agent with this name exists; this may be a copy."
          >
            <AlertTriangle className="h-3 w-3" />
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block whitespace-nowrap rounded bg-popover border border-border px-2 py-1 text-[10px] text-muted-foreground shadow-lg z-50">
              Duplicate name — verify before using
            </span>
          </span>
        )}
        {(isPremiumVerified || isVerified) && (
          <span
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-amber-500"
            title={isPremiumVerified ? "KYA Verified" : "Verified"}
          >
            <BadgeCheck className="h-4 w-4" />
          </span>
        )}
        <WorkReadyBadge
          agent={{ workReadyStatus, featuredWorkReady }}
          variant="compact"
        />
        <span className={`${nameClassName} truncate`} style={goldenStyle}>{name}</span>
      </div>
      {rank != null && rank > 0 && (
        <span className={rankClassName}>Rank #{rank.toLocaleString()}</span>
      )}
    </div>
  );
  if (href !== undefined) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }
  return content;
}
