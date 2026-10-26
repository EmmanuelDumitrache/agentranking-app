import { parseSolanaExactUnsigned, validateSolanaTransactionSignature } from "./solana-protocol.js";
export type SolanaSignatureCoordinate = {
  signature: string;
  slot: bigint;
};
export type SolanaSignaturePageCursor<T extends SolanaSignatureCoordinate = SolanaSignatureCoordinate> = {
  before: string | null;
  pendingSlot: bigint | null;
  pendingNewestFirst: T[];
  exhausted: boolean;
};
export type ConsumedSolanaSignaturePage<T extends SolanaSignatureCoordinate> = {
  completeNewestFirst: T[];
  cursor: SolanaSignaturePageCursor<T>;
};
export function emptySolanaSignaturePageCursor<T extends SolanaSignatureCoordinate>(): SolanaSignaturePageCursor<T> {
  return {
    before: null,
    pendingSlot: null,
    pendingNewestFirst: [],
    exhausted: false,
  };
}
function assertNewestFirst<T extends SolanaSignatureCoordinate>(items: readonly T[]): void {
  let previous: bigint | null = null;
  const signatures = new Set<string>();
  for (const item of items) {
    validateSolanaTransactionSignature(item.signature);
    if (signatures.has(item.signature)) throw new Error(`duplicate Solana signature in page: ${item.signature}`);
    signatures.add(item.signature);
    if (item.slot < 0n) throw new Error("Solana signature slot must be unsigned");
    if (previous != null && item.slot > previous) {
      throw new Error("Solana signature page is not ordered newest-first by slot");
    }
    previous = item.slot;
  }
}
/**
 * Consume one newest-first getSignaturesForAddress page without assuming that a
 * slot boundary aligns with the RPC page boundary. The final contiguous slot is
 * retained until the next page proves that the slot is complete. Pagination is
 * always driven by the oldest signature, never by slot or minContextSlot.
 */
export function consumeSolanaSignaturePage<T extends SolanaSignatureCoordinate>(input: {
  cursor: SolanaSignaturePageCursor<T>;
  pageNewestFirst: readonly T[];
}): ConsumedSolanaSignaturePage<T> {
  if (input.cursor.exhausted) throw new Error("cannot consume a Solana signature page after exhaustion");
  const page = [...input.pageNewestFirst];
  assertNewestFirst(page);
  assertNewestFirst(input.cursor.pendingNewestFirst);
  if (input.cursor.pendingNewestFirst.length > 0) {
    const pendingSlot = input.cursor.pendingSlot;
    if (pendingSlot == null || input.cursor.pendingNewestFirst.some((entry) => entry.slot !== pendingSlot)) {
      throw new Error("invalid Solana signature cursor pending-slot state");
    }
    if (page.length > 0 && page[0].slot > pendingSlot) {
      throw new Error("Solana signature pagination moved to a newer slot");
    }
  } else if (input.cursor.pendingSlot != null) {
    throw new Error("invalid Solana signature cursor with an empty pending group");
  }
  if (page.length === 0) {
    return {
      completeNewestFirst: [...input.cursor.pendingNewestFirst],
      cursor: {
        before: input.cursor.before,
        pendingSlot: null,
        pendingNewestFirst: [],
        exhausted: true,
      },
    };
  }
  const combined = [...input.cursor.pendingNewestFirst, ...page];
  assertNewestFirst(combined);
  const oldestSlot = combined.at(-1)!.slot;
  let trailingStart = combined.length - 1;
  while (trailingStart > 0 && combined[trailingStart - 1].slot === oldestSlot) trailingStart -= 1;
  return {
    completeNewestFirst: combined.slice(0, trailingStart),
    cursor: {
      before: page.at(-1)!.signature,
      pendingSlot: oldestSlot,
      pendingNewestFirst: combined.slice(trailingStart),
      exhausted: false,
    },
  };
}
/** Convert an exact slot into the current web3.js number boundary without rounding. */
export function solanaMinContextSlotNumber(value: bigint | string | number): number {
  const exact = parseSolanaExactUnsigned(value, "minContextSlot");
  if (exact == null) throw new Error("minContextSlot is required");
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("minContextSlot exceeds the exact integer range supported by @solana/web3.js");
  }
  return Number(exact);
}
