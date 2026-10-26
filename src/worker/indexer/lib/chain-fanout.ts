import { createHash } from "node:crypto";
export type ChainFanoutState = {
  chainId: number;
  cursorLag: bigint | null;
  lastAdvancedAt: Date | null;
};
function tieBreak(chainId: number, epoch: number, replicaSalt: string): string {
  return createHash("sha256").update(`${replicaSalt}\0${epoch}\0${chainId}`).digest("hex");
}
/**
 * Prioritizes lagging/stale chains while decorrelating equal-priority chains
 * across replicas and scan epochs.
 */
export function orderChainFanout(
  states: readonly ChainFanoutState[],
  input: { epoch: number; replicaSalt: string },
): number[] {
  return [...states].sort((a, b) => {
    const lagA = a.cursorLag ?? (1n << 62n);
    const lagB = b.cursorLag ?? (1n << 62n);
    if (lagA !== lagB) return lagA > lagB ? -1 : 1;
    const timeA = a.lastAdvancedAt?.getTime() ?? 0;
    const timeB = b.lastAdvancedAt?.getTime() ?? 0;
    if (timeA !== timeB) return timeA - timeB;
    return tieBreak(a.chainId, input.epoch, input.replicaSalt).localeCompare(
      tieBreak(b.chainId, input.epoch, input.replicaSalt),
    );
  }).map((state) => state.chainId);
}
