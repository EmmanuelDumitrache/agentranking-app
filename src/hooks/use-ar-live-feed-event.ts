"use client";
import { useEffect, useRef } from "react";
import { subscribeArLiveFeed } from "@/lib/public-site/ar-live-feed-client";
import type { ArLiveFeedEvent, ArLiveFeedKind } from "@/lib/public-site/ar-live-feed-types";
export function useArLiveFeedEvent(
  kinds: readonly ArLiveFeedKind[],
  onEvent: (event: ArLiveFeedEvent) => void,
): void {
  const callbackRef = useRef(onEvent);
  useEffect(() => {
    callbackRef.current = onEvent;
  }, [onEvent]);
  const kindsKey = kinds.join("|");
  useEffect(() => {
    const kindSet = new Set(kindsKey.split("|") as ArLiveFeedKind[]);
    return subscribeArLiveFeed((event) => {
      if (kindSet.has(event.kind)) callbackRef.current(event);
    });
  }, [kindsKey]);
}
