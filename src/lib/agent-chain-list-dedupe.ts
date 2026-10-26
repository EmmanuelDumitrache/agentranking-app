import {
  chainLogoStackFromCluster,
  deploymentKey,
  parseRegistrationRef,
  type AgentChainCluster,
  type DeploymentHandle,
} from "@/lib/agent-chain-cluster";
import {
  loadAgentChainClusterDeployments,
  loadAgentChainClustersBatch,
  loadDeploymentDbHints,
  loadExpandedRegistrationMetaBatch,
  type RegistrationMetaSeed,
} from "@/lib/agent-chain-cluster-server";
import {
  mergeListClusterMetaWithSapTwin,
  mergeListRegistrationEntries,
  mergeListRegistrationRefs,
} from "@/lib/agent-profile-deployments";
import type { RegistrationMetaEntry } from "@/lib/agent-identity";
import {
  getCachedSapTwinIndex,
  resolveUniqueSapTwinForEvmRow,
  type AgentRowForSapTwin,
  type SapTwinIndex,
  type SapTwinRef,
} from "@/lib/sap-name-twin";
import { mapWithConcurrency } from "@/lib/async-pool";
import {
  collapseListRowsByClusterMeta,
  filterSapRowsHiddenByEvmTwin as filterSapRowsHiddenByEvmTwinCore,
  shouldSkipListClusterGraphWalk,
  type AgentListRowWithCluster,
  type ListAgentClusterMeta,
} from "@/lib/agent-chain-list-dedupe-core";
export {
  collapseListRowsByClusterMeta,
  shouldSkipListClusterGraphWalk,
  type AgentListRowWithCluster,
  type ListAgentClusterMeta,
} from "@/lib/agent-chain-list-dedupe-core";
function resolveSapTwinRefForListRow(
  row: AgentRowForSapTwin & { sapTwinMatch?: boolean },
  index: SapTwinIndex,
): SapTwinRef | null {
  if (!row.sapTwinMatch) return null;
  return resolveUniqueSapTwinForEvmRow(row, index);
}
/** Hide standalone SAP rows when a unique EVM twin is in the same batch. */
export function filterSapRowsHiddenByEvmTwin<
  T extends { id: number; chainId: number; agentId: number; name: string } & AgentRowForSapTwin,
>(rows: T[], index: SapTwinIndex): T[] {
  return filterSapRowsHiddenByEvmTwinCore(rows, (row) => resolveUniqueSapTwinForEvmRow(row, index));
}
/**
 * Collapse list rows that share a multi-chain cluster; keep canonical deployment row.
 */
export async function dedupeAgentListByCluster<
  T extends { chainId: number; agentId: number; id?: number; name?: string } & AgentRowForSapTwin & {
      sapTwinMatch?: boolean;
    },
>(agents: T[]): Promise<AgentListRowWithCluster<T>[]> {
  const index = await getCachedSapTwinIndex();
  const withoutSapDupes = filterSapRowsHiddenByEvmTwin(
    agents.filter((a): a is T & { id: number } => typeof a.id === "number"),
    index,
  ) as T[];
  const withMeta = await attachClusterMetaToList(withoutSapDupes.length > 0 ? withoutSapDupes : agents, index);
  return collapseListRowsByClusterMeta(withMeta);
}
function clusterMetaFromCluster(cluster: AgentChainCluster | null): ListAgentClusterMeta {
  if (!cluster || cluster.deploymentCount <= 1) {
    return {
      clusterKey: null,
      deploymentCount: 1,
      canonicalChainId: null,
      canonicalAgentId: null,
      chainLogoStack: [],
      clusterChainVerified: false,
      clusterIdentityRegistered: false,
    };
  }
  return {
    clusterKey: cluster.clusterKey,
    deploymentCount: cluster.deploymentCount,
    canonicalChainId: cluster.canonicalChainId,
    canonicalAgentId: cluster.canonicalAgentId,
    chainLogoStack: chainLogoStackFromCluster(cluster),
    clusterChainVerified: cluster.clusterChainVerified,
    clusterIdentityRegistered: cluster.deploymentCount > 1,
  };
}
function registrationsMetaFromRow(
  metadata: ReadonlyArray<{ key: string; value: string }> | undefined,
): string | null {
  if (!metadata?.length) return null;
  return metadata.find((m) => m.key === "registrations")?.value ?? null;
}
function handlesFromRegistrationEntries(
  seedChainId: number,
  seedAgentId: number,
  entries: readonly RegistrationMetaEntry[],
): DeploymentHandle[] {
  const byKey = new Map<string, DeploymentHandle>();
  const add = (handle: DeploymentHandle) => {
    byKey.set(deploymentKey(handle.chainId, handle.agentId), handle);
  };
  add({ chainId: seedChainId, agentId: seedAgentId });
  for (const entry of entries) {
    const ref = parseRegistrationRef(entry);
    if (ref) add(ref);
  }
  return [...byKey.values()];
}
function enrichRowWithDeploymentStackMeta<
  T extends AgentRowForSapTwin & {
    sapTwinMatch?: boolean;
    metadata?: ReadonlyArray<{ key: string; value: string }>;
  },
