"use client";
import Script from "next/script";
import { useEffect, useState } from "react";
import {
  QWERTI_AR_CAMPAIGN,
  QWERTI_WIDGET_SCRIPT_SRC,
} from "@/lib/public-site/qwerti-ar";
const WIDGET_IDLE_DELAY_MS = 5200;
const WIDGET_SCROLL_IDLE_MS = 900;
/** Loads the partner sponsor widget after the page has settled. */
export function QwertiArWidgetScript() {
  const [loadWidget, setLoadWidget] = useState(false);
  useEffect(() => {
    const load = () => setLoadWidget(true);
    let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined;
    const loadWhenScrollIsQuiet = () => {
      if (!document.documentElement.dataset.scrollActive) {
        load();
        return;
      }
      scrollIdleTimer = globalThis.setTimeout(loadWhenScrollIsQuiet, WIDGET_SCROLL_IDLE_MS);
    };
    const requestIdle = globalThis.requestIdleCallback;
    if (requestIdle) {
      const idleId = requestIdle(loadWhenScrollIsQuiet, { timeout: WIDGET_IDLE_DELAY_MS });
      return () => {
        globalThis.cancelIdleCallback?.(idleId);
        if (scrollIdleTimer) globalThis.clearTimeout(scrollIdleTimer);
      };
    }
    const timeoutId = globalThis.setTimeout(loadWhenScrollIsQuiet, WIDGET_IDLE_DELAY_MS);
    return () => {
      globalThis.clearTimeout(timeoutId);
      if (scrollIdleTimer) globalThis.clearTimeout(scrollIdleTimer);
    };
  }, []);
  if (!loadWidget) return null;
  return (
    <Script
      src={QWERTI_WIDGET_SCRIPT_SRC}
      strategy="lazyOnload"
      data-widget="qwerti-widget"
      data-campaign={QWERTI_AR_CAMPAIGN}
    />
  );
}
