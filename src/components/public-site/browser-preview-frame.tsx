"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "@/components/public-site/public-feature-page.module.css";
export type BrowserPreviewAccent = "emerald" | "amber" | "blue";
export function BrowserPreviewFrame({
  children,
  url,
  accent = "emerald",
  compact = false,
  decorative = true,
  className,
  innerClassName,
}: {
  readonly children: ReactNode;
  readonly url: string;
  readonly accent?: BrowserPreviewAccent;
  readonly compact?: boolean;
  /** When true, frame is treated as a static product illustration. */
  readonly decorative?: boolean;
  readonly className?: string;
  readonly innerClassName?: string;
}) {
  const dotClass =
    accent === "amber"
      ? "bg-amber-500/70"
      : accent === "blue"
        ? "bg-blue-500/70"
        : styles.browserChromeDotEmerald;
  const displayUrl =
    url.length > 0 ? url : "\u00a0";
  return (
    <div
      className={cn(
        "max-w-full overflow-hidden rounded-2xl border border-border/80 bg-card/50 backdrop-blur-sm",
        styles.browserFrame,
        styles.browserShine,
        className,
      )}
      role={decorative ? "img" : undefined}
      aria-label={decorative ? "Product preview illustration" : undefined}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border/80 bg-muted/40",
          compact ? "px-2 py-2" : "px-3 py-2.5",
        )}
        aria-hidden
      >
        <span className={cn(styles.browserChromeDot, dotClass)} />
        <span className={cn(styles.browserChromeDot, styles.browserChromeDotMuted)} />
        <span className={cn(styles.browserChromeDot, styles.browserChromeDotMuted)} />
        <div
          className={cn(
            "ml-2 min-w-0 flex-1 truncate rounded-md border border-border/60 bg-background/70 px-2.5 py-1 text-muted-foreground max-sm:text-[10px]",
            compact ? "text-[10px]" : "text-[10px] md:text-xs",
            styles.browserUrlBar,
          )}
        >
          <span className="sm:hidden">
            {displayUrl.length > 28 ? `…${displayUrl.slice(-24)}` : displayUrl}
          </span>
          <span className="hidden sm:inline">{displayUrl}</span>
        </div>
      </div>
      <div
        className={cn(
          "max-w-full overflow-x-auto overscroll-x-contain bg-background/40",
          compact ? "p-2 sm:p-3" : "p-3 md:p-4",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