>(
  row: AgentListRowWithCluster<T>,
  index: Awaited<ReturnType<typeof getCachedSapTwinIndex>>,
): AgentListRowWithCluster<T> {
  let enriched = row;
  if (row.sapTwinMatch) {
    const ref = resolveSapTwinRefForListRow(row, index);
    enriched = mergeListClusterMetaWithSapTwin(enriched, ref);
  }
  enriched = mergeListRegistrationRefs(enriched, registrationsMetaFromRow(row.metadata));
  return enriched;
}
async function expandListRowsWithRegistrationGraph<
  T extends { chainId: number; agentId: number; agentURI?: string | null } & AgentRowForSapTwin & {
      sapTwinMatch?: boolean;
      metadata?: ReadonlyArray<{ key: string; value: string }>;
    },
>(rows: AgentListRowWithCluster<T>[], agents: T[]): Promise<AgentListRowWithCluster<T>[]> {
  const expansionTargets: { rowIndex: number; seed: RegistrationMetaSeed }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.deploymentCount > 1) continue;
    const agent = agents[i];
    if (!agent) continue;
    expansionTargets.push({
      rowIndex: i,
      seed: {
        chainId: agent.chainId,
        agentId: agent.agentId,
        metadata: agent.metadata ?? [],
        agentURI: agent.agentURI,
      },
    });
  }
  if (expansionTargets.length === 0) return rows;
  const expandedBatch = await loadExpandedRegistrationMetaBatch(
    expansionTargets.map((target) => target.seed),
  );
  const next = [...rows];
  const handleBuckets = new Map<number, DeploymentHandle[]>();
  for (const { rowIndex, seed } of expansionTargets) {
    const key = deploymentKey(seed.chainId, seed.agentId);
    const entries = expandedBatch.get(key);
    if (!entries?.length) continue;
    next[rowIndex] = mergeListRegistrationEntries(next[rowIndex]!, entries);
    handleBuckets.set(rowIndex, handlesFromRegistrationEntries(seed.chainId, seed.agentId, entries));
  }
  const uniqueHandles = new Map<string, DeploymentHandle>();
  for (const handles of handleBuckets.values()) {
    for (const handle of handles) {
      uniqueHandles.set(deploymentKey(handle.chainId, handle.agentId), handle);
    }
  }
  if (uniqueHandles.size === 0) return next;
  const hints = await loadDeploymentDbHints([...uniqueHandles.values()]);
  for (const [rowIndex, handles] of handleBuckets) {
    const verified = handles.some((handle) => {
      const key = deploymentKey(handle.chainId, handle.agentId);
      return hints.chainVerifiedByKey.get(key) === true;
    });
    if (verified) {
      next[rowIndex] = { ...next[rowIndex]!, clusterChainVerified: true };
    }
  }
  return next;
}
/** Attach cluster meta without removing duplicate rows (for network hub pages filtered by chain). */
export async function attachClusterMetaToList<
  T extends { chainId: number; agentId: number; clusterKey?: string | null; agentURI?: string | null } &
    AgentRowForSapTwin & {
      sapTwinMatch?: boolean;
      metadata?: ReadonlyArray<{ key: string; value: string }>;
    },
>(
  agents: T[],
  sapTwinIndex?: Awaited<ReturnType<typeof getCachedSapTwinIndex>>,
): Promise<AgentListRowWithCluster<T>[]> {
  if (agents.length === 0) return [];
  const index = sapTwinIndex ?? (await getCachedSapTwinIndex());
  const storedKeys = [
    ...new Set(
      agents
        .map((a) => a.clusterKey?.trim())
        .filter((k): k is string => Boolean(k)),
    ),
  ];
  const clusterByStoredKey = new Map<string, AgentChainCluster | null>();
  const clusterKeyConcurrency =
    process.env.NODE_ENV === "development" ? 3 : 6;
  await mapWithConcurrency(storedKeys, clusterKeyConcurrency, async (key) => {
    const seed = agents.find((a) => a.clusterKey?.trim() === key);
    if (!seed) return;
    const cluster = await loadAgentChainClusterDeployments(seed.chainId, seed.agentId, {
      clusterKey: key,
    });
    clusterByStoredKey.set(key, cluster);
  });
  const skipGraphWalk = shouldSkipListClusterGraphWalk();
  const graphSeeds = skipGraphWalk
    ? []
    : agents.filter((a) => !a.clusterKey?.trim());
  const clusterBySeed =
    graphSeeds.length > 0
      ? await loadAgentChainClustersBatch(
          graphSeeds.map((a) => ({ chainId: a.chainId, agentId: a.agentId })),
        )
      : new Map<string, AgentChainCluster | null>();
  let rows = agents.map((agent) => {
    const storedKey = agent.clusterKey?.trim();
    const cluster = storedKey
      ? (clusterByStoredKey.get(storedKey) ?? null)
      : (clusterBySeed.get(deploymentKey(agent.chainId, agent.agentId)) ?? null);
    const meta = clusterMetaFromCluster(cluster);
    const base: AgentListRowWithCluster<T> = {
      ...agent,
      ...meta,
      clusterKey: meta.clusterKey ?? storedKey ?? null,
    };
    return enrichRowWithDeploymentStackMeta(base, index);
  });
  if (!skipGraphWalk) {
    rows = await expandListRowsWithRegistrationGraph(rows, agents);
  }
  return rows;
}
