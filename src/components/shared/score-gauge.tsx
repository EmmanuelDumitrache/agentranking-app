"use client";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
interface ScoreGaugeProps {
  score: number;
  label?: string;
  size?: "sm" | "md" | "lg";
  /** Score delta over last 7 days — positive = up, negative = down, 0/undefined = unchanged */
  delta7d?: number | null;
  className?: string;
  /** Hover disclaimer (Radix tooltip — avoids native `title` + cursor-help “?” cursor). */
  title?: string;
}
function getGaugeColor(score: number): string {
  if (score >= 71) return "rgba(255, 255, 255, 0.88)";
  if (score >= 41) return "rgba(255, 255, 255, 0.55)";
  return "rgba(255, 255, 255, 0.22)";
}
function getGaugeTrackColor(score: number): string {
  if (score >= 71) return "rgba(255, 255, 255, 0.08)";
  if (score >= 41) return "rgba(255, 255, 255, 0.06)";
  return "rgba(255, 255, 255, 0.04)";
}
export function ScoreGauge({ score, label, size = "md", delta7d, className, title }: Readonly<ScoreGaugeProps>) {
  const dimensions = {
    sm: { svgSize: 56, strokeWidth: 4, fontSize: "text-sm", labelSize: "text-[9px]" },
    md: { svgSize: 80, strokeWidth: 5, fontSize: "text-xl", labelSize: "text-[10px]" },
    lg: { svgSize: 100, strokeWidth: 6, fontSize: "text-2xl", labelSize: "text-xs" },
  }[size];
  const { svgSize, strokeWidth, fontSize, labelSize } = dimensions;
  const radius = (svgSize - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.max(0, Math.min(100, score));
  const offset = circumference - (clampedScore / 100) * circumference;
  const color = getGaugeColor(clampedScore);
  const trackColor = getGaugeTrackColor(clampedScore);
  const center = svgSize / 2;
  const momentumIcon = (() => {
    if (delta7d == null) return null;
    if (delta7d > 0) return <TrendingUp className="h-3 w-3 text-white/70" />;
    if (delta7d < 0) return <TrendingDown className="h-3 w-3 text-red-400" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  })();
  const gaugeRing = (
    <>
      <svg
        width={svgSize}
        height={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className={cn("font-bold tabular-nums leading-none", fontSize)} style={{ color }}>
          {clampedScore > 0 ? Math.round(clampedScore) : "—"}
        </span>
        {momentumIcon && <span className="mt-0.5">{momentumIcon}</span>}
      </div>
    </>
  );
  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      {title ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="relative inline-flex cursor-default items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Score explanation"
              >
                {gaugeRing}
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={6}
              className="max-w-[min(22rem,calc(100vw-2rem))] text-left text-xs font-normal normal-case leading-snug text-balance px-3 py-2"
            >
              {title}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <div className="relative inline-flex items-center justify-center">{gaugeRing}</div>
      )}
      {label && (
        <span className={cn("text-muted-foreground font-medium", labelSize)}>{label}</span>
      )}
    </div>
  );
}