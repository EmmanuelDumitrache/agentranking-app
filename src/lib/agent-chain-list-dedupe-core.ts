import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import type { ChainLogoStackItem } from "@/lib/agent-chain-cluster";
import { getOrInsertComputed } from "@/lib/map-upsert";
export type ListAgentClusterMeta = {
  clusterKey: string | null;
  deploymentCount: number;
  canonicalChainId: number | null;
  canonicalAgentId: number | null;
  chainLogoStack: ChainLogoStackItem[];
  clusterChainVerified: boolean;
  clusterIdentityRegistered: boolean;
};
export type AgentListRowWithCluster<T> = T & ListAgentClusterMeta;
/**
 * List views must not graph-walk every row when `cluster_key` is rarely backfilled.
 * Set `AGENT_LIST_SKIP_CLUSTER_GRAPH_WALK=0` to restore full graph enrichment.
 */
export function shouldSkipListClusterGraphWalk(): boolean {
  const raw = process.env.AGENT_LIST_SKIP_CLUSTER_GRAPH_WALK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return process.env.NODE_ENV === "production";
}
/** Collapse rows that already have cluster meta attached (pure; no DB). */
export function collapseListRowsByClusterMeta<
  T extends { chainId: number; agentId: number },
>(
  withMeta: AgentListRowWithCluster<T>[],
): AgentListRowWithCluster<T>[] {
  const singles: AgentListRowWithCluster<T>[] = [];
  const groups = new Map<string, AgentListRowWithCluster<T>[]>();
  for (const row of withMeta) {
    if (row.clusterKey && row.deploymentCount > 1) {
      getOrInsertComputed(groups, row.clusterKey, () => []).push(row);
    } else {
      singles.push(row);
    }
  }
  const deduped: AgentListRowWithCluster<T>[] = [...singles];
  for (const [, group] of groups) {
    const meta = group[0]!;
    const canonical =
      group.find(
        (r) =>
          r.chainId === meta.canonicalChainId && r.agentId === meta.canonicalAgentId,
      ) ?? group[0]!;
    deduped.push(canonical);
  }
  return deduped;
}
/** Hide standalone SAP rows when a unique EVM twin is in the same batch. */
export function filterSapRowsHiddenByEvmTwin<
  T extends { id: number; chainId: number },
>(
  rows: T[],
  getTwinRef: (row: T) => { id: number } | null,
): T[] {
  const evmTwinRefs = new Map<number, { id: number }>();
  for (const row of rows) {
    if (row.chainId === SOLANA_CHAIN_ID) continue;
    const ref = getTwinRef(row);
    if (ref) evmTwinRefs.set(ref.id, ref);
  }
  if (evmTwinRefs.size === 0) return rows;
  return rows.filter((row) => {
    if (row.chainId !== SOLANA_CHAIN_ID) return true;
    return !evmTwinRefs.has(row.id);
  });
}
