"use client";

import { useSyncExternalStore } from "react";

let currentTimeMs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  currentTimeMs = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) currentTimeMs = Date.now();
  listeners.add(listener);
  if (listeners.size === 1) timer = setInterval(tick, 250);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      currentTimeMs = 0;
    }
  };
}

function getSnapshot(): number {
  return currentTimeMs;
}

function remainingSeconds(deadlineMs: number | null, nowMs: number): number {
  if (deadlineMs === null || !Number.isFinite(deadlineMs) || nowMs <= 0) return 0;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1_000));
}

/** Clock-derived countdown that remains correct after background-tab throttling. */
export function useCountdownUntil(deadline: string | number | Date | null): number {
  const deadlineMs = deadline === null ? null : new Date(deadline).getTime();
  const nowMs = useSyncExternalStore(subscribe, getSnapshot, () => 0);
  return remainingSeconds(deadlineMs, nowMs);
}
