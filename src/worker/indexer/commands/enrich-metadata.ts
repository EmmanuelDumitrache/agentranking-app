/**
 * Re-fetch on-chain registration JSON and rewrite Agent + AgentMetadata using the same
 * logic as live sync (`upsertAgentFromChain`), so new metadata keys (mcpTools, socials, etc.)
 * backfill for existing rows.
 *
 * Env:
 *   ENRICH_LIMIT=300          Max agents to process (default 300)
 *   ENRICH_CONCURRENCY=5      Parallel upserts (default 5)
 *   ENRICH_CHAIN_IDS=1,8453   Optional subset; default = all syncable EVM chains
 *   ENRICH_SOLANA=true        Also run one full direct Solana 8004 snapshot pass
 *
 * This command module is invoked by the worker command surface, not a package script.
 */
import "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import { loadActiveBlocklistRules, upsertAgentFromChain } from "../sync/agents.js";
import { getSyncableChainIds } from "../sync/rpc.js";
import { runDirectSolana8004Snapshot } from "../sync/solana-8004/snapshot.js";
import { parseOptionalStrictUnsignedInteger, parseStrictUnsignedInteger } from "../lib/strict-integer.js";
import { mapSideEffectsDrainOnError } from "../lib/concurrency.js";
const LIMIT = parseOptionalStrictUnsignedInteger(process.env.ENRICH_LIMIT, "ENRICH_LIMIT", 300, { maximum: 1_000_000 });
const CONCURRENCY = parseOptionalStrictUnsignedInteger(process.env.ENRICH_CONCURRENCY, "ENRICH_CONCURRENCY", 5, { maximum: 1024 });
const CHAIN_FILTER = process.env.ENRICH_CHAIN_IDS?.split(",").map((token) => parseStrictUnsignedInteger(token.trim(), "ENRICH_CHAIN_IDS entry", { maximum: 2_147_483_647 }));
const RUN_SOLANA = (process.env.ENRICH_SOLANA ?? "").toLowerCase() === "true" || process.env.ENRICH_SOLANA === "1";
async function pickCandidates(chainIds: number[], take: number): Promise<Array<{ agentId: number; chainId: number }>> {
  if (chainIds.length === 0 || take <= 0) return [];
  const seen = new Set<string>();
  const out: Array<{ agentId: number; chainId: number }> = [];
  // Keep this candidate scan on the ORM path so it shares the worker pool and transaction settings.
  const withServicesNoMcp = await prisma.agent.findMany({
    where: {
      chainId: { in: chainIds },
      services: { some: {} },
      NOT: { metadata: { some: { key: "mcpTools" } } },
    },
    take,
    select: { agentId: true, chainId: true },
  });
  for (const row of withServicesNoMcp) {
    const k = `${row.chainId}:${row.agentId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  const remaining = take - out.length;
  if (remaining > 0) {
    const sparseMeta = await prisma.agent.findMany({
      where: {
        chainId: { in: chainIds },
        metadata: { some: {} },
      },
      take: Math.min(800, remaining * 15),
      select: { agentId: true, chainId: true, metadata: { select: { id: true } } },
    });
    for (const row of sparseMeta) {
      const n = row.metadata.length;
      if (n < 1 || n > 2) continue;
      const k = `${row.chainId}:${row.agentId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ agentId: row.agentId, chainId: row.chainId });
      if (out.length >= take) break;
    }
  }
  return out;
}
async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  await mapSideEffectsDrainOnError(items, concurrency, async (item) => fn(item));
}
async function main(): Promise<void> {
  if (RUN_SOLANA) {
    try {
      logger.info("enrich-metadata: running direct Solana 8004 snapshot", {}, "sync");
      const r = await runDirectSolana8004Snapshot();
      logger.info("enrich-metadata: Solana 8004 snapshot done", { ...r }, "sync");
    } catch (e) {
      logger.warn("enrich-metadata: Solana 8004 snapshot skipped/failed", { error: Error.isError(e) ? e.message : String(e) }, "sync");
    }
  }
  let chainIds = getSyncableChainIds().filter((id) => id !== SOLANA_CHAIN_ID);
  if (CHAIN_FILTER && CHAIN_FILTER.length > 0) {
    chainIds = chainIds.filter((id) => CHAIN_FILTER.includes(id));
  }
  if (chainIds.length === 0) {
    throw new Error("enrich-metadata: no EVM chains to process (RPC / SYNC_CHAIN_IDS)");
  }
  const candidates = await pickCandidates(chainIds, LIMIT);
  if (candidates.length === 0) {
    logger.info("enrich-metadata: no candidates (try ENRICH_SOLANA=true or lower bar)", { chainIds, limit: LIMIT }, "sync");
    return;
  }
  logger.info("enrich-metadata: upserting", { count: candidates.length, concurrency: CONCURRENCY }, "sync");
  const blocklistRules = await loadActiveBlocklistRules();
  let ok = 0;
  let fail = 0;
  await runPool(candidates, CONCURRENCY, async ({ agentId, chainId }) => {
    try {
      await upsertAgentFromChain(chainId, agentId, { blocklistRules });
      ok++;
    } catch (e) {
      fail++;
      logger.warn("enrich-metadata: upsert failed", {
        chainId,
        agentId,
        error: Error.isError(e) ? e.message : String(e),
      }, "sync");
    }
  });
  logger.info("enrich-metadata: complete", { ok, fail, total: candidates.length }, "sync");
}
void main()
  .catch((error) => {
    logger.error(
      "enrich-metadata: fatal",
      { error: Error.isError(error) ? error.message : String(error) },
      "sync",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });