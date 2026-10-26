import { addAbortListener } from "node:events";
function cancellationError(label: string, reason: unknown): Error {
  return Error.isError(reason)
    ? reason
    : new Error(`${label} was cancelled`, { cause: reason });
}
export async function settleWithin<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(`timeoutMs must be a finite non-negative number; received ${timeoutMs}`);
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
  const aborted = Promise.withResolvers<never>();
  using listener = addAbortListener(signal, () => {
    if (parentSignal?.aborted && !timeoutSignal.aborted) {
      aborted.reject(cancellationError(label, parentSignal.reason));
      return;
    }
    aborted.reject(
      new Error(`${label} exceeded ${timeoutMs}ms`, { cause: timeoutSignal.reason }),
    );
  });
  return await Promise.race([work, aborted.promise]);
}
