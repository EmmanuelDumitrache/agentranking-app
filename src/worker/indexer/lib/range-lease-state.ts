export type BlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export type CompletedBlockRange = BlockRange & {
  status: string;
  endBlockHash: string | null;
};

function assertRange(range: BlockRange, label: string): void {
  if (range.fromBlock < 0n || range.toBlock < range.fromBlock) {
    throw new Error(`${label} has an invalid block interval ${range.fromBlock}-${range.toBlock}`);
  }
}

function assertSortedNonOverlapping(ranges: readonly BlockRange[]): void {
  let previousTo: bigint | null = null;
  for (const [index, range] of ranges.entries()) {
    assertRange(range, `range[${index}]`);
    if (previousTo != null && range.fromBlock <= previousTo) {
      throw new Error(`range[${index}] overlaps or reorders the preceding interval`);
    }
    previousTo = range.toBlock;
  }
}

/**
 * Allocate deterministic gaps without overlapping an existing ordered source plan.
 * The limit is source-local prefetch, not a global worker concurrency bound.
 */
export function allocateUncoveredBlockRanges(input: {
  start: bigint;
  target: bigint;
  rangeSize: bigint;
  existing: readonly BlockRange[];
  limit: number;
}): BlockRange[] {
  if (input.start < 0n || input.target < 0n) throw new Error("block range bounds must be non-negative");
  if (input.rangeSize <= 0n) throw new Error("rangeSize must be positive");
  if (!Number.isSafeInteger(input.limit) || input.limit < 0) throw new Error("range allocation limit must be a non-negative safe integer");
  assertSortedNonOverlapping(input.existing);
  if (input.start > input.target || input.limit === 0) return [];

  const out: BlockRange[] = [];
  let cursor = input.start;
  for (const lease of input.existing) {
    if (lease.toBlock < cursor) continue;
    if (lease.fromBlock > input.target) break;
    if (lease.fromBlock > cursor) {
      const gapEnd = lease.fromBlock - 1n > input.target ? input.target : lease.fromBlock - 1n;
      while (cursor <= gapEnd && out.length < input.limit) {
        const proposedEnd = cursor + input.rangeSize - 1n;
        const toBlock = proposedEnd > gapEnd ? gapEnd : proposedEnd;
        out.push({ fromBlock: cursor, toBlock });
        cursor = toBlock + 1n;
      }
      if (out.length >= input.limit) return out;
    }
    if (lease.fromBlock <= cursor && lease.toBlock >= cursor) cursor = lease.toBlock + 1n;
  }
  while (cursor <= input.target && out.length < input.limit) {
    const proposedEnd = cursor + input.rangeSize - 1n;
    const toBlock = proposedEnd > input.target ? input.target : proposedEnd;
    out.push({ fromBlock: cursor, toBlock });
    cursor = toBlock + 1n;
  }
  return out;
}

/** Return only the completed prefix beginning at the exact authoritative next block. */
export function contiguousCompletedPrefix<T extends CompletedBlockRange>(input: {
  cursorBlock: bigint | null;
  initialBlock: bigint;
  ranges: readonly T[];
}): {
  consumed: T[];
  advancedTo: bigint | null;
  nextBlock: bigint;
  endBlockHash: string | null;
} {
  if (input.initialBlock < 0n) throw new Error("initialBlock must be non-negative");
  assertSortedNonOverlapping(input.ranges);
  let expected = input.cursorBlock == null ? input.initialBlock : input.cursorBlock + 1n;
  let advancedTo = input.cursorBlock;
  let endBlockHash: string | null = null;
  const consumed: T[] = [];

  for (const range of input.ranges) {
    if (range.toBlock < expected) continue;
    if (range.fromBlock < expected) {
      throw new Error(`range ${range.fromBlock}-${range.toBlock} crosses the authoritative cursor boundary ${expected}`);
    }
    if (range.fromBlock > expected || range.status !== "COMPLETE") break;
    if (!range.endBlockHash) {
      throw new Error(`completed range ${range.fromBlock}-${range.toBlock} has no boundary hash`);
    }
    consumed.push(range);
    advancedTo = range.toBlock;
    endBlockHash = range.endBlockHash;
    expected = range.toBlock + 1n;
  }

  return { consumed, advancedTo, nextBlock: expected, endBlockHash };
}
