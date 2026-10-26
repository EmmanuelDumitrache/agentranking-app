import { getChainByChainId } from "@/lib/chains";
import { getOrInsertComputed } from "@/lib/map-upsert";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { registrationFingerprint } from "@/lib/registration-fingerprint";
export type AgentDeploymentRef = {
  agentDbId: number;
  chainId: number;
  agentId: number;
  name: string;
  slug: string;
  profilePath: string;
  chainName: string;
  chainShortName: string;
  chainIcon: string;
  chainColor: string;
  isCurrent: boolean;
  /** On-chain Validation Registry attestation on this deployment only. */
  rawChainVerified: boolean;
  /** After cluster-wide propagation (any sibling raw verified → all true). */
  chainVerified: boolean;
  score: number;
  listedAtMs: number;
};
export type AgentChainCluster = {
  clusterKey: string;
  canonicalChainId: number;
  canonicalAgentId: number;
  canonicalAgentDbId: number;
  deployments: AgentDeploymentRef[];
  deploymentCount: number;
  clusterChainVerified: boolean;
  /** First chain that has a raw on-chain attestation (for tooltips). */
  verifiedViaChainId: number | null;
};
export type ClusterAgentRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  owner: string;
  agentURI: string;
  score: number;
  listedAtMs: number;
  x402Support: boolean;
  description: string;
  image: string;
  services: ReadonlyArray<{ name: string; endpoint: string }>;
  registrationMeta: ReadonlyArray<{ chainId?: number; agentId?: number; agentRegistry?: string }>;
  fingerprint: string | null;
};
export type DeploymentHandle = {
  chainId: number;
  agentId: number;
};
const AGENT_REGISTRY_RE = /^eip155:(\d+):0x[a-fA-F0-9]{40}$/;
/** Parse ERC-8004 `registrations[]` entry (supports `chainId` or `agentRegistry`). */
export function parseRegistrationRef(entry: {
  agentId?: number;
  chainId?: number;
  agentRegistry?: string;
}): DeploymentHandle | null {
  const agentId = Number(entry.agentId);
  if (!Number.isFinite(agentId) || agentId <= 0) return null;
  if (entry.chainId != null && Number.isFinite(entry.chainId)) {
    return { chainId: Number(entry.chainId), agentId };
  }
  const reg = entry.agentRegistry?.trim() ?? "";
  const m = AGENT_REGISTRY_RE.exec(reg);
  if (!m) return null;
  return { chainId: Number(m[1]), agentId };
}
export function deploymentKey(chainId: number, agentId: number): string {
  return `${chainId}:${agentId}`;
}
export function clusterKeyFromCanonical(chainId: number, agentId: number): string {
  return `cluster:${chainId}:${agentId}`;
}
function normalizeOwner(owner: string): string {
  return owner.trim().toLowerCase();
}
function normalizeUri(uri: string): string {
  return uri.trim();
}
/** Union-find style merge of deployment handles into connected components. */
export function expandClusterHandles(
  seed: DeploymentHandle,
  rows: ReadonlyMap<string, ClusterAgentRow>,
): DeploymentHandle[] {
  const ownerUriIndex = new Map<string, DeploymentHandle[]>();
  const fingerprintIndex = new Map<string, DeploymentHandle[]>();
  for (const row of rows.values()) {
    const handle = { chainId: row.chainId, agentId: row.agentId };
    const owner = normalizeOwner(row.owner);
    const uri = normalizeUri(row.agentURI);
    if (owner && uri) {
      const key = `${owner}\u0000${uri}`;
      getOrInsertComputed(ownerUriIndex, key, () => []).push(handle);
    }
    if (row.fingerprint) {
      getOrInsertComputed(fingerprintIndex, row.fingerprint, () => []).push(handle);
    }
  }
  const discovered: DeploymentHandle[] = [];
  const seen = new Set<string>();
  const add = (handle: DeploymentHandle) => {
    const key = deploymentKey(handle.chainId, handle.agentId);
    if (seen.has(key)) return;
    seen.add(key);
    discovered.push(handle);
  };
  add(seed);
  for (let cursor = 0; cursor < discovered.length; cursor += 1) {
    const handle = discovered[cursor]!;
    const row = rows.get(deploymentKey(handle.chainId, handle.agentId));
    if (!row) continue;
    for (const meta of row.registrationMeta) {
      const ref = parseRegistrationRef(meta);
      if (ref) add(ref);
    }
    const owner = normalizeOwner(row.owner);
    const uri = normalizeUri(row.agentURI);
    if (owner && uri) {
      for (const related of ownerUriIndex.get(`${owner}\u0000${uri}`) ?? []) add(related);
    }
    if (row.fingerprint) {
      for (const related of fingerprintIndex.get(row.fingerprint) ?? []) add(related);
    }
  }
  return discovered;
}
export function computeRegistrationFingerprint(row: {
  name: string;
  description: string;
  image: string;
  x402Support: boolean;
  services: ReadonlyArray<{ name: string; endpoint: string }>;
}): string {
  return registrationFingerprint(
    row.name,
    row.description,
    row.image,
    row.services,
    row.x402Support,
  );
}
/** Pick canonical deployment: verified chain > score > listedAt > lower agentId. */
export function pickCanonicalDeployment(
  deployments: ClusterAgentRow[],
  rawVerified: ReadonlyMap<string, boolean>,
): ClusterAgentRow {
  const sorted = [...deployments].sort((a, b) => {
    const aV = rawVerified.get(deploymentKey(a.chainId, a.agentId)) ? 1 : 0;
    const bV = rawVerified.get(deploymentKey(b.chainId, b.agentId)) ? 1 : 0;
    if (aV !== bV) return bV - aV;
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    const listedDiff = b.listedAtMs - a.listedAtMs;
    if (listedDiff !== 0) return listedDiff;
    if (a.chainId !== b.chainId) return a.chainId - b.chainId;
    return a.agentId - b.agentId;
  });
  return sorted[0]!;
}
export function buildAgentChainCluster(
  currentChainId: number,
  currentAgentId: number,
  deploymentRows: ClusterAgentRow[],
  rawVerified: ReadonlyMap<string, boolean>,
): AgentChainCluster | null {
  if (deploymentRows.length === 0) return null;
  const canonical = pickCanonicalDeployment(deploymentRows, rawVerified);
  const clusterKey = clusterKeyFromCanonical(canonical.chainId, canonical.agentId);
  const clusterChainVerified = deploymentRows.some((d) =>
    rawVerified.get(deploymentKey(d.chainId, d.agentId)),
  );
  const verifiedVia = deploymentRows.find((d) =>
    rawVerified.get(deploymentKey(d.chainId, d.agentId)),
  );
  const deployments: AgentDeploymentRef[] = deploymentRows.map((d) => {
    const chain = getChainByChainId(d.chainId);
    const raw = rawVerified.get(deploymentKey(d.chainId, d.agentId)) ?? false;
    return {
      agentDbId: d.id,
      chainId: d.chainId,
      agentId: d.agentId,
      name: d.name,
      slug: toAgentUrlSlug(d.name),
      profilePath: agentPublicPath(d),
      chainName: chain?.name ?? `Chain ${d.chainId}`,
      chainShortName: chain?.shortName ?? String(d.chainId),
      chainIcon: chain?.icon ?? "",
      chainColor: chain?.color ?? "#888",
      isCurrent: d.chainId === currentChainId && d.agentId === currentAgentId,
      rawChainVerified: raw,
      chainVerified: clusterChainVerified,
      score: d.score,
      listedAtMs: d.listedAtMs,
    };
  });
  deployments.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return a.chainName.localeCompare(b.chainName);
  });
  return {
    clusterKey,
    canonicalChainId: canonical.chainId,
    canonicalAgentId: canonical.agentId,
    canonicalAgentDbId: canonical.id,
    deployments,
    deploymentCount: deployments.length,
    clusterChainVerified,
    verifiedViaChainId: verifiedVia?.chainId ?? null,
  };
}
/** Returns null when only a single deployment (no multi-chain cluster). */
export function toPublicChainCluster(cluster: AgentChainCluster | null): AgentChainCluster | null {
  if (!cluster || cluster.deploymentCount <= 1) return null;
  return cluster;
}
export type ChainLogoStackItem = {
  chainId: number;
  icon: string;
  chainShortName: string;
  chainName: string;
};
export function chainLogoStackFromCluster(cluster: AgentChainCluster | null): ChainLogoStackItem[] {
  if (!cluster) return [];
  return cluster.deployments.map((d) => ({
    chainId: d.chainId,
    icon: d.chainIcon,
    chainShortName: d.chainShortName,
    chainName: d.chainName,
  }));
}
