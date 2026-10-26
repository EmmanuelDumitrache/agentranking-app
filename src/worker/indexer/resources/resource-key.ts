import { createHash } from "node:crypto";

export type ResourceKey =
  | `evm-rpc:${string}`
  | `solana-rpc:${string}`
  | `http-origin:${string}`
  | `ipfs:${string}`
  | `database-write:${string}`
  | `source-cursor:${string}`
  | `agent-lock:${string}`;

function stableResourceHash(identity: string): string {
  return createHash("sha256").update(identity).digest("hex");
}

export function evmRpcResourceKey(physicalIdentity: string): ResourceKey {
  return `evm-rpc:${stableResourceHash(physicalIdentity)}`;
}

export function solanaRpcResourceKey(physicalIdentity: string): ResourceKey {
  return `solana-rpc:${stableResourceHash(physicalIdentity)}`;
}

export function httpOriginResourceKey(origin: string): ResourceKey {
  const normalized = new URL(origin).origin.toLowerCase();
  return `http-origin:${stableResourceHash(normalized)}`;
}

export function ipfsResourceKey(endpoint: string): ResourceKey {
  return `ipfs:${stableResourceHash(endpoint)}`;
}

export function databaseWriteResourceKey(poolName: string): ResourceKey {
  return `database-write:${stableResourceHash(poolName)}`;
}

export function sourceCursorResourceKey(sourceKey: string): ResourceKey {
  return `source-cursor:${stableResourceHash(sourceKey)}`;
}

export function agentLockResourceKey(agentIdentity: string): ResourceKey {
  return `agent-lock:${stableResourceHash(agentIdentity)}`;
}

export function resourceKind(resourceKey: ResourceKey): string {
  return resourceKey.slice(0, resourceKey.indexOf(":"));
}

export function resourceScope(resourceKey: ResourceKey): string {
  const separator = resourceKey.indexOf(":");
  return resourceKey.slice(separator + 1, separator + 13);
}

export type ResourceRateBudgetDimension = "requests" | "weighted-cost";

/** Profile-specific key prevents a changed rate contract from reinterpreting prior GCRA state. */
export function resourceRateBudgetKey(
  resourceKey: ResourceKey,
  dimension: ResourceRateBudgetDimension,
  capacity: number,
  intervalMs: number,
): string {
  const profileHash = createHash("sha256")
    .update(`${dimension}\0${capacity}\0${intervalMs}`)
    .digest("hex")
    .slice(0, 16);
  return `${resourceKey}:rate:${dimension}:${profileHash}`;
}
