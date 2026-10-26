import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { getOrInsert } from "@/lib/map-upsert";
import {
  deploymentKey,
  parseRegistrationRef,
  type AgentChainCluster,
} from "@/lib/agent-chain-cluster";
import {
  extractRegistrationsFromAgentUri,
  parseRegistrationMetadata,
  type RegistrationMetaEntry,
} from "@/lib/agent-identity";
const CLUSTER_SIBLING_ROW_SELECT = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  description: true,
  image: true,
  agentURI: true,
  isVerified: true,
  isPremiumVerified: true,
  totalFeedback: true,
  lastActiveAt: true,
  recentActivity: true,
  activityUpdatedAt: true,
  metadata: { select: { key: true, value: true } },
  services: { select: { id: true, name: true, endpoint: true, version: true } },
} as const;
const SOCIAL_METADATA_KEYS = new Set([
  "website",
  "uri",
  "twitter",
  "x",
  "discord",
  "telegram",
  "email",
  "github",
]);
export type ClusterSiblingRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  description: string;
  image: string;
  agentURI?: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  totalFeedback: number;
  lastActiveAt: Date;
  recentActivity: unknown;
  activityUpdatedAt: Date | null;
  metadata: Array<{ key: string; value: string }>;
  services: Array<{ id: number; name: string; endpoint: string; version: string }>;
};
export type ClusterEnrichmentResult = {
  metadata: Array<{ key: string; value: string }>;
  services: Array<{ id: number; name: string; endpoint: string; version: string }>;
  description: string;
  image: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  totalFeedback: number;
  lastActiveAt: Date;
  recentActivity: unknown;
  activityUpdatedAt: Date | null;
  activityChainId: number;
  activityAgentId: number;
};
function normalizeEndpoint(url: string): string {
  return url.trim().toLowerCase().replace(/\/$/, "");
}
function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
/** Union ERC-8004 `registrations` JSON across cluster rows (dedupe by chainId:agentId). */
export function unionClusterRegistrationMeta(rows: ClusterSiblingRow[]): string {
  const seen = new Map<string, RegistrationMetaEntry>();
  const ordered: RegistrationMetaEntry[] = [];
  const addEntry = (entry: RegistrationMetaEntry) => {
    const ref = parseRegistrationRef(entry);
    if (!ref) return;
    const key = deploymentKey(ref.chainId, ref.agentId);
    if (seen.has(key)) return;
    seen.set(key, entry);
    ordered.push(entry);
  };
  for (const row of rows) {
    const raw = row.metadata.find((m) => m.key.toLowerCase() === "registrations")?.value;
    if (isNonEmpty(raw)) {
      for (const entry of parseRegistrationMetadata(raw)) {
        addEntry(entry);
      }
    }
    for (const entry of extractRegistrationsFromAgentUri(row.agentURI)) {
      addEntry(entry);
    }
  }
  return JSON.stringify(ordered);
}
function mergeMetadata(
  seed: ClusterSiblingRow,
  siblings: ClusterSiblingRow[],
): Array<{ key: string; value: string }> {
  const byKey = new Map<string, string>();
  for (const m of seed.metadata) {
    if (isNonEmpty(m.value)) byKey.set(m.key.toLowerCase(), m.value);
  }
  const ordered = [...siblings].sort(
    (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
  );
  for (const row of ordered) {
    for (const m of row.metadata) {
      const k = m.key.toLowerCase();
      if (!isNonEmpty(m.value)) continue;
      if (!SOCIAL_METADATA_KEYS.has(k) && byKey.has(k)) continue;
      if (!byKey.has(k) || !isNonEmpty(byKey.get(k))) {
        byKey.set(k, m.value);
      }
    }
  }
  const seedKeys = new Set(seed.metadata.map((m) => m.key.toLowerCase()));
  const out = seed.metadata.map((m) => ({
    key: m.key,
    value: byKey.get(m.key.toLowerCase()) ?? m.value,
  }));
  for (const [k, v] of byKey) {
    if (!seedKeys.has(k)) {
      const original = ordered
        .flatMap((r) => r.metadata)
        .find((m) => m.key.toLowerCase() === k);
      out.push({ key: original?.key ?? k, value: v });
    }
  }
  const unionedRegistrations = unionClusterRegistrationMeta([seed, ...siblings]);
  if (unionedRegistrations !== "[]") {
    const regIdx = out.findIndex((m) => m.key.toLowerCase() === "registrations");
    if (regIdx >= 0) {
      out[regIdx] = { ...out[regIdx]!, value: unionedRegistrations };
    } else {
      out.push({ key: "registrations", value: unionedRegistrations });
    }
  }
  return out;
}
function mergeServices(
  seed: ClusterSiblingRow,
  siblings: ClusterSiblingRow[],
): ClusterSiblingRow["services"] {
  const byEndpoint = new Map<string, ClusterSiblingRow["services"][number]>();
  for (const s of seed.services) {
    if (isNonEmpty(s.endpoint)) {
      byEndpoint.set(normalizeEndpoint(s.endpoint), s);
    }
  }
  const ordered = [...siblings].sort(
    (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
  );
  for (const row of ordered) {
    for (const s of row.services) {
      if (!isNonEmpty(s.endpoint)) continue;
      const key = normalizeEndpoint(s.endpoint);
      getOrInsert(byEndpoint, key, s);
    }
  }
  return [...byEndpoint.values()];
}
function pickRichestMedia(seed: ClusterSiblingRow, siblings: ClusterSiblingRow[]): {
  description: string;
  image: string;
} {
  if (isNonEmpty(seed.description) && isNonEmpty(seed.image)) {
    return { description: seed.description, image: seed.image };
  }
  const candidates = [seed, ...siblings].sort((a, b) => {
    const score = (r: ClusterSiblingRow) =>
      (r.isPremiumVerified ? 4 : 0) +
      (r.isVerified ? 2 : 0) +
      (isNonEmpty(r.image) ? 1 : 0);
    return score(b) - score(a);
  });
  const best = candidates[0]!;
  return {
    description: isNonEmpty(seed.description) ? seed.description : best.description,
    image: isNonEmpty(seed.image) ? seed.image : best.image,
  };
}
function pickActivitySource(
  seed: ClusterSiblingRow,
  siblings: ClusterSiblingRow[],
): ClusterSiblingRow {
  const all = [seed, ...siblings];
  return all.reduce((best, row) =>
    row.lastActiveAt > best.lastActiveAt ? row : best,
  );
}
async function loadSiblingRowsByHandles(
  handles: ReadonlyArray<{ chainId: number; agentId: number }>,
): Promise<ClusterSiblingRow[]> {
  if (handles.length === 0) return [];
  return withTransientPoolRetry(() =>
    prisma.agent.findMany({
      where: {
        OR: handles.map((h) => ({ chainId: h.chainId, agentId: h.agentId })),
        isActive: true,
      },
      select: CLUSTER_SIBLING_ROW_SELECT,
    }),
  );
}
export async function loadClusterSiblingRows(
  cluster: AgentChainCluster | null | undefined,
  seedChainId: number,
  seedAgentId: number,
): Promise<ClusterSiblingRow[]> {
  if (!cluster || cluster.deployments.length <= 1) return [];
  const handles = cluster.deployments
    .filter((d) => !(d.chainId === seedChainId && d.agentId === seedAgentId))
    .map((d) => ({ chainId: d.chainId, agentId: d.agentId }));
  return loadSiblingRowsByHandles(handles);
}
/** Hydrate DB rows for ERC-8004 registration refs when cluster graph is incomplete. */
export async function loadSiblingRowsFromRegistrationRefs(
  seedChainId: number,
  seedAgentId: number,
  registrationMeta: readonly RegistrationMetaEntry[],
): Promise<ClusterSiblingRow[]> {
  const handles: Array<{ chainId: number; agentId: number }> = [];
  const seen = new Set<string>();
  for (const entry of registrationMeta) {
    const ref = parseRegistrationRef(entry);
    if (!ref) continue;
    if (ref.chainId === seedChainId && ref.agentId === seedAgentId) continue;
    const key = deploymentKey(ref.chainId, ref.agentId);
    if (seen.has(key)) continue;
    seen.add(key);
    handles.push(ref);
  }
  return loadSiblingRowsByHandles(handles);
}
export function mergeClusterSiblingRows(
  primary: ClusterSiblingRow[],
  extra: ClusterSiblingRow[],
): ClusterSiblingRow[] {
  const byKey = new Map<string, ClusterSiblingRow>();
  for (const row of primary) {
    byKey.set(deploymentKey(row.chainId, row.agentId), row);
  }
  for (const row of extra) {
    const key = deploymentKey(row.chainId, row.agentId);
    getOrInsert(byKey, key, row);
  }
  return [...byKey.values()];
}
export function enrichAgentFromClusterSiblings(
  seed: ClusterSiblingRow,
  siblings: ClusterSiblingRow[],
): ClusterEnrichmentResult {
  if (siblings.length === 0) {
    return {
      metadata: seed.metadata,
      services: seed.services,
      description: seed.description,
      image: seed.image,
      isVerified: seed.isVerified,
      isPremiumVerified: seed.isPremiumVerified,
      totalFeedback: seed.totalFeedback,
      lastActiveAt: seed.lastActiveAt,
      recentActivity: seed.recentActivity,
      activityUpdatedAt: seed.activityUpdatedAt,
      activityChainId: seed.chainId,
      activityAgentId: seed.agentId,
    };
  }
  const media = pickRichestMedia(seed, siblings);
  const activityRow = pickActivitySource(seed, siblings);
  const totalFeedback =
    seed.totalFeedback + siblings.reduce((sum, r) => sum + r.totalFeedback, 0);
  const lastActiveAt = [seed, ...siblings].reduce(
    (max, r) => (r.lastActiveAt > max ? r.lastActiveAt : max),
    seed.lastActiveAt,
  );
  return {
    metadata: mergeMetadata(seed, siblings),
    services: mergeServices(seed, siblings),
    description: media.description,
    image: media.image,
    isVerified: seed.isVerified || siblings.some((r) => r.isVerified),
    isPremiumVerified:
      seed.isPremiumVerified || siblings.some((r) => r.isPremiumVerified),
    totalFeedback,
    lastActiveAt,
    recentActivity: activityRow.recentActivity,
    activityUpdatedAt: activityRow.activityUpdatedAt,
    activityChainId: activityRow.chainId,
    activityAgentId: activityRow.agentId,
  };
}
export function seedRowFromAgent(agent: {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  description: string;
  image: string;
  agentURI?: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  totalFeedback: number;
  lastActiveAt: Date;
  recentActivity: unknown;
  activityUpdatedAt: Date | null;
  metadata: Array<{ key: string; value: string }>;
  services: Array<{ id: number; name: string; endpoint: string; version: string }>;
}): ClusterSiblingRow {
  return {
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    description: agent.description,
    image: agent.image,
    agentURI: agent.agentURI,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    totalFeedback: agent.totalFeedback,
    lastActiveAt: agent.lastActiveAt,
    recentActivity: agent.recentActivity,
    activityUpdatedAt: agent.activityUpdatedAt,
    metadata: agent.metadata,
    services: agent.services,
  };
}