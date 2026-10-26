import type { TokenGraduationDisplay } from "@/lib/public-site/token-graduation";
import { cn } from "@/lib/utils";
type Props = {
  readonly graduation: TokenGraduationDisplay;
  readonly compact?: boolean;
  readonly title?: string;
  readonly tone?: "robinhood" | "solana" | "neutral";
  readonly featured?: boolean;
  readonly className?: string;
};
/** Keep a hairline fill visible even at true 0% so the bar never looks broken/empty. */
const MIN_VISIBLE_PCT = 0.8;
const TONES = {
  robinhood: {
    text: "text-amber-500 dark:text-amber-400",
    fill: "bg-amber-500",
    fillGraduated: "bg-amber-400",
    glow: "shadow-[0_0_18px_rgba(245,158,11,0.45)]",
    pill: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
  solana: {
    text: "text-emerald-600 dark:text-emerald-400",
    fill: "bg-emerald-500",
    fillGraduated: "bg-emerald-400",
    glow: "shadow-[0_0_18px_rgba(16,185,129,0.45)]",
    pill: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  neutral: {
    text: "text-[var(--pm-accent)]",
    fill: "bg-[var(--pm-accent)]",
    fillGraduated: "bg-emerald-500",
    glow: "shadow-[0_0_16px_rgba(52,211,153,0.35)]",
    pill: "border-border/60 bg-muted/40 text-foreground",
  },
} as const;
export function TokenGraduationBar({
  graduation,
  compact = false,
  title = "Graduation",
  tone = "neutral",
  featured = false,
  className,
}: Props) {
  if (!graduation.showBar || graduation.progressPct == null) {
    return null;
  }
  const rawPct = Math.min(100, Math.max(0, graduation.progressPct));
  const widthPct =
    graduation.graduated || rawPct >= 100
      ? 100
      : Math.max(MIN_VISIBLE_PCT, rawPct);
  const colors = TONES[tone];
  const fillColor = graduation.graduated ? colors.fillGraduated : colors.fill;
  let containerClass = cn("space-y-1.5", compact ? "mt-2" : "mt-3", className);
  if (featured) {
    containerClass = cn(
      "relative overflow-hidden rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-5",
      className,
    );
  }
  const headerClass = featured
    ? "mb-3 flex-col items-center gap-1.5 text-center sm:flex-row sm:justify-between sm:gap-2"
    : "items-center justify-between";
  let trackHeight = "h-2";
  if (featured) trackHeight = "h-2.5 sm:h-3";
  else if (compact) trackHeight = "h-1.5";
  const detailClass = featured
    ? "mt-2.5 text-xs leading-relaxed text-muted-foreground sm:text-[13px]"
    : "text-[10px] text-muted-foreground opacity-70";
  return (
    <div className={cn("w-full", containerClass)}>
      <div className={cn("flex gap-2 text-xs", headerClass)}>
        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
          {title}
        </span>
        <span
          className={cn(
            "font-semibold tabular-nums",
            featured
              ? cn("rounded-full border px-2.5 py-0.5 text-[11px]", colors.pill)
              : colors.text,
          )}
        >
          {graduation.statusLabel}
        </span>
      </div>
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-[var(--app-border-soft,rgba(255,255,255,0.08))]",
          trackHeight,
          graduation.graduated && colors.glow,
        )}
      >
        <div
          className={cn(
            "relative h-full rounded-full transition-all duration-700 ease-out",
            fillColor,
            graduation.graduated && colors.glow,
          )}
          style={{ width: `${widthPct}%` }}
        >
          {graduation.graduated ? (
            <span
              className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/35 to-transparent"
              aria-hidden
            />
          ) : null}
        </div>
      </div>
      {!compact && graduation.detailLabel ? (
        <p className={cn("text-center", detailClass)}>{graduation.detailLabel}</p>
      ) : null}
    </div>
  );
}
