import type { Hex, Log, PublicClient } from "viem";
import { Prisma } from "@/generated/prisma/client";
import { forEachWithConcurrency } from "@/lib/async-pool";
import { prisma } from "../db.js";
const LOOKUP_CHUNK = 2_000;
const BLOCK_TIME_DB_CONCURRENCY = 2;
const BLOCK_TIME_RPC_CONCURRENCY = 4;
const RECENT_BLOCK_TIME_CACHE_SIZE = 8_192;
const recentBlockTimes = new Map<string, Date | null>();
function recentBlockTimeKey(chainId: number, blockHash: string): string {
  return `${chainId}:${blockHash.toLowerCase()}`;
}
function retainRecentBlockTime(chainId: number, blockHash: string, blockTime: Date | null): void {
  const key = recentBlockTimeKey(chainId, blockHash);
  recentBlockTimes.delete(key);
  recentBlockTimes.set(key, blockTime);
  while (recentBlockTimes.size > RECENT_BLOCK_TIME_CACHE_SIZE) {
    const oldest = recentBlockTimes.keys().next().value as string | undefined;
    if (oldest == null) break;
    recentBlockTimes.delete(oldest);
  }
}
/**
 * Reuse block timestamps already captured by any EVM event domain. This avoids
 * repeating eth_getBlockByHash during overlap scans, worker restarts, and
 * identity/reputation/validation passes that touch the same blocks.
 */
export async function preloadPersistedBlockTimes(
  chainId: number,
  logs: readonly Pick<Log<bigint, number, false, undefined, true>, "blockHash">[],
  cache: Map<string, Date | null>,
): Promise<void> {
  const missingKeys = new Set<string>();
  for (const log of logs) {
    if (!log.blockHash) continue;
    const hash = log.blockHash.toLowerCase();
    if (cache.has(hash)) continue;
    const recentKey = recentBlockTimeKey(chainId, hash);
    if (recentBlockTimes.has(recentKey)) {
      const value = recentBlockTimes.get(recentKey) ?? null;
      recentBlockTimes.delete(recentKey);
      recentBlockTimes.set(recentKey, value);
      cache.set(hash, value);
    } else {
      missingKeys.add(hash);
    }
  }
  const missing = [...missingKeys];
  const pageOffsets = Array.from(
    { length: Math.ceil(missing.length / LOOKUP_CHUNK) },
    (_, page) => page * LOOKUP_CHUNK,
  );
  await forEachWithConcurrency(pageOffsets, BLOCK_TIME_DB_CONCURRENCY, async (index) => {
    const hashes = missing.slice(index, index + LOOKUP_CHUNK);
    const rows = await prisma.$queryRaw<Array<{ blockHash: string; blockTime: Date }>>(Prisma.sql`
        SELECT
          observation.block_hash AS "blockHash",
          MAX(observation.block_time) AS "blockTime"
        FROM evm_event_observations AS observation
        WHERE observation.chain_id = ${chainId}
          AND observation.block_hash IN (${Prisma.join(hashes)})
          AND observation.block_time IS NOT NULL
        GROUP BY observation.block_hash
      `);
    for (const row of rows) {
      const hash = row.blockHash.toLowerCase();
      cache.set(hash, row.blockTime);
      retainRecentBlockTime(chainId, hash, row.blockTime);
    }
  });
}

/**
 * Resolve the genuinely new block hashes in a log page concurrently. The RPC
 * transport still applies its distributed rate and inflight budgets; this only
 * removes the per-log serial waterfall within one already-bounded scan page.
 */
export async function hydrateMissingBlockTimes(
  chainId: number,
  client: PublicClient,
  logs: readonly Pick<Log<bigint, number, false, undefined, true>, "blockHash" | "blockNumber">[],
  cache: Map<string, Date | null>,
  signal?: AbortSignal,
): Promise<void> {
  const missing = new Map<string, { hash: Hex; blockNumber: bigint }>();
  for (const log of logs) {
    if (log.blockHash == null || log.blockNumber == null) continue;
    const key = log.blockHash.toLowerCase();
    if (cache.has(key)) continue;
    const existing = missing.get(key);
    if (existing && existing.blockNumber !== log.blockNumber) {
      throw new Error(`block hash ${log.blockHash} appeared at conflicting heights`);
    }
    if (!existing) missing.set(key, { hash: log.blockHash, blockNumber: log.blockNumber });
  }
  await forEachWithConcurrency(
    [...missing.entries()],
    BLOCK_TIME_RPC_CONCURRENCY,
    async ([key, coordinate]) => {
      if (signal?.aborted) throw signal.reason;
      const block = await client.getBlock({ blockHash: coordinate.hash, includeTransactions: false });
      if (block.number !== coordinate.blockNumber) {
        throw new Error(`block hash ${coordinate.hash} resolved to unexpected height`);
      }
      const value = block.timestamp == null ? null : new Date(Number(block.timestamp) * 1_000);
      cache.set(key, value);
      retainRecentBlockTime(chainId, key, value);
    },
  );
}
