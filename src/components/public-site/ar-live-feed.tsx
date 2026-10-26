"use client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-types";
import { cn, timeAgo } from "@/lib/utils";
const FEED_URL = "/api/public/ar-live-feed";
const MOBILE_QUERY = "(max-width: 639px)";
const MAX_ITEMS = 5;
function kindTone(kind: ArLiveFeedEvent["kind"]): string {
  switch (kind) {
    case "buy":
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300";
    case "sell":
      return "border-rose-500/35 bg-rose-500/10 text-rose-300";
    case "token_launch":
      return "border-violet-500/30 bg-violet-500/10 text-violet-200";
    case "agent_launch":
      return "border-border/60 bg-muted/30 text-foreground/80";
    case "fees":
      return "border-amber-500/35 bg-amber-500/10 text-amber-200";
    case "verified":
      return "border-sky-500/35 bg-sky-500/10 text-sky-200";
    case "milestone":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
    case "digest":
      return "border-border/50 bg-muted/20 text-foreground/75";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
function kindLabel(kind: ArLiveFeedEvent["kind"]): string {
  switch (kind) {
    case "buy":
      return "Buy";
    case "sell":
      return "Sell";
    case "token_launch":
      return "Token";
    case "agent_launch":
      return "Agent";
    case "fees":
      return "Fees";
    case "verified":
      return "Verified";
    case "milestone":
      return "Milestone";
    case "digest":
      return "Stats";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
function mergeItems(
  previous: readonly ArLiveFeedEvent[],
  next: ArLiveFeedEvent,
): ArLiveFeedEvent[] {
  if (previous.some((item) => item.id === next.id)) return [...previous];
  return [next, ...previous].slice(0, MAX_ITEMS);
}
export function ArLiveFeedWidget() {
  const [items, setItems] = useState<ArLiveFeedEvent[]>([]);
  const [live, setLive] = useState(false);
  const hydrated = useHydrated();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [expanded, setExpanded] = useSourceDraft(mobile ? "mobile" : "desktop", !mobile);
  const onSnapshot = useCallback((next: ArLiveFeedEvent[]) => {
    setItems(next.slice(0, MAX_ITEMS));
  }, []);
  const onItem = useCallback((next: ArLiveFeedEvent) => {
    setItems((previous) => mergeItems(previous, next));
  }, []);
  useEffect(() => {
    // During mobile hydration the media-query store can briefly expose its
    // server fallback. Gate the stream on both hydration and the live viewport
    // so the original desktop/mobile presentation remains unchanged without
    // opening a throwaway mobile connection.
    const awaitingMobileSnapshot =
      typeof globalThis.matchMedia === "function" &&
      !mobile &&
      globalThis.matchMedia(MOBILE_QUERY).matches;
    if (
      !hydrated ||
      !expanded ||
      awaitingMobileSnapshot ||
      typeof EventSource === "undefined"
    ) {
      return;
    }

    const source = new EventSource(FEED_URL);
    source.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          items?: ArLiveFeedEvent[];
        };
        onSnapshot(Array.isArray(payload.items) ? payload.items : []);
        setLive(true);
      } catch {
        // Ignore malformed snapshots.
      }
    });
    source.addEventListener("item", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          item?: ArLiveFeedEvent;
        };
        if (payload.item) onItem(payload.item);
        setLive(true);
      } catch {
        // Ignore malformed items.
      }
    });
    source.onopen = () => setLive(true);
    source.onerror = () => {
      // Native EventSource reconnection preserves the stream without creating a
      // second application-level retry loop.
      setLive(false);
    };

    return () => source.close();
  }, [expanded, hydrated, mobile, onItem, onSnapshot]);
  return (
    <div
      className={cn(
        "pointer-events-auto fixed z-40 w-[min(100vw-1.5rem,20rem)]",
        "bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))]",
      )}
    >
      <div className="overflow-hidden rounded-lg border border-border/60 bg-[linear-gradient(180deg,var(--app-panel-raised)_0%,var(--app-panel)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-[12px]">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/20"
          aria-expanded={expanded}
        >
          <Image
            src="/ar-mark.png"
            alt=""
            width={22}
            height={22}
            className="h-5 w-5 shrink-0 object-contain"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
            AR Live Feed
          </span>
          <span
            className={cn(
              "inline-flex h-2 w-2 shrink-0 rounded-full",
              live && expanded ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </button>
        {expanded ? (
          <div className="border-t border-border/50">
            {items.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Watching AR launches, trades, fees, and milestones…
              </p>
            ) : (
              <ul className="max-h-[min(50vh,18rem)] space-y-1.5 overflow-y-auto p-2 no-scrollbar">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block rounded-md border px-2.5 py-2 transition-opacity hover:opacity-90",
                        kindTone(item.kind),
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-xs font-semibold leading-snug text-foreground">
                          {item.title}
                        </p>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-foreground/55">
                          {kindLabel(item.kind)}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-foreground/55">
                        {timeAgo(item.occurredAt)}
                        {" · "}
                        {item.chain === "robinhood" ? "EVM" : "Solana"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
