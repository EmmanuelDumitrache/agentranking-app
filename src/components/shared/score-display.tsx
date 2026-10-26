"use client";
import { getScoreColor } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
interface ScoreDisplayProps {
  score: number;
  showTrend?: boolean;
  size?: "sm" | "md" | "lg";
}
export function ScoreDisplay({ score, showTrend = false, size = "sm" }: ScoreDisplayProps) {
  const colorClass = getScoreColor(score);
  const sizeClass = size === "lg" ? "text-2xl" : size === "md" ? "text-base" : "text-sm";
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${colorClass} ${sizeClass}`}>
      {showTrend && (
        score > 70 ? <TrendingUp className="h-3 w-3" /> :
        score > 40 ? <Minus className="h-3 w-3" /> :
        <TrendingDown className="h-3 w-3" />
      )}
      {score.toFixed(1)}
    </span>
  );
}