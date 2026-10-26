"use client";
import { Briefcase } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
export type WorkReadyBadgeInput = {
  workReadyStatus?: string | null;
  featuredWorkReady?: boolean | null;
};
const WORK_READY_TOOLTIP =
  "Verified agent with enough profile, ownership, capability, and endpoint/contact signals to be surfaced for work opportunities.";
export function shouldShowPublicWorkReadyBadge(agent: WorkReadyBadgeInput): boolean {
  if (agent.featuredWorkReady) return true;
  return agent.workReadyStatus === "approved";
}
export function isFeaturedWorkReady(agent: WorkReadyBadgeInput): boolean {
  return Boolean(agent.featuredWorkReady);
}
type Props = {
  readonly agent: WorkReadyBadgeInput;
  readonly variant?: "compact" | "full";
  readonly className?: string;
};
export function WorkReadyBadge({ agent, variant = "compact", className }: Props) {
  if (!shouldShowPublicWorkReadyBadge(agent)) return null;
  const featured = isFeaturedWorkReady(agent);
  const label = featured ? "Featured Work Ready" : "Work Ready";
  const pill = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        featured
          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        variant === "compact" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        className,
      )}
    >
      {variant === "full" ? <Briefcase className="h-3 w-3 shrink-0" aria-hidden /> : null}
      {label}
    </span>
  );
  if (variant === "compact") {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-default">{pill}</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            {WORK_READY_TOOLTIP}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default">{pill}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {WORK_READY_TOOLTIP}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}