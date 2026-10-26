import { setTimeout as delay } from "node:timers/promises";
import { logger } from "../logger.js";
import { enqueueSolana8004Snapshot } from "../queue/producer.js";
import type { AgentSyncPayload } from "../queue/contracts.js";
import type { SyncOutcome } from "../queue/sync-outcome.js";
import { getSyncableChainIds } from "../sync/rpc.js";
import { upsertAgentFromChain } from "../sync/agents.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import { canonicalUint256 } from "../lib/exact-protocol.js";
import { ValkeyLeaseBusyError, withValkeyLease } from "@/lib/valkey";

const AGENT_SYNC_LEASE_TTL_MS = 120_000;
const AGENT_SYNC_LEASE_RENEW_MS = 30_000;
const AGENT_SYNC_LEASE_RETRY_BASE_MS = 100;
const AGENT_SYNC_LEASE_RETRY_MAX_MS = 5_000;
const localAgentSyncTails = new Map<string, Promise<void>>();

async function waitForLocalTurn(
  predecessor: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await predecessor.catch(() => undefined);
    return;
  }
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([predecessor.catch(() => undefined), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function withLocalAgentSyncTurn<T>(
  key: string,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const predecessor = localAgentSyncTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = predecessor.catch(() => undefined).then(() => turn);
  localAgentSyncTails.set(key, tail);
  try {
    await waitForLocalTurn(predecessor, signal);
    signal?.throwIfAborted();
    return await operation();
  } finally {
    release();
    if (localAgentSyncTails.get(key) === tail) localAgentSyncTails.delete(key);
  }
}

async function runSerializedAgentSync<T>(input: {
  chainId: number;
  agentId: string;
  signal?: AbortSignal;
  operation: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const key = `agentranking:indexer:agent-sync:v1:${input.chainId}:${input.agentId}`;
  return withLocalAgentSyncTurn(key, input.signal, async () => {
    let contentionStreak = 0;
    for (;;) {
      input.signal?.throwIfAborted();
      try {
        return await withValkeyLease(
          {
            key,
            ttlMs: AGENT_SYNC_LEASE_TTL_MS,
            renewEveryMs: AGENT_SYNC_LEASE_RENEW_MS,
          },
          async (leaseSignal) => {
            const signal = input.signal
              ? AbortSignal.any([input.signal, leaseSignal])
              : leaseSignal;
            return input.operation(signal);
          },
        );
      } catch (error) {
        if (!(error instanceof ValkeyLeaseBusyError)) throw error;
        const ceiling = Math.min(
          AGENT_SYNC_LEASE_RETRY_MAX_MS,
          AGENT_SYNC_LEASE_RETRY_BASE_MS * 2 ** Math.min(6, contentionStreak),
        );
        contentionStreak++;
        const waitMs = Math.min(
          AGENT_SYNC_LEASE_RETRY_MAX_MS,
          Math.max(
            AGENT_SYNC_LEASE_RETRY_BASE_MS,
            Math.round(ceiling * (0.75 + Math.random() * 0.5)),
          ),
        );
        await delay(waitMs, undefined, {
          signal: input.signal,
        });
      }
    }
  });
}

export async function runAgentSyncJob(
  chainId: number,
  payload: AgentSyncPayload,
  signal?: AbortSignal,
  stageBusinessKey?: string,
): Promise<SyncOutcome> {
  const agentId = canonicalUint256(payload.agentId);
  if (chainId === SOLANA_CHAIN_ID) {
    logger.warn("agent-sync mis-queued for Solana; enqueueing solana-indexer-sync", { agentId, chainId }, "sync");
    await enqueueSolana8004Snapshot();
    return { status: "skipped", reason: "misqueued_solana", observed: false, mutated: false };
  }
  const syncable = getSyncableChainIds();
  if (syncable.length > 0 && !syncable.includes(chainId)) {
    logger.info("agent-sync skipped (chain not in SYNC_CHAIN_IDS)", { agentId, chainId }, "sync");
    return { status: "skipped", reason: "chain_not_syncable", observed: false, mutated: false };
  }
  const result = await runSerializedAgentSync({
    chainId,
    agentId,
    signal,
    operation: (serializedSignal) => upsertAgentFromChain(chainId, agentId, {
      sourceSnapshot: payload.sourceSnapshot,
      signal: serializedSignal,
      stageBusinessKey,
    }),
  });
  return {
    status: result.createdOrUpdated ? "updated" : "unchanged",
    reason: result.outcomeReason,
    observed: true,
    mutated: result.createdOrUpdated,
  };
}
