import { useState, useEffect } from "react";
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const boundedDelay = Number.isFinite(delay)
      ? Math.min(2_147_483_647, Math.max(0, Math.trunc(delay)))
      : 0;
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, boundedDelay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}
