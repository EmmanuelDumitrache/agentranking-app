"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { ReputationScoreBadge } from "@/components/shared/reputation-score-badge";
import { useCompactPublicLayout } from "@/components/public-site/use-compact-public-layout";
import {
  GEKKO_X402_SHOWCASE,
  X402_BROWSER_LISTINGS,
} from "@/lib/agent-economy-preview-data";
import { cn } from "@/lib/utils";
import styles from "@/components/public-site/public-feature-page.module.css";
const FULL_URL = "agentranking.io/x402-market";
const FILTERS = ["All", "Trading", "x402"] as const;
type Stage = 0 | 1 | 2 | 3 | 4 | 5;
export function X402MarketBrowserDemo({
  onUrlChange,
}: {
  readonly onUrlChange?: (url: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const compact = useCompactPublicLayout();
  const skipTyping = reduceMotion || compact;
  const [animatedUrl, setAnimatedUrl] = useState("");
  const [animatedStage, setAnimatedStage] = useState<Stage>(0);
  const url = skipTyping ? FULL_URL : animatedUrl;
  const stage: Stage = skipTyping ? 5 : animatedStage;
  const [activeFilter, setActiveFilter] = useState(2);
  const syncUrl = useCallback(
    (next: string) => {
      setAnimatedUrl(next);
      onUrlChange?.(next);
    },
    [onUrlChange],
  );
  useEffect(() => {
    if (skipTyping) {
      onUrlChange?.(FULL_URL);
      return;
    }
    let typeIndex = 0;
    const typeTimer = setInterval(() => {
      typeIndex += 1;
      const next = FULL_URL.slice(0, typeIndex);
      syncUrl(next);
      if (typeIndex >= FULL_URL.length) {
        clearInterval(typeTimer);
        setTimeout(() => setAnimatedStage(1), 200);
      }
    }, 42);
    return () => clearInterval(typeTimer);
  }, [skipTyping, syncUrl, onUrlChange]);
  useEffect(() => {
    if (skipTyping || stage < 1) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (stage === 1) {
      timers.push(setTimeout(() => setActiveFilter(2), 400));
      timers.push(setTimeout(() => setAnimatedStage(2), 700));
    }
    if (stage === 2) {
      timers.push(setTimeout(() => setAnimatedStage(3), 600));
    }
    if (stage === 3) {
      timers.push(setTimeout(() => setAnimatedStage(4), 900));
    }
    if (stage === 4) {
      timers.push(setTimeout(() => setAnimatedStage(5), 800));
    }
    return () => timers.forEach(clearTimeout);
  }, [stage, skipTyping]);
  const showListings = stage >= 2;
  const showExpand = stage >= 4;
  const showCopyPulse = stage >= 5;
  const gekko = GEKKO_X402_SHOWCASE;
  const featuredCap = gekko.capabilities[0];
  const listingRows = useMemo(() => {
    const featured = X402_BROWSER_LISTINGS.find((r) => r.isFeatured);
    const peer = X402_BROWSER_LISTINGS.find((r) => !r.isFeatured);
    return [featured, peer].filter(Boolean) as typeof X402_BROWSER_LISTINGS;
  }, []);
  return (
    <div className="flex flex-col gap-3 text-left min-w-0">
      <div
        className={cn(
          "flex gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 snap-x snap-mandatory [-webkit-overflow-scrolling:touch]",
        )}
      >
        {FILTERS.map((f, i) => (
          <span
            key={f}
            className={cn(
              "shrink-0 snap-start rounded-full border px-2.5 py-1 min-h-8 inline-flex items-center text-[10px] font-medium transition-colors",
              showListings && i === activeFilter
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-border text-muted-foreground",
              showListings && i === activeFilter && styles.filterTabActive,
            )}
          >
            {f}
          </span>
        ))}
      </div>
      <div className="space-y-1.5 min-h-[8rem] sm:min-h-[140px]">
        {showListings &&
          listingRows.map((row, i) => {
            const isGekko = row.isFeatured;
            return (
              <motion.div
                key={row.id}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.35 }}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2 py-2 text-xs min-w-0",
                  isGekko && stage >= 3
                    ? "border-emerald-500/35 bg-emerald-500/10 sm:scale-[1.02]"
                    : "border-border/80 bg-card/50",
                )}
              >
                {isGekko ? (
                  <AgentAvatar image={gekko.image} name={gekko.name} size="sm" className="rounded-md shrink-0" />
                ) : (
                  <div className="h-8 w-8 shrink-0 rounded-md bg-muted/60" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{row.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{row.owner}</p>
                </div>
                {isGekko && stage >= 3 ? (
                  <ReputationScoreBadge score={row.reputation} size="xs" />
                ) : (
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{row.reputation}</span>
                )}
              </motion.div>
            );
          })}
      </div>
      {showExpand && featuredCap ? (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="rounded-lg border border-emerald-500/25 bg-background/80 p-2.5 text-[11px] sm:text-xs"
        >
          <p className="font-semibold text-emerald-300">{featuredCap.title}</p>
          <p className="mt-1 text-muted-foreground flex flex-wrap gap-x-1 gap-y-1">
            <span>{featuredCap.price}</span>
            <span>·</span>
            <span>{featuredCap.network}</span>
            {featuredCap.paymentTokens.map((t) => (
              <span key={t} className="text-amber-300 font-medium">
                {t}
              </span>
            ))}
          </p>
        </motion.div>
      ) : null}
      <div className="flex justify-end">
        <span
          className={cn(
            "rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-medium text-emerald-300 min-h-8 inline-flex items-center",
            showCopyPulse && styles.mockButtonPulse,
            !showCopyPulse && "opacity-50",
          )}
        >
          Copy call
        </span>
      </div>
      {!skipTyping && url.length < FULL_URL.length ? (
        <span className="sr-only">Loading demo</span>
      ) : null}
    </div>
  );
}
