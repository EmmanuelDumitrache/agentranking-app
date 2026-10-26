import { throwIfAborted } from "./abort.js";
export type BestEffortOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };
function workerCount(length: number, concurrency: number): number {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error(`concurrency must be a positive safe integer, received ${concurrency}`);
  }
  return Math.min(length, concurrency);
}
/**
 * Side-effecting bounded map with drain-on-error semantics.
 *
 * Once one mapper fails, no new item is assigned. Every mapper invocation that
 * already started is awaited before the aggregate error is thrown, so a caller
 * can safely let a durable queue retry without overlapping detached work from
 * the previous attempt.
 */
export async function mapSideEffectsDrainOnError<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const results = new Array<R>(values.length);
  const errors: unknown[] = [];
  let nextIndex = 0;
  let stopped = false;
  const workers = Array.from({ length: workerCount(values.length, concurrency) }, async () => {
    for (;;) {
      if (stopped) return;
      const index = nextIndex;
      if (index >= values.length) return;
      nextIndex += 1;
      try {
        results[index] = await mapper(values[index]!, index);
      } catch (error) {
        errors.push(error);
        stopped = true;
        return;
      }
    }
  });
  await Promise.allSettled(workers);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "bounded side-effect map failed");
  return results;
}
/**
 * Side-effecting bounded map with cooperative abort-on-error semantics.
 * Started mapper calls are still drained before returning.
 */
export async function mapSideEffectsAbortOnError<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number, signal: AbortSignal) => Promise<R>,
  parentSignal?: AbortSignal,
): Promise<R[]> {
  if (values.length === 0) return [];
  const controller = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  const results = new Array<R>(values.length);
  const errors: unknown[] = [];
  let nextIndex = 0;
  let stopped = false;
  const workers = Array.from({ length: workerCount(values.length, concurrency) }, async () => {
    for (;;) {
      if (stopped) return;
      throwIfAborted(signal);
      const index = nextIndex;
      if (index >= values.length) return;
      nextIndex += 1;
      try {
        results[index] = await mapper(values[index]!, index, signal);
      } catch (error) {
        errors.push(error);
        stopped = true;
        if (!controller.signal.aborted) controller.abort(error);
        return;
      }
    }
  });
  await Promise.allSettled(workers);
  if (errors.length === 0) throwIfAborted(parentSignal);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "bounded side-effect map failed");
  return results;
}
/** Best-effort bounded map. All inputs are attempted and returned as outcomes. */
export async function mapBestEffort<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<Array<BestEffortOutcome<R>>> {
  if (values.length === 0) return [];
  const results = new Array<BestEffortOutcome<R>>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: workerCount(values.length, concurrency) }, async () => {
    for (;;) {
      const index = nextIndex;
      if (index >= values.length) return;
      nextIndex += 1;
      try {
        results[index] = { ok: true, value: await mapper(values[index]!, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
