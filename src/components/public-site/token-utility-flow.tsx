"use client";
import Link from "next/link";
import { STAKE_PAGE_HREF } from "@/lib/stake-page-href";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "motion/react";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TokenUtilitySlice } from "@/lib/agent-economy-preview-data";
import { cn } from "@/lib/utils";
import styles from "@/components/public-site/public-feature-page.module.css";
export function TokenUtilityFlow({
  slices,
  disclaimer = "Illustrative planned utility — not live on-chain allocation.",
  className,
}: {
  readonly slices: TokenUtilitySlice[];
  readonly disclaimer?: string;
  readonly className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [intersected, setIntersected] = useState(false);
  const reducedMotion = useReducedMotion();
  const visible = Boolean(reducedMotion) || intersected;
  useEffect(() => {
    const node = ref.current;
    if (!node || reducedMotion) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIntersected(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion]);
  return (
    <div ref={ref} className={cn("rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 md:p-6", className)}>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/15 text-amber-300 font-bold text-sm",
            styles.arCoinPulse,
          )}
        >
          AR
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm flex items-center gap-1.5">
            <Coins className="h-4 w-4 text-amber-400 shrink-0" aria-hidden />
            $AR utility flow
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{disclaimer}</p>
        </div>
      </div>
      <div className="flex md:hidden h-2.5 w-full overflow-hidden rounded-full bg-muted/50 gap-px mb-2">
        {slices.map((slice) => (
          <div
            key={`mobile-${slice.id}`}
            className={cn("h-full opacity-90", slice.colorClass)}
            style={{
              width: visible ? `${slice.pct}%` : "0%",
              transition: "width 1.1s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        ))}
      </div>
      <div className="hidden md:flex h-3 w-full overflow-hidden rounded-full bg-muted/50 gap-0.5">
        {slices.map((slice) => (
          <div
            key={slice.id}
            className={cn("h-full opacity-90", slice.colorClass)}
            style={{
              width: visible ? `${slice.pct}%` : "0%",
              transition: "width 1.1s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        ))}
      </div>
      <ul className="mt-6 space-y-4">
        {slices.map((slice) => (
          <li key={slice.id}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{slice.label}</span>
              <span className="tabular-nums text-xs text-muted-foreground shrink-0">{slice.pct}%</span>
            </div>
            <div className={cn(styles.tokenBarTrack, "mt-2")}>
              <div
                className={cn(styles.tokenBarFill, slice.colorClass, visible && styles.tokenBarFillVisible)}
                style={{ "--token-pct": `${slice.pct}%` } as CSSProperties}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{slice.description}</p>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-col sm:flex-row flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="w-full sm:w-auto min-h-11 sm:min-h-9">
          <Link href="/docs/ar-token">$AR docs</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="w-full sm:w-auto min-h-11 sm:min-h-9">
          <a href={STAKE_PAGE_HREF}>Stake $AR</a>
        </Button>
        <Button asChild variant="outline" size="sm" className="w-full sm:w-auto min-h-11 sm:min-h-9">
          <Link href="/docs/ar-token">Token hub</Link>
        </Button>
      </div>
    </div>
  );
}
