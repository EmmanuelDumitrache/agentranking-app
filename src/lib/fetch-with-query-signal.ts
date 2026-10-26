import { isAbortLike, timeoutSignal } from "@/lib/timing/abort";

function timeoutMessage(timeoutMs: number): string {
  return `The server took longer than ${Math.round(timeoutMs / 1000)}s to respond. Try refreshing.`;
}

async function fetchWithDeadline(
  input: RequestInfo | URL,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(input, {
      signal: timeoutSignal(timeoutMs, parentSignal),
      cache: "no-store",
    });
  } catch (error) {
    if (parentSignal?.aborted) {
      throw new DOMException("Request cancelled", "AbortError");
    }
    if (isAbortLike(error)) {
      throw new DOMException(timeoutMessage(timeoutMs), "TimeoutError");
    }
    throw error;
  }
}

/** Fetch that respects TanStack Query cancellation and applies a wall-clock timeout. */
export function fetchWithQuerySignal(
  input: RequestInfo | URL,
  querySignal: AbortSignal,
  timeoutMs = 60_000,
): Promise<Response> {
  return fetchWithDeadline(input, timeoutMs, querySignal);
}

/** Timeout-only fetch (e.g. "load more" outside a queryFn). */
export function fetchWithTimeout(input: RequestInfo | URL, timeoutMs = 60_000): Promise<Response> {
  return fetchWithDeadline(input, timeoutMs);
}

/** JSON from a fetch that respects the query signal and timeout; throws on non-OK for Query retry. */
export async function fetchJsonWithQuerySignal<T>(
  input: RequestInfo | URL,
  querySignal: AbortSignal,
  timeoutMs = 60_000,
): Promise<T> {
  const r = await fetchWithQuerySignal(input, querySignal, timeoutMs);
  const data: unknown = await r.json().catch(() => ({}));
  if (!r.ok) {
    const body = data as { error?: string; code?: string };
    const parts: string[] = [];
    if (typeof body?.error === "string") parts.push(body.error);
    if (typeof body?.code === "string") parts.push(body.code);
    throw new Error(parts.length > 0 ? parts.join(" ") : `Request failed (${r.status})`);
  }
  return data as T;
}
