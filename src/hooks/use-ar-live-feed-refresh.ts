"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import type { ArLiveFeedKind } from "@/lib/public-site/ar-live-feed-types";
import { useArLiveFeedEvent } from "@/hooks/use-ar-live-feed-event";
const DEFAULT_THROTTLE_MS = 8_000;
type Options = {
  readonly kinds: readonly ArLiveFeedKind[];
  readonly throttleMs?: number;
};
/** Shared SSE listener that throttles router.refresh() on relevant feed events. */
export function useArLiveFeedRefresh({ kinds, throttleMs = DEFAULT_THROTTLE_MS }: Options): void {
  const router = useRouter();
  const lastRefreshRef = useRef(0);
  useArLiveFeedEvent(kinds, () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < throttleMs) return;
    lastRefreshRef.current = now;
    router.refresh();
  });
}
