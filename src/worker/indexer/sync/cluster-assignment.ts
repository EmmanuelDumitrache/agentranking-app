import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db.js";
import { withSerializableRetry } from "../lib/serializable-retry.js";
import { logger } from "../logger.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import { parseRegistrationMetadata } from "../lib/parse-registration-metadata.js";
import {
  buildAgentChainCluster,
  clusterKeyFromCanonical,
  computeRegistrationFingerprint,
  deploymentKey,
  expandClusterHandles,
  parseRegistrationRef,
  pickCanonicalDeployment,
  type ClusterAgentRow,
  type DeploymentHandle,
} from "../lib/agent-chain-cluster.js";
import { parseOptionalStrictUnsignedInteger } from "../lib/strict-integer.js";
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
  metadata: {
    where: { key: { in: ["registrations", "registrationFingerprint"] } },
    select: { key: true, value: true },
  },
} satisfies Prisma.AgentSelect;
const HANDLE_QUERY_BATCH = 250;
const CLUSTER_LOCK_BATCH = 1_000;
type AgentRow = Prisma.AgentGetPayload<{ select: typeof CLUSTER_AGENT_SELECT }>;
function rowToClusterAgent(row: AgentRow): ClusterAgentRow {
  const registrationsRaw = row.metadata.find((m) => m.key === "registrations")?.value;
  const registrationMeta = registrationsRaw ? parseRegistrationMetadata(registrationsRaw) : [];
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
  const uniqueHandles = [...unique.values()];
  const rows: AgentRow[] = [];
  for (let offset = 0; offset < uniqueHandles.length; offset += HANDLE_QUERY_BATCH) {
    rows.push(...await prisma.agent.findMany({
      where: {
        OR: uniqueHandles.slice(offset, offset + HANDLE_QUERY_BATCH).map((h) => ({
          chainId: h.chainId,
          agentId: h.agentId,
        })),
      },
      select: CLUSTER_AGENT_SELECT,
    }));
  }
  return rows;
}
async function discoverSiblingHandles(seed: ClusterAgentRow): Promise<DeploymentHandle[]> {
  const handles = new Map<string, DeploymentHandle>();
  const add = (h: DeploymentHandle) => handles.set(deploymentKey(h.chainId, h.agentId), h);
  add({ chainId: seed.chainId, agentId: seed.agentId });
  for (const meta of seed.registrationMeta) {
    const ref = parseRegistrationRef(meta);
    if (ref) add(ref);
  }
  if (seed.fingerprint) {
    const fpRows = await prisma.agentMetadata.findMany({
      where: { key: "registrationFingerprint", value: seed.fingerprint },
      select: { agent: { select: { chainId: true, agentId: true } } },
      take: 32,
    });
    for (const r of fpRows) {
      add({ chainId: r.agent.chainId, agentId: r.agent.agentId });
    }
  }
  const owner = seed.owner.trim();
  const uri = seed.agentURI.trim();
  if (owner && uri) {
    const ownerRows = await prisma.$queryRaw<Array<{ chainId: number; agentId: number }>>`
      SELECT "chainId", "agentId"
      FROM "Agent"
      WHERE LOWER(owner) = ${owner.toLowerCase()}
        AND md5("agentURI") = md5(${uri})
        AND "agentURI" = ${uri}
        AND "chainId" <> ${SOLANA_CHAIN_ID}
      LIMIT 32
    `;
    for (const r of ownerRows) add({ chainId: r.chainId, agentId: r.agentId });
  }
  const agentIdNeedles = [
    `"agentId":${seed.agentId}`,
    `"agentId": ${seed.agentId}`,
    `"agentId":"${seed.agentId}"`,
    `"agentId": "${seed.agentId}"`,
  ];
  const chainNeedles = [
    `"chainId":${seed.chainId}`,
    `"chainId": ${seed.chainId}`,
    `"chainId":"${seed.chainId}"`,
    `"chainId": "${seed.chainId}"`,
    `eip155:${seed.chainId}:`,
  ];
  const reverseRows = await prisma.agentMetadata.findMany({
    where: {
      key: "registrations",
      AND: [
        { OR: agentIdNeedles.map((needle) => ({ value: { contains: needle } })) },
        { OR: chainNeedles.map((needle) => ({ value: { contains: needle } })) },
      ],
    },
    select: {
      value: true,
      agent: { select: { chainId: true, agentId: true } },
    },
    take: 48,
  });
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
  return [...handles.values()];
}
async function loadRawVerifiedMap(handles: DeploymentHandle[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (handles.length === 0) return map;
  for (let offset = 0; offset < handles.length; offset += HANDLE_QUERY_BATCH) {
    const rows = await prisma.agentChainVerification.findMany({
      where: {
        OR: handles.slice(offset, offset + HANDLE_QUERY_BATCH)
          .map((h) => ({ chainId: h.chainId, agentId: h.agentId })),
        verified: true,
      },
      select: { chainId: true, agentId: true, verified: true },
    });
    for (const r of rows) {
      map.set(deploymentKey(r.chainId, r.agentId), r.verified);
    }
  }
  return map;
}
async function discoverClusterForSeed(
  chainId: number,
  agentId: number,
): Promise<DeploymentHandle[] | null> {
  if (chainId === SOLANA_CHAIN_ID) return null;
  const seedRow = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: CLUSTER_AGENT_SELECT,
  });
  if (!seedRow) return null;
  const seed = rowToClusterAgent(seedRow);
  const initialHandles = await discoverSiblingHandles(seed);
  const rowMap = new Map<string, ClusterAgentRow>([
    [deploymentKey(seed.chainId, seed.agentId), seed],
  ]);
  const initiallyMissing = initialHandles.filter((handle) =>
    !rowMap.has(deploymentKey(handle.chainId, handle.agentId)),
  );
  const loadedRows = await loadAgentsByHandles(initiallyMissing);
  for (const r of loadedRows) {
    rowMap.set(deploymentKey(r.chainId, r.agentId), rowToClusterAgent(r));
  }
  let expanded = expandClusterHandles({ chainId, agentId }, rowMap);
  const missing = expanded.filter((h) => !rowMap.has(deploymentKey(h.chainId, h.agentId)));
  if (missing.length > 0) {
    const extra = await loadAgentsByHandles(missing);
    for (const r of extra) {
      rowMap.set(deploymentKey(r.chainId, r.agentId), rowToClusterAgent(r));
    }
    expanded = expandClusterHandles({ chainId, agentId }, rowMap);
  }
  return expanded;
}
async function persistClusterKey(clusterKey: string, agentIds: readonly number[]): Promise<number> {
  const idSet = new Set<number>();
  for (const agentId of agentIds) idSet.add(agentId);
  const ids = [...idSet].sort((a, b) => a - b);
  if (ids.length === 0) return 0;
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    // Overlapping cluster jobs can touch partially intersecting Agent sets. Lock changed
    // rows in canonical id order before updating so PostgreSQL never sees opposing order.
    const changedIds: number[] = [];
    for (let offset = 0; offset < ids.length; offset += CLUSTER_LOCK_BATCH) {
      const batch = ids.slice(offset, offset + CLUSTER_LOCK_BATCH);
      const changed = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT id
        FROM "Agent"
        WHERE id IN (${Prisma.join(batch)})
          AND "cluster_key" IS DISTINCT FROM ${clusterKey}
        ORDER BY id
        FOR UPDATE
      `);
      for (const row of changed) changedIds.push(row.id);
    }
    for (let offset = 0; offset < changedIds.length; offset += CLUSTER_LOCK_BATCH) {
      await tx.agent.updateMany({
        where: { id: { in: changedIds.slice(offset, offset + CLUSTER_LOCK_BATCH) } },
        data: { clusterKey },
      });
    }
    return changedIds.length;
  }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 }), 8);
}
async function persistClusterAssignments(
  assignments: ReadonlyArray<{ id: number; clusterKey: string }>,
): Promise<number> {
  if (assignments.length === 0) return 0;
  const updated = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    UPDATE "Agent" AS agent
    SET "cluster_key" = assignment."clusterKey"
    FROM (VALUES ${Prisma.join(assignments.map((assignment) => Prisma.sql`(
      ${assignment.id}::integer, ${assignment.clusterKey}::text
    )`))}) AS assignment(id, "clusterKey")
    WHERE agent.id = assignment.id
      AND agent."cluster_key" IS DISTINCT FROM assignment."clusterKey"
    RETURNING agent.id
  `);
  return updated.length;
}
/** Assign cluster_key for one EVM deployment and its discovered siblings. */
export async function assignClusterForSeed(
  chainId: number,
  agentId: number,
  options: { throwOnError?: boolean } = {},
): Promise<{ updated: number; failed: boolean; error: string | null }> {
  if (chainId === SOLANA_CHAIN_ID) return { updated: 0, failed: false, error: null };
  try {
    const handleMap = new Map<string, DeploymentHandle>();
    const addHandles = (list: DeploymentHandle[]) => {
      for (const h of list) handleMap.set(deploymentKey(h.chainId, h.agentId), h);
    };
    const queue: DeploymentHandle[] = [{ chainId, agentId }];
    const visited = new Set<string>();
    addHandles(queue);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const handle = queue[cursor]!;
      const key = deploymentKey(handle.chainId, handle.agentId);
      if (visited.has(key)) continue;
      visited.add(key);
      const discovered = await discoverClusterForSeed(handle.chainId, handle.agentId);
      if (!discovered) continue;
      for (const sibling of discovered) {
        const siblingKey = deploymentKey(sibling.chainId, sibling.agentId);
        if (!handleMap.has(siblingKey)) {
          handleMap.set(siblingKey, sibling);
          queue.push(sibling);
        }
      }
    }
    const handles = [...handleMap.values()];
    if (handles.length === 0) return { updated: 0, failed: false, error: null };
    const agentRows = await loadAgentsByHandles(handles);
    const rows = agentRows.map(rowToClusterAgent);
    const rawVerified = await loadRawVerifiedMap(handles);
    const cluster = buildAgentChainCluster(chainId, agentId, rows, rawVerified);
    const clusterKey = cluster?.clusterKey ?? clusterKeyFromCanonical(chainId, agentId);
    const updated = await persistClusterKey(clusterKey, agentRows.map((row) => row.id));
    return { updated, failed: false, error: null };
  } catch (err) {
    const error = Error.isError(err) ? err.message : String(err);
    if (options.throwOnError) throw err;
    return { updated: 0, failed: true, error };
  }
}
class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();
  find(k: string): string {
    if (!this.parent.has(k)) {
      this.parent.set(k, k);
      this.rank.set(k, 0);
      return k;
    }
    let root = k;
    while (this.parent.get(root) && this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let cur = k;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
      return;
    }
    this.parent.set(rb, ra);
    if (rankA === rankB) this.rank.set(ra, rankA + 1);
  }
}
type EvmAgentLite = {
  id: number;
  chainId: number;
  agentId: number;
  score: number;
  listedAtMs: number;
};
/** Full backfill: union-find all EVM deployment edges and write cluster_key. */
export async function rebuildAllClusterKeys(): Promise<{
  components: number;
  updatedRows: number;
  largestCluster: number;
}> {
  const memoryLimit = parseOptionalStrictUnsignedInteger(
    process.env.WORKER_CLUSTER_REBUILD_MEMORY_MAX_BYTES,
    "WORKER_CLUSTER_REBUILD_MEMORY_MAX_BYTES",
    512 * 1024 * 1024,
    { maximum: 8 * 1024 * 1024 * 1024 },
  );
  const estimatedAgentLimit = Math.floor(memoryLimit / 2_048);
  const startingHeap = process.memoryUsage().heapUsed;
  const assertMemoryBudget = (): void => {
    const retained = process.memoryUsage().heapUsed - startingHeap;
    if (retained > memoryLimit) throw new Error(`cluster rebuild retained heap ${retained} exceeds configured memory ceiling ${memoryLimit}`);
  };
  const uf = new UnionFind();
  const agentsByKey = new Map<string, EvmAgentLite>();
  const firstFingerprintKey = new Map<string, string>();
  const firstOwnerUriKey = new Map<string, string>();
  const BATCH = 5000;
  let cursor: number | undefined;
  let totalAgents = 0;
  while (true) {
    const batch = await prisma.agent.findMany({
      where: { chainId: { not: SOLANA_CHAIN_ID } },
      select: {
        id: true,
        chainId: true,
        agentId: true,
        owner: true,
        agentURI: true,
        score: true,
        listedAt: true,
        name: true,
        description: true,
        image: true,
        x402Support: true,
        metadata: {
          where: { key: { in: ["registrations", "registrationFingerprint"] } },
          select: { key: true, value: true },
        },
      },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor != null ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    totalAgents += batch.length;
    if (totalAgents > estimatedAgentLimit) {
      throw new Error(
        `cluster rebuild estimated ${totalAgents * 2_048} bytes exceeds configured memory ceiling ${memoryLimit}`,
      );
    }
    cursor = batch[batch.length - 1]!.id;
    assertMemoryBudget();
    // Most indexed agents already carry their stable registration fingerprint.
    // Load service relations only for the legacy rows that still need the
    // fallback calculation instead of hydrating every service in the registry.
    const missingFingerprintIds = batch.flatMap((row) =>
      row.metadata.find((metadata) => metadata.key === "registrationFingerprint")?.value.trim()
        ? []
        : [row.id],
    );
    const servicesByAgentId = new Map<number, Array<{ name: string; endpoint: string }>>();
    if (missingFingerprintIds.length > 0) {
      const serviceRows = await prisma.agentService.findMany({
        where: { agentId: { in: missingFingerprintIds } },
        select: { agentId: true, name: true, endpoint: true },
      });
      for (const service of serviceRows) {
        const services = servicesByAgentId.get(service.agentId);
        if (services) services.push(service);
        else servicesByAgentId.set(service.agentId, [service]);
      }
    }
    for (const row of batch) {
      const k = deploymentKey(row.chainId, row.agentId);
      uf.find(k);
      const fpMeta = row.metadata.find((m) => m.key === "registrationFingerprint")?.value?.trim();
      const fingerprint =
        fpMeta ||
        computeRegistrationFingerprint({
          name: row.name,
          description: row.description,
          image: row.image,
          x402Support: row.x402Support,
          services: servicesByAgentId.get(row.id) ?? [],
        });
      agentsByKey.set(k, {
        id: row.id,
        chainId: row.chainId,
        agentId: row.agentId,
        score: row.score,
        listedAtMs: row.listedAt.getTime(),
      });
      if (fingerprint) {
        const first = firstFingerprintKey.get(fingerprint);
        if (first) uf.union(first, k);
        else firstFingerprintKey.set(fingerprint, k);
      }
      const owner = row.owner.trim().toLowerCase();
      const uri = row.agentURI.trim();
      if (owner && uri) {
        const ownerUri = `${owner}\0${uri}`;
        const first = firstOwnerUriKey.get(ownerUri);
        if (first) uf.union(first, k);
        else firstOwnerUriKey.set(ownerUri, k);
      }
      const regsRaw = row.metadata.find((m) => m.key === "registrations")?.value;
      if (regsRaw) {
        for (const meta of parseRegistrationMetadata(regsRaw)) {
          const ref = parseRegistrationRef(meta);
          if (ref && ref.chainId !== SOLANA_CHAIN_ID) {
            uf.union(k, deploymentKey(ref.chainId, ref.agentId));
          }
        }
      }
    }
  }
  firstFingerprintKey.clear();
  firstOwnerUriKey.clear();
  const verifiedSet = new Set<string>();
  let verificationCursor: number | undefined;
  for (;;) {
    const verifiedRows = await prisma.agentChainVerification.findMany({
      where: { verified: true, chainId: { not: SOLANA_CHAIN_ID } },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(verificationCursor ? { cursor: { id: verificationCursor }, skip: 1 } : {}),
      select: { id: true, chainId: true, agentId: true },
    });
    if (verifiedRows.length === 0) break;
    for (const row of verifiedRows) {
      const key = deploymentKey(row.chainId, row.agentId);
      if (agentsByKey.has(key)) verifiedSet.add(key);
    }
    verificationCursor = verifiedRows.at(-1)!.id;
    if (verifiedRows.length < BATCH) break;
  }
  const isBetterCanonical = (candidateKey: string, currentKey: string): boolean => {
    const candidate = agentsByKey.get(candidateKey)!;
    const current = agentsByKey.get(currentKey)!;
    const candidateVerified = verifiedSet.has(candidateKey);
    const currentVerified = verifiedSet.has(currentKey);
    if (candidateVerified !== currentVerified) return candidateVerified;
    if (candidate.score !== current.score) return candidate.score > current.score;
    if (candidate.listedAtMs !== current.listedAtMs) return candidate.listedAtMs > current.listedAtMs;
    if (candidate.chainId !== current.chainId) return candidate.chainId < current.chainId;
    return candidate.agentId < current.agentId;
  };
  // Retain only one canonical key and a count per component. Keeping a second
  // copy of every deployment key (and sorting each component) made this phase
  // unnecessarily memory- and CPU-heavy on six-figure registries.
  const components = new Map<string, { size: number; canonicalKey: string }>();
  let componentMembers = 0;
  let largestCluster = 0;
  for (const key of agentsByKey.keys()) {
    const root = uf.find(key);
    const component = components.get(root);
    if (component) {
      component.size += 1;
      if (isBetterCanonical(key, component.canonicalKey)) component.canonicalKey = key;
    } else {
      components.set(root, { size: 1, canonicalKey: key });
    }
    largestCluster = Math.max(largestCluster, component?.size ?? 1);
    componentMembers += 1;
    if (componentMembers % 5_000 === 0) { await yieldToEventLoop(); assertMemoryBudget(); }
  }
  let updatedRows = 0;
  let pendingAssignments: Array<{ id: number; clusterKey: string }> = [];
  const flushAssignments = async (): Promise<void> => {
    if (pendingAssignments.length === 0) return;
    updatedRows += await persistClusterAssignments(pendingAssignments);
    pendingAssignments = [];
    await yieldToEventLoop();
    assertMemoryBudget();
  };
  for (const [memberKey, member] of agentsByKey) {
    const component = components.get(uf.find(memberKey));
    if (!component) throw new Error(`cluster component missing for ${memberKey}`);
    const canonical = agentsByKey.get(component.canonicalKey)!;
    pendingAssignments.push({
      id: member.id,
      clusterKey: clusterKeyFromCanonical(canonical.chainId, canonical.agentId),
    });
    if (pendingAssignments.length >= BATCH) await flushAssignments();
  }
  await flushAssignments();
  logger.info(
    "cluster rebuild complete",
    { totalAgents, components: components.size, updatedRows, largestCluster },
    "cluster",
  );
  return { components: components.size, updatedRows, largestCluster };
}
