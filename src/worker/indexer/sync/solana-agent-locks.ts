import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";

/**
 * Snapshot start/finalization takes this lock exclusively. Per-identity writers
 * take it in shared mode, allowing unrelated Agents to materialize concurrently
 * while preventing a generation transition from crossing an in-flight write.
 */
const SOLANA_SNAPSHOT_GENERATION_FENCE = 1_902_543_783n;
/** The `(chainId, agentId)` compatibility namespace is one physical allocator. */
const SOLANA_COMPATIBILITY_ID_ALLOCATOR_LOCK = 1_902_543_784n;
/** Two-key advisory-lock namespace; it does not overlap the one-bigint fences. */
const SOLANA_AGENT_IDENTITY_LOCK_NAMESPACE = 1_902_543_790;
const SOLANA_IDENTITY_LOCK_KEY_CACHE_MAX = 200_000;
const solanaIdentityLockKeyCache = new Map<string, number>();

function canonicalIdentity(identity: string): string {
  const canonical = identity.normalize("NFC").trim();
  if (!canonical) throw new Error("Solana Agent lock identity is required");
  if (canonical.includes("\0")) throw new Error("Solana Agent lock identity contains NUL");
  return canonical;
}

export function solanaAgentIdentityLockKey(identity: string): number {
  const canonical = canonicalIdentity(identity);
  const cached = solanaIdentityLockKeyCache.get(canonical);
  if (cached !== undefined) return cached;
  const key = createHash("sha256")
    .update("agentranking:solana-agent-identity:v1\0")
    .update(canonical)
    .digest()
    .readInt32BE(0);
  if (solanaIdentityLockKeyCache.size >= SOLANA_IDENTITY_LOCK_KEY_CACHE_MAX) {
    const oldest = solanaIdentityLockKeyCache.keys().next().value;
    if (oldest !== undefined) solanaIdentityLockKeyCache.delete(oldest);
  }
  solanaIdentityLockKeyCache.set(canonical, key);
  return key;
}

export async function acquireSolanaSnapshotWriterFence(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${SOLANA_SNAPSHOT_GENERATION_FENCE})`;
}

export async function acquireSolanaSnapshotTransitionFence(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SOLANA_SNAPSHOT_GENERATION_FENCE})`;
}

/**
 * Locks all stable identity aliases in deterministic key order. Callers should
 * include the exact registry identity plus any normalized cross-registry URL
 * keys used for twin resolution. Hash collisions merely over-serialize.
 */
export async function acquireSolanaAgentIdentityLocks(
  tx: Prisma.TransactionClient,
  identities: readonly string[],
): Promise<void> {
  const keySet = new Set<number>();
  for (const identity of identities) keySet.add(solanaAgentIdentityLockKey(identity));
  const keys = [...keySet].sort((a, b) => a - b);
  if (keys.length === 0) throw new Error("at least one Solana Agent lock identity is required");
  // Advisory lock functions return PostgreSQL void. Use $executeRaw so Prisma
  // executes the SELECT without attempting to deserialize one void value per key.
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(${SOLANA_AGENT_IDENTITY_LOCK_NAMESPACE}, lock_key)
    FROM unnest(ARRAY[${Prisma.join(keys)}]::integer[]) AS locks(lock_key)
    ORDER BY lock_key
  `);
}

export async function acquireSolanaCompatibilityIdAllocatorLock(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SOLANA_COMPATIBILITY_ID_ALLOCATOR_LOCK})`;
}
