import { PublicKey } from "@solana/web3.js";
import {
  indexMetaplexAgentWithSnapshotLockHeld,
  withMetaplexManualIndexLock,
} from "../../../services/metaplex-indexer";
import type { MetaplexBulkIndexResponse, MetaplexBulkIndexResultItem } from "@/lib/metaplex/types";
const MAX_BATCH = 100;
const CONCURRENCY = 2;
function isValidSolanaAddress(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}
/** @param limit Max addresses (default 100 for admin API). Pass 0 for no cap. */
export function normalizeMetaplexAssetAddresses(input: string[], limit = MAX_BATCH): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  if (limit <= 0) return out;
  return out.slice(0, limit);
}
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  // Promise.all rejects immediately and leaves sibling workers running. A
  // snapshot must not release its distributed mutex while those workers can
  // still materialize agents, so drain every worker before propagating the
  // first failure or cancellation.
  const settled = await Promise.allSettled(workers);
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejected) throw rejected.reason;
  return results;
}
export async function bulkIndexMetaplexAgents(
  assetAddresses: string[],
  options?: { limit?: number },
): Promise<MetaplexBulkIndexResponse> {
  const limit = options?.limit ?? MAX_BATCH;
  const addresses = normalizeMetaplexAssetAddresses(assetAddresses, limit);
  const results: MetaplexBulkIndexResultItem[] = [];
  if (addresses.length > 0) {
    await withMetaplexManualIndexLock(undefined, async (lockedSignal) => {
      for (let offset = 0; offset < addresses.length; offset += MAX_BATCH) {
        const chunk = addresses.slice(offset, offset + MAX_BATCH);
        const chunkResults = await mapWithConcurrency(chunk, CONCURRENCY, async (assetAddress) => {
          if (!isValidSolanaAddress(assetAddress)) {
            return {
              assetAddress,
              ok: false,
              error: "Invalid Solana address",
            } satisfies MetaplexBulkIndexResultItem;
          }
          try {
            const result = await indexMetaplexAgentWithSnapshotLockHeld(
              assetAddress,
              lockedSignal,
            );
            if (!result.ok) {
              return {
                assetAddress,
                ok: false,
                error: result.error ?? "Indexing failed",
              } satisfies MetaplexBulkIndexResultItem;
            }
            return {
              assetAddress,
              ok: true,
              created: result.created,
              agentDbId: result.agentDbId,
              profilePath: result.profilePath,
              profileUrl: result.profileUrl,
            } satisfies MetaplexBulkIndexResultItem;
          } catch (err) {
            if (lockedSignal.aborted) throw lockedSignal.reason ?? err;
            const msg = Error.isError(err) ? err.message : String(err);
            return {
              assetAddress,
              ok: false,
              error: msg,
            } satisfies MetaplexBulkIndexResultItem;
          }
        });
        results.push(...chunkResults);
        const done = results.length;
        const ok = results.filter((r) => r.ok).length;
        console.error(
          `[metaplex-bulk] ${done}/${addresses.length} processed (${ok} ok, ${done - ok} failed)`,
        );
      }
    });
  }
  const indexed = results.filter((r) => r.ok && r.created).length;
  const existing = results.filter((r) => r.ok && !r.created).length;
  const failed = results.filter((r) => !r.ok).length;
  return {
    ok: failed === 0,
    total: results.length,
    indexed,
    existing,
    failed,
    results,
  };
}
