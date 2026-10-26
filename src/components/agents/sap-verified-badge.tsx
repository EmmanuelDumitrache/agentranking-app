"use client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Hexagon } from "lucide-react";
const OOBE_EXPLORER_BASE = "https://explorer.oobeprotocol.ai";
export function oobeExplorerAccountUrl(pda: string): string {
  return `${OOBE_EXPLORER_BASE}/account/${encodeURIComponent(pda)}`;
}
export function SapVerifiedBadge({
  sapAgentPda,
  className,
  compact,
}: {
  readonly sapAgentPda: string;
  readonly className?: string;
  readonly compact?: boolean;
}) {
  const href = oobeExplorerAccountUrl(sapAgentPda);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn("inline-flex shrink-0", className)}
          >
            <Badge
              variant="outline"
              className={cn(
                "gap-1 border-emerald-500/50 bg-emerald-950/40 text-emerald-300 shadow-[0_0_12px_-4px_rgba(16,185,129,0.5)]",
                "hover:bg-emerald-900/50 hover:text-emerald-200",
                compact ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs font-semibold"
              )}
            >
              <Hexagon className={cn("text-emerald-400", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
              SAP Verified
            </Badge>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs border-border bg-card text-card-foreground">
          Identity verified on Synapse Agent Protocol
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}