"use client";
import { useEffect } from "react";
/**
 * In-page nav scrolls without updating the URL hash (see stake navigation).
 * On full reload with a stale hash (e.g. /#staking), reset to top so refresh does not jump sections.
 * On first visit with a hash in the URL, scroll to that section once.
 */
export function StakeHashScroll() {
  useEffect(() => {
    const { hash, pathname, search } = window.location;
    if (!hash) return;
    const navEntry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const isReload = navEntry?.type === "reload";
    if (isReload) {
      window.history.replaceState(null, "", `${pathname}${search}`);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }
    const id = hash.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  }, []);
  return null;
}
