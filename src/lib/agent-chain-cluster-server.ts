import {
  getPublicApiCached,
  getPublicApiCacheNamespaceGeneration,
} from "@/lib/public-api-cache";
import { agentPayloadCacheDomain } from "@/lib/public-cache-domains";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { normalizeAgentNameKey } from "@/lib/agent-name-key";
import {
  extractRegistrationsFromAgentUri,
  parseRegistrationMetadata,
  type RegistrationMetaEntry,
} from "@/lib/agent-identity";
import { fetchRemoteAgentUriRegistrations } from "@/lib/agent-uri-remote";
import { mapWithConcurrency } from "@/lib/async-pool";
import { getOrInsert } from "@/lib/map-upsert";
import { allowAgentDetailCacheInDev, skipExternalEnrichment } from "@/lib/fast-local";
import { loadChainVerifiedMap } from "@/lib/validation-registry-sync";
import {
  buildAgentChainCluster,
  clusterKeyFromCanonical,
  computeRegistrationFingerprint,
  deploymentKey,
  expandClusterHandles,
  parseRegistrationRef,
  toPublicChainCluster,
  type AgentChainCluster,
  type ClusterAgentRow,
  type DeploymentHandle,
} from "@/lib/agent-chain-cluster";
const CLUSTER_AGENT_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  owner: true,
  agentURI: true,
  score: true,
  listedAt: true,
  x402Support: true,
  description: true,
  image: true,
  services: { select: { name: true, endpoint: true } },
  metadata: { select: { key: true, value: true } },
} as const;
type AgentRow = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.agent.findUnique<{
        where: { agentId_chainId: { agentId: number; chainId: number } };
        select: typeof CLUSTER_AGENT_SELECT;
      }>
    >
  >
