"use client";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
export type ReputationScoreBadgeSize = "xs" | "sm" | "md";
const SIZE_CLASSES: Record<ReputationScoreBadgeSize, { wrap: string; icon: string; text: string }> = {
  xs: { wrap: "px-1.5 py-0.5 text-[10px] gap-0.5", icon: "h-2.5 w-2.5", text: "text-[10px]" },
  sm: { wrap: "px-1.5 py-0.5 text-[10px] gap-0.5", icon: "h-2.5 w-2.5", text: "text-[10px]" },
  md: { wrap: "px-2 py-0.5 text-xs gap-1", icon: "h-3.5 w-3.5", text: "text-sm" },
};
export interface ReputationScoreBadgeProps {
  readonly score: number;
  readonly className?: string;
  readonly title?: string;
  readonly size?: ReputationScoreBadgeSize;
  readonly showIcon?: boolean;
  readonly bold?: boolean;
}
export function ReputationScoreBadge({
  score,
  className,
  title = "Reputation score",
  size = "sm",
  showIcon = true,
  bold = false,
}: ReputationScoreBadgeProps) {
  const n = Math.round(score);
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = SIZE_CLASSES[size];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-amber-500/25 bg-amber-500/10 font-semibold text-amber-300",
        s.wrap,
        bold && size === "md" && "font-bold text-amber-400",
        className,
      )}
      title={title}
    >
      {showIcon ? <ShieldCheck className={cn("shrink-0", s.icon)} aria-hidden /> : null}
      <span className={cn("tabular-nums", s.text)}>{n}</span>
    </span>
  );
}
