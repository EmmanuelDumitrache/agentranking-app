import { throwIfAborted } from "./abort.js";

/** Lower-bound binary search for a monotonic absent-then-present bytecode predicate. */
export async function findFirstBlockContainingCode(input: {
  low: bigint;
  high: bigint;
  hasCodeAt: (blockNumber: bigint) => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<bigint> {
  if (input.low < 0n || input.high < input.low) {
    throw new Error(`invalid registry deployment search bounds ${input.low}..${input.high}`);
  }
  let low = input.low;
  let high = input.high;
  while (low < high) {
    throwIfAborted(input.signal);
    const middle = low + (high - low) / 2n;
    if (await input.hasCodeAt(middle)) high = middle;
    else low = middle + 1n;
  }
  return low;
}
