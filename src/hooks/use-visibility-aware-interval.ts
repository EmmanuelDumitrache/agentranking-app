"use client";
import { useEffect, useRef } from "react";
export function useVisibilityAwareInterval(
  callback: (signal: AbortSignal) => void | Promise<void>,
  delayMs: number | null,
  options: { paused?: boolean; runImmediately?: boolean } = {},
): void {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delayMs === null || !Number.isFinite(delayMs) || delayMs <= 0 || options.paused) return;
    const boundedDelayMs = Math.min(2_147_483_647, Math.max(1, Math.trunc(delayMs)));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;
    let stopped = false;
    let running = false;
    const runAndReschedule = async () => {
      if (stopped || running || document.visibilityState === "hidden") return;
      running = true;
      const controller = new AbortController();
      activeController = controller;
      try {
        await callbackRef.current(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Visibility-aware interval callback failed", error);
        }
      } finally {
        if (activeController === controller) activeController = null;
        running = false;
        schedule();
      }
    };
    const schedule = () => {
      if (stopped || running || document.visibilityState === "hidden" || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void runAndReschedule();
      }, boundedDelayMs);
    };
    const onVisibilityChange = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (document.visibilityState === "hidden") {
        activeController?.abort("document-hidden");
      } else if (!stopped) {
        schedule();
      }
    };
    if (options.runImmediately && document.visibilityState === "visible") {
      void runAndReschedule();
    } else {
      schedule();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      activeController?.abort("interval-stopped");
      activeController = null;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [delayMs, options.paused, options.runImmediately]);
}