>;
function rowToClusterAgent(row: NonNullable<AgentRow>): ClusterAgentRow {
  const registrationsRaw = row.metadata.find((m) => m.key === "registrations")?.value;
  const registrationMeta: RegistrationMetaEntry[] = [];
  const seen = new Set<string>();
  const addMeta = (entry: RegistrationMetaEntry) => {
    const ref = parseRegistrationRef(entry);
    if (!ref) return;
    const key = deploymentKey(ref.chainId, ref.agentId);
    if (seen.has(key)) return;
    seen.add(key);
    registrationMeta.push(entry);
  };
  if (registrationsRaw) {
    for (const entry of parseRegistrationMetadata(registrationsRaw)) addMeta(entry);
  }
  for (const entry of extractRegistrationsFromAgentUri(row.agentURI)) addMeta(entry);
  const fpMeta = row.metadata.find((m) => m.key === "registrationFingerprint")?.value?.trim();
  const fingerprint =
    fpMeta ||
    computeRegistrationFingerprint({
      name: row.name,
      description: row.description,
      image: row.image,
      x402Support: row.x402Support,
      services: row.services,
    });
  return {
    id: row.id,
    agentId: row.agentId,
    chainId: row.chainId,
    name: row.name,
    owner: row.owner,
    agentURI: row.agentURI,
    score: row.score,
    listedAtMs: row.listedAt.getTime(),
    x402Support: row.x402Support,
    description: row.description,
    image: row.image,
    services: row.services,
    registrationMeta,
    fingerprint,
  };
}
async function loadAgentsByHandles(handles: DeploymentHandle[]): Promise<AgentRow[]> {
  if (handles.length === 0) return [];
  const unique = new Map<string, DeploymentHandle>();
  for (const h of handles) unique.set(deploymentKey(h.chainId, h.agentId), h);
  return withTransientPoolRetry(() =>
    prisma.agent.findMany({
      where: {
        OR: [...unique.values()].map((h) => ({
          chainId: h.chainId,
          agentId: h.agentId,
        })),
      },
      select: CLUSTER_AGENT_SELECT,
    }),
  );
}
async function discoverSiblingHandles(seed: ClusterAgentRow): Promise<DeploymentHandle[]> {
  const handles = new Map<string, DeploymentHandle>();
  const add = (h: DeploymentHandle) => handles.set(deploymentKey(h.chainId, h.agentId), h);
  add({ chainId: seed.chainId, agentId: seed.agentId });
  for (const meta of seed.registrationMeta) {
    const ref = parseRegistrationRef(meta);
    if (ref) add(ref);
  }
  for (const meta of extractRegistrationsFromAgentUri(seed.agentURI)) {
    const ref = parseRegistrationRef(meta);
    if (ref) add(ref);
  }
  if (seed.fingerprint) {
    const fpRows = await withTransientPoolRetry(() =>
      prisma.agentMetadata.findMany({
        where: { key: "registrationFingerprint", value: seed.fingerprint! },
        select: { agent: { select: { chainId: true, agentId: true } } },
        take: 32,
      }),
    );
    for (const r of fpRows) {
      add({ chainId: r.agent.chainId, agentId: r.agent.agentId });
    }
  }
  const owner = seed.owner.trim().toLowerCase();
  const uri = seed.agentURI.trim();
  if (owner && uri) {
    const ownerRows = await withTransientPoolRetry(() =>
      prisma.agent.findMany({
        where: {
          owner: { equals: seed.owner, mode: "insensitive" },
          agentURI: uri,
        },
        select: { chainId: true, agentId: true },
        take: 32,
      }),
    );
    for (const r of ownerRows) add({ chainId: r.chainId, agentId: r.agentId });
  }
  const seedNameKey = normalizeAgentNameKey(seed.name);
  // A normalized name is only a tie-breaker. It must never expand a cluster
  // without independent owner, URI, registry, or fingerprint evidence.
  if (owner.length >= 10) {
    const ownerRows = await withTransientPoolRetry(() =>
      prisma.agent.findMany({
        where: {
          isActive: true,
          owner: { equals: seed.owner, mode: "insensitive" },
          NOT: { chainId: seed.chainId, agentId: seed.agentId },
        },
        select: { chainId: true, agentId: true, name: true },
        take: 24,
      }),
    );
    for (const r of ownerRows) {
      const sameName = normalizeAgentNameKey(r.name) === seedNameKey;
      if (sameName && seedNameKey != null) {
        add({ chainId: r.chainId, agentId: r.agentId });
      }
    }
  }
  if (!skipExternalEnrichment()) {
    // Reverse graph: other agents whose `registrations` metadata point at this deployment.
    const reverseRows = await withTransientPoolRetry(() =>
      prisma.agentMetadata.findMany({
        where: {
          key: "registrations",
          OR: [
            { value: { contains: `"agentId":${seed.agentId}` } },
            { value: { contains: `"agentId": ${seed.agentId}` } },
          ],
        },
        select: {
          value: true,
          agent: { select: { chainId: true, agentId: true } },
        },
        take: 48,
      }),
    );
    for (const row of reverseRows) {
      const refs = parseRegistrationMetadata(row.value);
      for (const meta of refs) {
        const ref = parseRegistrationRef(meta);
        if (
          ref &&
          ref.chainId === seed.chainId &&
          ref.agentId === seed.agentId &&
          (row.agent.chainId !== seed.chainId || row.agent.agentId !== seed.agentId)
        ) {
          add({ chainId: row.agent.chainId, agentId: row.agent.agentId });
        }
      }
    }
  }
  return [...handles.values()];
}
async function fetchClusterByStoredKey(
  clusterKey: string,
  currentChainId: number,
  currentAgentId: number,
): Promise<AgentChainCluster | null> {
  const rows = await withTransientPoolRetry(() =>
    prisma.agent.findMany({
      where: { clusterKey },
      select: CLUSTER_AGENT_SELECT,
    }),
  );
  if (rows.length === 0) return null;
  const deploymentRows: ClusterAgentRow[] = rows.map((row) =>
    rowToClusterAgent(row),
  );
  const handles = deploymentRows.map((r) => ({ chainId: r.chainId, agentId: r.agentId }));
  const rawVerified = await loadChainVerifiedMap(handles);
  return buildAgentChainCluster(currentChainId, currentAgentId, deploymentRows, rawVerified);
}
async function fetchAgentChainClusterGraphWalk(
  chainId: number,
  agentId: number,
): Promise<AgentChainCluster | null> {
  const seedRow = await withTransientPoolRetry(() =>
    prisma.agent.findUnique({
      where: { agentId_chainId: { agentId, chainId } },
      select: CLUSTER_AGENT_SELECT,
    }),
  );
  if (!seedRow) return null;
  const seed = rowToClusterAgent(seedRow);
  const initialHandles = await discoverSiblingHandles(seed);
  return buildClusterFromHandleSet(chainId, agentId, initialHandles);
}
async function buildClusterFromHandleSet(
  currentChainId: number,
  currentAgentId: number,
  handles: DeploymentHandle[],
): Promise<AgentChainCluster | null> {
  const unique = new Map<string, DeploymentHandle>();
  unique.set(deploymentKey(currentChainId, currentAgentId), {
    chainId: currentChainId,
    agentId: currentAgentId,
  });
  for (const h of handles) {
    unique.set(deploymentKey(h.chainId, h.agentId), h);
  }
  const loadedRows = await loadAgentsByHandles([...unique.values()]);
  if (loadedRows.length === 0) return null;
  const rowMap = new Map<string, ClusterAgentRow>();
  for (const row of loadedRows) {
    rowMap.set(
      deploymentKey(row.chainId, row.agentId),
      rowToClusterAgent(row),
    );
  }
  const MAX_REF_EXPANSION_PASSES = 4;
  for (let pass = 0; pass < MAX_REF_EXPANSION_PASSES; pass++) {
    const expanded = expandClusterHandles(
      { chainId: currentChainId, agentId: currentAgentId },
      rowMap,
    );
    const missing = expanded.filter((h) => !rowMap.has(deploymentKey(h.chainId, h.agentId)));
    if (missing.length === 0) break;
    const extra = await loadAgentsByHandles(missing);
    if (extra.length === 0) break;
    for (const row of extra) {
      rowMap.set(
        deploymentKey(row.chainId, row.agentId),
        rowToClusterAgent(row),
      );
    }
  }
  const finalHandles = expandClusterHandles(
    { chainId: currentChainId, agentId: currentAgentId },
    rowMap,
  );
  const deploymentRows = finalHandles
    .map((h) => rowMap.get(deploymentKey(h.chainId, h.agentId)))
    .filter((r): r is ClusterAgentRow => r != null);
  const rawVerified = await loadChainVerifiedMap(finalHandles);
  return buildAgentChainCluster(currentChainId, currentAgentId, deploymentRows, rawVerified);
}
async function fetchAgentChainClusterCore(
  chainId: number,
  agentId: number,
  storedClusterKey?: string | null,
): Promise<AgentChainCluster | null> {
  const key = storedClusterKey?.trim();
  if (skipExternalEnrichment() && key) {
    return fetchClusterByStoredKey(key, chainId, agentId);
  }
  const fromGraph = await fetchAgentChainClusterGraphWalk(chainId, agentId);
  const canonicalKey = clusterKeyFromCanonical(chainId, agentId);
  const handleSet = new Map<string, DeploymentHandle>();
  const add = (h: DeploymentHandle) => handleSet.set(deploymentKey(h.chainId, h.agentId), h);
  add({ chainId, agentId });
  if (fromGraph) {
    for (const d of fromGraph.deployments) {
      add({ chainId: d.chainId, agentId: d.agentId });
    }
  }
  const keysToUnion = new Set<string>();
  if (key) keysToUnion.add(key);
  if (!key || key !== canonicalKey) keysToUnion.add(canonicalKey);
  for (const clusterKey of keysToUnion) {
    const keyRows = await withTransientPoolRetry(() =>
      prisma.agent.findMany({
        where: { clusterKey },
        select: { chainId: true, agentId: true },
      }),
    );
    for (const r of keyRows) {
      add({ chainId: r.chainId, agentId: r.agentId });
    }
  }
  if (handleSet.size <= 1 && !fromGraph) {
    return fromGraph;
  }
  const merged = await buildClusterFromHandleSet(chainId, agentId, [...handleSet.values()]);
  return merged ?? fromGraph;
}
export type LoadClusterDeploymentsOptions = {
  clusterKey?: string | null;
};
export type RegistrationMetaSeed = {
  chainId: number;
  agentId: number;
  metadata: ReadonlyArray<{ key: string; value: string }>;
  agentURI?: string | null;
};
function registrationEntryMap(): Map<string, RegistrationMetaEntry> {
  return new Map();
}
function addRegistrationEntry(
  seen: Map<string, RegistrationMetaEntry>,
  entry: RegistrationMetaEntry,
): void {
  const ref = parseRegistrationRef(entry);
  if (!ref) return;
  const key = deploymentKey(ref.chainId, ref.agentId);
  getOrInsert(seen, key, entry);
}
function collectLocalRegistrationEntries(
  seen: Map<string, RegistrationMetaEntry>,
  seed: RegistrationMetaSeed,
): void {
  const raw = seed.metadata.find((m) => m.key.toLowerCase() === "registrations")?.value;
  if (raw) {
    for (const entry of parseRegistrationMetadata(raw)) addRegistrationEntry(seen, entry);
  }
  for (const entry of extractRegistrationsFromAgentUri(seed.agentURI)) {
    addRegistrationEntry(seen, entry);
  }
}
async function mergeReverseRegistrationGraph(
  seen: Map<string, RegistrationMetaEntry>,
  chainId: number,
  agentId: number,
): Promise<void> {
  const reverseRows = await withTransientPoolRetry(() =>
    prisma.agentMetadata.findMany({
      where: {
        key: "registrations",
        OR: [
          { value: { contains: `"agentId":${agentId}` } },
          { value: { contains: `"agentId": ${agentId}` } },
        ],
      },
      select: {
        value: true,
        agent: { select: { chainId: true, agentId: true } },
      },
      take: 32,
    }),
  );
  for (const row of reverseRows) {
    const refs = parseRegistrationMetadata(row.value);
    const pointsAtSeed = refs.some((meta) => {
      const ref = parseRegistrationRef(meta);
      return ref?.chainId === chainId && ref?.agentId === agentId;
    });
    if (!pointsAtSeed) continue;
    addRegistrationEntry(seen, { chainId: row.agent.chainId, agentId: row.agent.agentId });
    for (const entry of refs) addRegistrationEntry(seen, entry);
  }
}
/** Union registrations from metadata, agentURI, and reverse metadata graph (no cluster required). */
export async function loadExpandedRegistrationMeta(
  chainId: number,
  agentId: number,
  metadata: ReadonlyArray<{ key: string; value: string }>,
  agentURI: string | null | undefined,
): Promise<RegistrationMetaEntry[]> {
  const seen = registrationEntryMap();
  collectLocalRegistrationEntries(seen, { chainId, agentId, metadata, agentURI });
  if (!skipExternalEnrichment()) {
    for (const entry of await fetchRemoteAgentUriRegistrations(agentURI)) {
      addRegistrationEntry(seen, entry);
    }
  }
  // DB-only sibling link (not RPC). Required when `registrations` metadata lives on another deployment.
  await mergeReverseRegistrationGraph(seen, chainId, agentId);
  return [...seen.values()];
}
/** Batch registration expansion for list views (skips remote HTTPS agentURI fetch). */
export async function loadExpandedRegistrationMetaBatch(
  seeds: readonly RegistrationMetaSeed[],
): Promise<Map<string, RegistrationMetaEntry[]>> {
  const out = new Map<string, RegistrationMetaEntry[]>();
  if (seeds.length === 0) return out;
  for (const seed of seeds) {
    const seen = registrationEntryMap();
    collectLocalRegistrationEntries(seen, seed);
    out.set(deploymentKey(seed.chainId, seed.agentId), [...seen.values()]);
  }
  const reverseOr = seeds
    .flatMap((seed) => [
      { value: { contains: `"agentId":${seed.agentId}` } },
      { value: { contains: `"agentId": ${seed.agentId}` } },
    ])
    .slice(0, 64);
  if (reverseOr.length === 0) return out;
  const reverseRows = await withTransientPoolRetry(() =>
    prisma.agentMetadata.findMany({
      where: { key: "registrations", OR: reverseOr },
      select: {
        value: true,
        agent: { select: { chainId: true, agentId: true } },
      },
      take: 128,
    }),
  );
  for (const seed of seeds) {
    const key = deploymentKey(seed.chainId, seed.agentId);
    const seen = registrationEntryMap();
    for (const entry of out.get(key) ?? []) addRegistrationEntry(seen, entry);
    for (const row of reverseRows) {
      const refs = parseRegistrationMetadata(row.value);
      const pointsAtSeed = refs.some((meta) => {
        const ref = parseRegistrationRef(meta);
        return ref?.chainId === seed.chainId && ref?.agentId === seed.agentId;
      });
      if (!pointsAtSeed) continue;
      addRegistrationEntry(seen, { chainId: row.agent.chainId, agentId: row.agent.agentId });
      for (const entry of refs) addRegistrationEntry(seen, entry);
    }
    out.set(key, [...seen.values()]);
  }
  return out;
}
export type DeploymentDbHints = {
  indexedKeys: Set<string>;
  slugByKey: Map<string, string>;
  profilePathByKey: Map<string, string>;
  chainVerifiedByKey: Map<string, boolean>;
};
function isAgentChainClusterCacheValue(value: unknown): value is AgentChainCluster | null {
  if (value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Array.isArray(row.deployments) && row.deployments.length <= 1_000;
}
/** Which registration deployments exist in Agent + per-chain Validation Registry attestation. */
export async function loadDeploymentDbHints(
  handles: ReadonlyArray<DeploymentHandle>,
): Promise<DeploymentDbHints> {
  const unique = new Map<string, DeploymentHandle>();
  for (const h of handles) {
    unique.set(deploymentKey(h.chainId, h.agentId), h);
  }
  const list = [...unique.values()];
  const indexedKeys = new Set<string>();
  const slugByKey = new Map<string, string>();
  const profilePathByKey = new Map<string, string>();
  if (list.length > 0) {
    const rows = await withTransientPoolRetry(() =>
      prisma.agent.findMany({
        where: {
          OR: list.map((h) => ({ chainId: h.chainId, agentId: h.agentId })),
          isActive: true,
        },
        select: { chainId: true, agentId: true, name: true },
      }),
    );
    for (const row of rows) {
      const key = deploymentKey(row.chainId, row.agentId);
      indexedKeys.add(key);
      slugByKey.set(key, toAgentUrlSlug(row.name));
      profilePathByKey.set(key, agentPublicPath(row));
    }
  }
  const chainVerifiedByKey = await loadChainVerifiedMap(list);
  return { indexedKeys, slugByKey, profilePathByKey, chainVerifiedByKey };
}
/** Full cluster (all discovered deployments) for profile stacks and identity. */
export async function loadAgentChainClusterDeployments(
  chainId: number,
  agentId: number,
  options?: LoadClusterDeploymentsOptions,
): Promise<AgentChainCluster | null> {
  const storedKey = options?.clusterKey?.trim() || null;
  const useClusterCache =
    process.env.NODE_ENV !== "development" || allowAgentDetailCacheInDev();
  if (!useClusterCache) {
    return fetchAgentChainClusterCore(chainId, agentId, storedKey);
  }
  const cacheNamespace = storedKey
    ? `agent:cluster:key:${storedKey}`
    : agentPayloadCacheDomain(chainId, agentId);
  const cacheGeneration = await getPublicApiCacheNamespaceGeneration(cacheNamespace);
  const result = await getPublicApiCached<AgentChainCluster | null>({
    key: `${cacheNamespace}:g${cacheGeneration}`,
    freshTtlSeconds: 5 * 60,
    staleTtlSeconds: 60 * 60,
    maxPayloadBytes: 4 * 1024 * 1024,
    load: () => fetchAgentChainClusterCore(chainId, agentId, storedKey),
    validate: isAgentChainClusterCacheValue,
  });
  return result.value;
}
export async function loadAgentChainCluster(
  chainId: number,
  agentId: number,
  options?: LoadClusterDeploymentsOptions,
): Promise<AgentChainCluster | null> {
  const cluster = await loadAgentChainClusterDeployments(chainId, agentId, options);
  return toPublicChainCluster(cluster);
}
function clusterBatchConcurrency(): number {
  const fromEnv = Number.parseInt(process.env.CLUSTER_BATCH_CONCURRENCY ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return process.env.NODE_ENV === "development" ? 3 : 6;
}
/** Batch cluster resolution for list views (skips cache for batch freshness). */
export async function loadAgentChainClustersBatch(
  seeds: ReadonlyArray<{ chainId: number; agentId: number }>,
): Promise<Map<string, AgentChainCluster | null>> {
  const out = new Map<string, AgentChainCluster | null>();
  await mapWithConcurrency(seeds, clusterBatchConcurrency(), async ({ chainId, agentId }) => {
    const cluster = await fetchAgentChainClusterCore(chainId, agentId);
    out.set(deploymentKey(chainId, agentId), cluster);
  });
  return out;
}
