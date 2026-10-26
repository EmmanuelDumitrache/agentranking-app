"use client";
import { useCallback, useEffect, useRef, useState } from "react";
/**
 * State that automatically returns to its initial value after a bounded delay.
 * Re-triggering clears the previous timer so the newest interaction owns the
 * full feedback window.
 */
export function useTransientState<T>(initialValue: T, defaultDurationMs: number) {
  const initialValueRef = useRef(initialValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = useState<T>(initialValue);
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const setTransient = useCallback(
    (nextValue: T, durationMs = defaultDurationMs) => {
      clearTimer();
      setValue(nextValue);
      if (Object.is(nextValue, initialValueRef.current)) return;
      const fallbackDuration = Number.isFinite(defaultDurationMs)
        ? defaultDurationMs
        : 0;
      const boundedDuration = Number.isFinite(durationMs)
        ? Math.min(2_147_483_647, Math.max(0, Math.trunc(durationMs)))
        : Math.min(2_147_483_647, Math.max(0, Math.trunc(fallbackDuration)));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setValue(initialValueRef.current);
      }, boundedDuration);
    },
    [clearTimer, defaultDurationMs],
  );
  const reset = useCallback(() => {
    clearTimer();
    setValue(initialValueRef.current);
  }, [clearTimer]);
  useEffect(() => clearTimer, [clearTimer]);
  return [value, setTransient, reset] as const;
}
