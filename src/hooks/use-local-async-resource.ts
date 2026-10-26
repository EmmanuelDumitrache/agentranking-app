"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
type Snapshot<T> = {
  readonly key: string;
  readonly requestKey: string;
  readonly data: T | null;
  readonly error: Error | null;
};
export type UseLocalAsyncResourceOptions<T> = {
  /** Optional display fallback. It is authoritative only when initialDataKey matches key. */
  readonly initialData?: T | null;
  /** Identifies which resource key produced initialData. */
  readonly initialDataKey?: string | null;
  /** Refresh a matching server snapshot in the background after mount. Defaults to false. */
  readonly revalidateOnMount?: boolean;
  readonly keepPreviousData?: boolean;
};
/**
 * Local-only async resource loader for component-local processing (e.g. image
 * cropping of a local `File`). Unlike `useAsyncResource`, this deliberately does
 * not route through the shared TanStack Query cache because the data (object
 * URLs, temporary image state) must never be placed in a global cache.
 */
export function useLocalAsyncResource<T>(
  key: string | null,
  loader: (signal: AbortSignal) => Promise<T>,
  options: UseLocalAsyncResourceOptions<T> = {},
) {
  const [refreshRevisions, setRefreshRevisions] = useState<Readonly<Record<string, number>>>({});
  const revision = key === null ? 0 : refreshRevisions[key] ?? 0;
  const requestKey = key === null ? null : `${key}\u0000${revision}`;
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);
  const loaderRef = useRef(loader);
  const initialDataRef = useRef<T | null>(options.initialData ?? null);
  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);
  useEffect(() => {
    initialDataRef.current = options.initialData ?? null;
  }, [options.initialData]);
  const hasMatchingInitialData =
    revision === 0
    && key !== null
    && options.initialData !== undefined
    && options.initialDataKey === key;
  const hasCurrentSnapshot =
    requestKey !== null && snapshot?.requestKey === requestKey;
  const hasSnapshotForKey = key !== null && snapshot?.key === key;
  const data = hasCurrentSnapshot
    ? snapshot.data
    : hasMatchingInitialData
      ? options.initialData ?? null
      : hasSnapshotForKey
        ? snapshot.data
        : options.keepPreviousData
        ? snapshot?.data ?? null
        : null;
  const error = hasCurrentSnapshot ? snapshot.error : null;
  const loading =
    requestKey !== null && !hasCurrentSnapshot && !hasMatchingInitialData;
  useEffect(() => {
    if (key === null || requestKey === null) return;
    const activeKey = key;
    const activeRequestKey = requestKey;
    if (hasMatchingInitialData && options.revalidateOnMount !== true) return;
    const controller = new AbortController();
    void loaderRef.current(controller.signal).then(
      (nextData) => {
        if (!controller.signal.aborted) {
          setSnapshot({ key: activeKey, requestKey: activeRequestKey, data: nextData, error: null });
        }
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) {
          setSnapshot((current) => ({
            key: activeKey,
            requestKey: activeRequestKey,
            data:
              current?.key === activeKey
                ? current.data
                : hasMatchingInitialData
                  ? initialDataRef.current
                  : null,
            error: reason instanceof Error ? reason : new Error("Request failed"),
          }));
        }
      },
    );
    return () => controller.abort();
  }, [hasMatchingInitialData, key, options.revalidateOnMount, requestKey]);
  const refresh = useCallback(() => {
    if (key === null) return;
    setRefreshRevisions((current) => ({
      ...current,
      [key]: (current[key] ?? 0) + 1,
    }));
  }, [key]);
  const setData = useCallback(
    (update: SetStateAction<T | null>) => {
      if (key === null || requestKey === null) return;
      const activeKey = key;
      const activeRequestKey = requestKey;
      setSnapshot((current) => {
        const currentData = current?.requestKey === activeRequestKey ? current.data : data;
        const nextData =
          typeof update === "function"
            ? (update as (previous: T | null) => T | null)(currentData)
            : update;
        return { key: activeKey, requestKey: activeRequestKey, data: nextData, error: null };
      });
    },
    [data, key, requestKey],
  );
  return { data, error, loading, refresh, setData } as const;
}