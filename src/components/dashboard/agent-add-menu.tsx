"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
type Props = {
  readonly agentCount?: number;
  readonly maxAgents?: number;
  /** Called when navigating to create (e.g. close mobile drawer). */
  readonly onNavigate?: () => void;
};
export function DashboardAgentAddMenu({
  agentCount = 0,
  maxAgents = 3,
  onNavigate,
}: Props) {
  const atLimit = agentCount >= maxAgents;
  const limitHint = `Agent limit reached (${agentCount}/${maxAgents}). Delete an agent in Settings to create another.`;
  if (atLimit) {
    return (
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-md border-border/80 opacity-40"
                aria-label={limitHint}
                disabled
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[240px] text-xs leading-relaxed">
            {limitHint}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <Button
      variant="outline"
      size="icon"
      className="h-7 w-7 shrink-0 rounded-md border-border/80"
      aria-label="Create agent"
      asChild
    >
      <Link href="/dashboard/agents/new" onClick={onNavigate}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </Button>
  );
}
