"use client";
import { cn } from "@/lib/utils";
import { BadgeCheck, Sparkles } from "lucide-react";
export type VerifiedBadgeVariant = "gold" | "neutral" | "sm";
const variantClasses: Record<VerifiedBadgeVariant, string> = {
  gold: "border-amber-400/60 bg-amber-500/10 text-amber-300 shadow-[0_0_12px_-4px_rgba(245,158,11,0.4)]",
  neutral: "border-emerald-500/50 bg-emerald-950/40 text-emerald-300",
  sm: "border-amber-400/50 bg-amber-500/10 text-amber-300 px-1 py-0 text-[10px]",
};
const iconSizes: Record<VerifiedBadgeVariant, string> = {
  gold: "h-3.5 w-3.5",
  neutral: "h-3.5 w-3.5",
  sm: "h-3 w-3",
};
const labelClasses: Record<VerifiedBadgeVariant, string> = {
  gold: "text-xs font-semibold",
  neutral: "text-xs font-semibold",
  sm: "text-[10px] font-medium",
};
type Props = {
  variant?: VerifiedBadgeVariant;
  className?: string;
  showLabel?: boolean;
  iconOnly?: boolean;
};
export function VerifiedBadge({ variant = "gold", className, showLabel = true, iconOnly = false }: Props) {
  const classes = variantClasses[variant];
  const iconSize = iconSizes[variant];
  if (iconOnly) {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center rounded-full p-0.5", classes, className)}
        title="Verified"
      >
        <BadgeCheck className={cn(iconSize, variant === "gold" ? "text-amber-400" : "text-emerald-400")} strokeWidth={2.25} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        classes,
        className,
      )}
      title="Verified"
    >
      {variant === "gold" ? (
        <Sparkles className={cn(iconSize, "text-amber-400")} />
      ) : (
        <BadgeCheck className={cn(iconSize, "text-emerald-400")} strokeWidth={2.25} />
      )}
      {showLabel && <span className={labelClasses[variant]}>Verified</span>}
    </span>
  );
}
/** Verification tick — foreground in app chrome; optional gold for legacy marketing surfaces. */
export function VerifiedTick({
  size = "md",
  tone = "foreground",
  className,
}: {
  size?: "sm" | "md" | "lg";
  tone?: "gold" | "foreground";
  className?: string;
}) {
  const sizes = { sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-5 w-5" };
  return (
    <span className={cn("inline-flex shrink-0", className)} title="AgentRanking Verified">
      <BadgeCheck
        className={cn(
          sizes[size],
          tone === "gold"
            ? "text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]"
            : "text-foreground",
        )}
        strokeWidth={2.25}
      />
    </span>
  );
}
/** Gold token verified pill — smaller, for tokens. */
export function TokenVerifiedPill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-amber-400/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300",
        className,
      )}
      title="Token Verified"
    >
      <BadgeCheck className="h-2.5 w-2.5 text-amber-400" strokeWidth={2.5} />
      Token
    </span>
  );
}
