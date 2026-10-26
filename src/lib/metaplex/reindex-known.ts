/**
 * Re-index Metaplex agents already in Postgres (known asset addresses).
 *
 * Indexes already-known Metaplex agents through the shared discovery implementation.
 * and use the capped partner.metaplex.discover pg-boss job after RPC rate-limit validation.
 */
import type { Prisma } from "@/generated/prisma/client";
import {
  indexMetaplexAgentWithSnapshotLockHeld,
  withMetaplexManualIndexLock,
} from "../../../services/metaplex-indexer";
import { prisma } from "@/lib/db";
import { METAPLEX_LISTING_REGISTRY_SOURCE } from "@/lib/metaplex/config";
import { mapWithConcurrency } from "@/lib/metaplex/bulk-index";
import type {
  MetaplexReindexKnownOptions,
  MetaplexReindexKnownResult,
  MetaplexReindexKnownResultItem,
} from "@/lib/metaplex/types";
export const METAPLEX_REINDEX_DEFAULT_LIMIT = 50;
export const METAPLEX_REINDEX_MAX_LIMIT = 100;
export const METAPLEX_REINDEX_DEFAULT_CONCURRENCY = 2;
export function clampReindexLimit(limit: number | undefined): number {
  const n = limit ?? METAPLEX_REINDEX_DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return METAPLEX_REINDEX_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), METAPLEX_REINDEX_MAX_LIMIT);
}
export function parseStaleHours(staleHours: number | undefined): number | undefined {
  if (staleHours == null || !Number.isFinite(staleHours) || staleHours <= 0) {
    return undefined;
  }
  return staleHours;
}
export function staleCutoffFromHours(staleHours: number): Date {
  return new Date(Date.now() - staleHours * 60 * 60 * 1000);
}
export function buildMetaplexReindexKnownWhere(
  staleHours?: number,
): Prisma.AgentWhereInput {
  const where: Prisma.AgentWhereInput = {
    listingRegistrySource: METAPLEX_LISTING_REGISTRY_SOURCE,
    metaplexAssetAddress: { not: null },
  };
  const hours = parseStaleHours(staleHours);
  if (hours != null) {
    where.OR = [
      { metaplexLastIndexedAt: null },
      { metaplexLastIndexedAt: { lt: staleCutoffFromHours(hours) } },
    ];
  }
  return where;
}
async function indexOneAsset(
  assetAddress: string,
  signal: AbortSignal,
): Promise<MetaplexReindexKnownResultItem> {
  try {
    const result = await indexMetaplexAgentWithSnapshotLockHeld(assetAddress, signal);
    if (!result.ok) {
      return {
        assetAddress,
        ok: false,
        error: result.error ?? "Indexing failed",
      };
    }
    return {
      assetAddress,
      ok: true,
      agentDbId: result.agentDbId,
      profilePath: result.profilePath,
      profileUrl: result.profileUrl,
    };
  } catch (err) {
    if (signal.aborted) throw signal.reason ?? err;
    const msg = Error.isError(err) ? err.message : String(err);
    return {
      assetAddress,
      ok: false,
      error: msg,
    };
  }
}
export async function reindexKnownMetaplexAgents(
  options: MetaplexReindexKnownOptions = {},
): Promise<MetaplexReindexKnownResult> {
  const limit = clampReindexLimit(options.limit);
  const concurrency = Math.max(
    1,
    Math.min(
      options.concurrency ?? METAPLEX_REINDEX_DEFAULT_CONCURRENCY,
      METAPLEX_REINDEX_MAX_LIMIT,
    ),
  );
  const dryRun = options.dryRun === true;
  const where = buildMetaplexReindexKnownWhere(options.staleHours);
  const [totalCandidates, rows] = await Promise.all([
    prisma.agent.count({ where }),
    prisma.agent.findMany({
      where,
      orderBy: [{ metaplexLastIndexedAt: { sort: "asc", nulls: "first" } }],
      take: limit,
      select: {
        id: true,
        metaplexAssetAddress: true,
        metaplexLastIndexedAt: true,
      },
    }),
  ]);
  const assetAddresses = rows
    .map((row) => row.metaplexAssetAddress?.trim())
    .filter((addr): addr is string => Boolean(addr));
  if (dryRun) {
    const results: MetaplexReindexKnownResultItem[] = assetAddresses.map((assetAddress) => ({
      assetAddress,
      ok: true,
    }));
    return {
      ok: true,
      totalCandidates,
      attempted: 0,
      succeeded: results.length,
      failed: 0,
      skipped: results.length,
      dryRun: true,
      results,
    };
  }
  const results = assetAddresses.length === 0
    ? []
    : await withMetaplexManualIndexLock(undefined, (lockedSignal) =>
        mapWithConcurrency(
          assetAddresses,
          concurrency,
          (assetAddress) => indexOneAsset(assetAddress, lockedSignal),
        ),
      );
  const attempted = results.length;
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  return {
    ok: failed === 0,
    totalCandidates,
    attempted,
    succeeded,
    failed,
    skipped: Math.max(0, totalCandidates - attempted),
    dryRun: false,
    results,
  };
}
