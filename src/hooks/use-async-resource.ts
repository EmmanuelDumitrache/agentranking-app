"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
type UseAsyncResourceOptions<T> = {
  /** Optional display fallback. It is authoritative only when initialDataKey matches key. */
  readonly initialData?: T | null;
  /** Identifies which resource key produced initialData. */
  readonly initialDataKey?: string | null;
  /** Refresh a matching server snapshot in the background after mount. Defaults to false. */
  readonly revalidateOnMount?: boolean;
  readonly keepPreviousData?: boolean;
};
/**
 * Compatibility namespace for resources that previously used the hand-rolled
 * `useAsyncResource` hook. Kept under its own root so these keys never collide
 * with the domain query-key factories (dashboard/treasury/admin/public/stake).
 */
const asyncResourceKeys = {
  all: ["legacy-async-resource"] as const,
  item: (key: string) => [...asyncResourceKeys.all, key] as const,
};
/**
 * Loads an external resource while allowing a Server Component to seed the
 * current key. This is a thin compatibility layer over TanStack Query:
 *
 * - matching `initialData` (initialDataKey === key) is authoritative and is
 *   rendered as loaded, optionally revalidated in the background
 * - `initialData` is never reused for a different key
 * - explicit refreshes always force a new refetch of the active key
 * - the Query `AbortSignal` is passed through to the loader, so Query owns
 *   cancellation and supersession
 *
 * The old hook intentionally stored the loader in a ref so a new function
 * identity did not reload a resource. Query identity is determined by `key`,
 * so that behavior is preserved here by reading the loader through a ref.
 */
export function useAsyncResource<T>(
  key: string | null,
  loader: (signal: AbortSignal) => Promise<T>,
  options: UseAsyncResourceOptions<T> = {},
) {
  const queryClient = useQueryClient();
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);
  const hasMatchingInitialData =
    key !== null &&
    options.initialData !== undefined &&
    options.initialDataKey === key;
  // `initialData` may legitimately be `null` (e.g. a server-established "not
  // ready" seed). The exposed `data` is `T | null`, so a null seed is valid and
  // simply disables the first fetch via `refetchOnMount` below.
  const initialData = hasMatchingInitialData
    ? (options.initialData as T | undefined)
    : undefined;
  // matching initialData + revalidateOnMount !== true => do not fetch on mount;
  // matching initialData + revalidateOnMount === true => background-refetch;
  // no matching initialData => fetch.
  const refetchOnMount =
    !hasMatchingInitialData || options.revalidateOnMount === true;
  const enabled = key !== null;
  const query = useQuery<T, Error>({
    queryKey: asyncResourceKeys.item(key ?? ""),
    queryFn: ({ signal }) => loaderRef.current(signal),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData,
    refetchOnMount,
    placeholderData: options.keepPreviousData ? keepPreviousData : undefined,
  });
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const refresh = useCallback(() => {
    if (key === null) return;
    setManualRefreshing(true);
    void queryClient
      .invalidateQueries({ queryKey: asyncResourceKeys.item(key) })
      .then(() => setManualRefreshing(false));
  }, [key, queryClient]);
  const setData = useCallback(
    (update: SetStateAction<T | null>) => {
      if (key === null) return;
      queryClient.setQueryData<T | null>(
        asyncResourceKeys.item(key),
        (old) =>
          typeof update === "function"
            ? (update as (previous: T | null) => T | null)(old ?? null)
            : update,
      );
    },
    [key, queryClient],
  );
  const loading =
    key !== null &&
    (query.isPending ||
      manualRefreshing ||
      (query.isPlaceholderData && query.isFetching));
  const error = query.isError ? (query.error as Error) : null;
  const data = (query.data ?? null) as T | null;
  return { data, error, loading, refresh, setData } as const;
}