"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Keeps an editable local draft while its source identity is stable. When the
 * source identity changes, consumers immediately see the new source value
 * without a synchronising effect or an intermediate stale render.
 */
export function useSourceDraft<T>(
  sourceKey: string | number | null,
  sourceValue: T,
): readonly [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState<{ sourceKey: string | number | null; value: T }>(() => ({
    sourceKey,
    value: sourceValue,
  }));
  const value = draft.sourceKey === sourceKey ? draft.value : sourceValue;
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (update) => {
      setDraft((current) => {
        const currentValue = current.sourceKey === sourceKey ? current.value : sourceValue;
        return {
          sourceKey,
          value: typeof update === "function"
            ? (update as (previous: T) => T)(currentValue)
            : update,
        };
      });
    },
    [sourceKey, sourceValue],
  );
  return [value, setValue] as const;
}
