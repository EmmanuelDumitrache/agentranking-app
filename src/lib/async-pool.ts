/** Run async work over items with a fixed concurrency cap (avoids tunnel/pool stampedes). */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const requested = Number.isFinite(concurrency) ? Math.trunc(concurrency) : 1;
  const limit = Math.max(1, Math.min(requested, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let stopped = false;
  let failed = false;
  let firstError: unknown;
  async function worker(): Promise<void> {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        if (!stopped) {
          stopped = true;
          failed = true;
          firstError = error;
        }
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  if (failed) throw firstError;
  return results;
}

/** Run bounded parallel work without retaining one result object per input. */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const requested = Number.isFinite(concurrency) ? Math.trunc(concurrency) : 1;
  const limit = Math.max(1, Math.min(requested, items.length));
  let nextIndex = 0;
  let stopped = false;
  let failed = false;
  let firstError: unknown;
  async function worker(): Promise<void> {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        await fn(items[index]!, index);
      } catch (error) {
        if (!stopped) {
          stopped = true;
          failed = true;
          firstError = error;
        }
      }
    }
  }
  // Await every in-flight callback before returning so callers can safely
  // release distributed locks after an abort or fatal error.
  await Promise.all(Array.from({ length: limit }, () => worker()));
  if (failed) throw firstError;
}
