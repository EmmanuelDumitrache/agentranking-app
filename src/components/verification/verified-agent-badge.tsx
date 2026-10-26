"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RiskTier } from "@/lib/verification/providers/types";

const TIER_STYLES: Record<RiskTier, string> = {
  UNRATED: "border-white/15 bg-white/5 text-white/50",
  BASIC: "border-white/20 bg-white/8 text-white/70",
  STANDARD: "border-sky-400/35 bg-sky-400/10 text-sky-100",
  ELEVATED: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  PRIVILEGED: "border-emerald-300/45 bg-emerald-300/10 text-emerald-100",
};

export function VerifiedAgentBadge({
  tier,
  score,
  href,
  compact = false,
  className,
}: {
  readonly tier: RiskTier;
  readonly score?: number;
  readonly href?: string;
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const body = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        TIER_STYLES[tier],
        className,
      )}
      title={score !== undefined ? `Risk score ${score}` : "Verified Agent passport"}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {compact ? tier : `Verified · ${tier}`}
      {score !== undefined && !compact ? (
        <span className="tabular-nums opacity-70 normal-case">{score}</span>
      ) : null}
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex no-underline hover:opacity-90">
        {body}
      </Link>
    );
  }
  return body;
}
