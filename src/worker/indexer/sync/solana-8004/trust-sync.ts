import { prisma } from "../../db.js";
import { throwIfAborted } from "../../lib/abort.js";
import { loadSolana8004ProgramDefinition } from "./program.js";
import {
  fetchSolana8004Transaction,
  selectSolana8004HistoryRpcEndpoints,
  type Solana8004RpcEndpoint,
} from "./rpc-client.js";
import { decodeSolana8004TrustEvents } from "./trust-event-decoder.js";
import { persistSolana8004TrustEvents } from "./trust-projection.js";
import {
  SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS,
  SOLANA_8004_TRUST_STALE_RUNNING_MS,
  Solana8004TrustRetryDeferredError,
  solana8004TrustFailedRetryAt,
} from "./trust-queue-policy.js";
import {
  decodeSolana8004TrustInstructions,
} from "./trust-instruction-decoder.js";
function transactionInstructions(transaction: NonNullable<Awaited<ReturnType<typeof fetchSolana8004Transaction>>>) {
  const message = transaction.transaction?.message;
  return {
    outer: message?.compiledInstructions ?? message?.instructions ?? [],
    inner: transaction.meta?.innerInstructions ?? [],
  };
}
function transactionKeyParts(transaction: NonNullable<Awaited<ReturnType<typeof fetchSolana8004Transaction>>>) {
  const message = transaction.transaction?.message;
  const keyText = (value: string | { pubkey?: string }): string =>
    typeof value === "string" ? value : value.pubkey ?? "";
  const staticKeys = (message?.staticAccountKeys ?? message?.accountKeys ?? []).map(keyText);
  const writable = transaction.meta?.loadedAddresses?.writable ?? [];
  const readonly = transaction.meta?.loadedAddresses?.readonly ?? [];
  return { staticKeys, writable, readonly, resolved: [...staticKeys, ...writable, ...readonly] };
}
function programWasExecuted(
  transaction: NonNullable<Awaited<ReturnType<typeof fetchSolana8004Transaction>>>,
  programId: string,
  keys: readonly string[],
): boolean {
  const message = transaction.transaction?.message;
  const outer = message?.compiledInstructions ?? message?.instructions ?? [];
  if (outer.some((instruction) => keys[instruction.programIdIndex] === programId)) return true;
  return (transaction.meta?.innerInstructions ?? []).some((group) =>
    group.instructions.some((instruction) => keys[instruction.programIdIndex] === programId),
  );
}
async function markPruned(signature: string, endpoint: Solana8004RpcEndpoint): Promise<void> {
  await prisma.solana8004TrustSignature.update({
    where: { signature },
    data: {
      status: "PRUNED",
      endpointKey: endpoint.endpointKey,
      completedAt: new Date(),
      lastError: "transaction history predates every compatible provider's minimum ledger slot",
    },
  });
}
export type Solana8004TrustSyncResult = {
  status: "complete" | "no_trust" | "pruned" | "skipped";
  observations: number;
  affectedAgentIds: number[];
};
export async function syncSolana8004TrustTransaction(input: {
  signature: string;
  slot: bigint;
  signal?: AbortSignal;
}): Promise<Solana8004TrustSyncResult> {
  throwIfAborted(input.signal);
  const now = Date.now();
  const staleRunningBefore = new Date(now - SOLANA_8004_TRUST_STALE_RUNNING_MS);
  const failedRetryBefore = new Date(now - SOLANA_8004_TRUST_FAILED_RETRY_COOLDOWN_MS);
  const claimed = await prisma.solana8004TrustSignature.updateMany({
    where: {
      signature: input.signature,
      OR: [
        { status: { in: ["PENDING", "QUEUED"] } },
        { status: "FAILED", updatedAt: { lte: failedRetryBefore } },
        { status: "RUNNING", updatedAt: { lt: staleRunningBefore } },
      ],
    },
    data: { status: "RUNNING", attempts: { increment: 1 }, lastError: null, completedAt: null },
  });
  if (claimed.count === 0) {
    const row = await prisma.solana8004TrustSignature.findUnique({
      where: { signature: input.signature },
      select: { status: true, updatedAt: true },
    });
    if (!row) return { status: "skipped", observations: 0, affectedAgentIds: [] };
    if (row.status === "COMPLETE") return { status: "complete", observations: 0, affectedAgentIds: [] };
    if (row.status === "NO_TRUST") return { status: "no_trust", observations: 0, affectedAgentIds: [] };
    if (row.status === "PRUNED") return { status: "pruned", observations: 0, affectedAgentIds: [] };
    if (row.status === "FAILED") {
      throw new Solana8004TrustRetryDeferredError(
        input.signature,
        solana8004TrustFailedRetryAt(row.updatedAt),
      );
    }
    if (row.status === "RUNNING") throw new Error("Solana 8004 trust transaction is already being processed");
    if (row.status === "PENDING" || row.status === "QUEUED") {
      throw new Solana8004TrustRetryDeferredError(input.signature, new Date(Date.now() + 1_000));
    }
    throw new Error(`Solana 8004 trust signature has unexpected durable status: ${row.status}`);
  }
  const program = loadSolana8004ProgramDefinition();
  let selectedEndpoint: Solana8004RpcEndpoint | null = null;
  try {
    const endpoints = await selectSolana8004HistoryRpcEndpoints(program, input.slot, input.signal);
    const eligible = endpoints.filter((endpoint) => endpoint.minimumLedgerSlot <= input.slot);
    if (eligible.length === 0) {
      const endpoint = endpoints[0];
      if (!endpoint) throw new Error("No compatible Solana 8004 history endpoint is available");
      await markPruned(input.signature, endpoint);
      return { status: "pruned", observations: 0, affectedAgentIds: [] };
    }
    let transaction: Awaited<ReturnType<typeof fetchSolana8004Transaction>> = null;
    const failures: string[] = [];
    for (const endpoint of eligible) {
      throwIfAborted(input.signal);
      try {
        const candidate = await fetchSolana8004Transaction({ endpoint, signature: input.signature, signal: input.signal });
        if (candidate) {
          selectedEndpoint = endpoint;
          transaction = candidate;
          break;
        }
        failures.push(`${endpoint.providerName}: transaction unavailable`);
      } catch (error) {
        failures.push(`${endpoint.providerName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!transaction || !selectedEndpoint) {
      throw new Error(`finalized Solana transaction is unavailable across eligible history endpoints: ${failures.slice(0, 4).join("; ")}`);
    }
    if (!Number.isSafeInteger(transaction.slot) || transaction.slot < 0 || BigInt(transaction.slot) !== input.slot) {
      throw new Error("Solana transaction slot does not match the durable signature coordinate");
    }
    const keyParts = transactionKeyParts(transaction);
    const keys = keyParts.resolved;
    const instructions = transactionInstructions(transaction);
    const decodedInstructions = decodeSolana8004TrustInstructions(transaction, program.programId, keys);
    const expectedProgramExecuted = decodedInstructions.length > 0 ||
      programWasExecuted(transaction, program.programId, keys);
    await prisma.solanaTransactionObservation.upsert({
      where: { signature: input.signature },
      create: {
        signature: input.signature,
        slot: input.slot,
        transactionVersion: transaction.version === "legacy" ? "legacy" : String(transaction.version ?? "unknown"),
        status: transaction.meta?.err == null ? "found_successful" : "found_failed",
        commitment: "finalized",
        metaAvailable: transaction.meta != null,
        blockTime: transaction.blockTime == null ? null : new Date(transaction.blockTime * 1_000),
        logMessages: (transaction.meta?.logMessages ?? []) as never,
        executionError: transaction.meta?.err == null ? undefined : transaction.meta.err as never,
        expectedProgramId: program.programId,
        expectedProgramExecuted,
        staticAccountKeys: keyParts.staticKeys as never,
        loadedWritableKeys: keyParts.writable as never,
        loadedReadonlyKeys: keyParts.readonly as never,
        resolvedAccountKeys: keys as never,
        outerInstructions: instructions.outer as never,
        innerInstructions: instructions.inner as never,
        decodedInstructions: decodedInstructions as never,
        instructionDecoderVersion: "solana-8004-trust/1",
        genesisHash: selectedEndpoint.genesisHash,
        firstAvailableBlock: selectedEndpoint.firstAvailableBlock,
        minimumLedgerSlot: selectedEndpoint.minimumLedgerSlot,
        endpointKey: selectedEndpoint.endpointKey,
      },
      update: {
        slot: input.slot,
        status: transaction.meta?.err == null ? "found_successful" : "found_failed",
        metaAvailable: transaction.meta != null,
        blockTime: transaction.blockTime == null ? null : new Date(transaction.blockTime * 1_000),
        logMessages: (transaction.meta?.logMessages ?? []) as never,
        executionError: transaction.meta?.err == null ? undefined : transaction.meta.err as never,
        expectedProgramId: program.programId,
        expectedProgramExecuted,
        staticAccountKeys: keyParts.staticKeys as never,
        loadedWritableKeys: keyParts.writable as never,
        loadedReadonlyKeys: keyParts.readonly as never,
        resolvedAccountKeys: keys as never,
        outerInstructions: instructions.outer as never,
        innerInstructions: instructions.inner as never,
        decodedInstructions: decodedInstructions as never,
        instructionDecoderVersion: "solana-8004-trust/1",
        genesisHash: selectedEndpoint.genesisHash,
        firstAvailableBlock: selectedEndpoint.firstAvailableBlock,
        minimumLedgerSlot: selectedEndpoint.minimumLedgerSlot,
        endpointKey: selectedEndpoint.endpointKey,
        verifiedAt: new Date(),
      },
    });
    if (transaction.meta?.err != null || !expectedProgramExecuted) {
      await prisma.solana8004TrustSignature.update({
        where: { signature: input.signature },
        data: { status: "NO_TRUST", endpointKey: selectedEndpoint.endpointKey, completedAt: new Date(), lastError: null },
      });
      return { status: "no_trust", observations: 0, affectedAgentIds: [] };
    }
    const events = decodeSolana8004TrustEvents({
      transaction,
      programId: program.programId,
      instructions: decodedInstructions,
    });
    if (events.length === 0) {
      await prisma.solana8004TrustSignature.update({
        where: { signature: input.signature },
        data: { status: "NO_TRUST", endpointKey: selectedEndpoint.endpointKey, completedAt: new Date(), lastError: null },
      });
      return { status: "no_trust", observations: 0, affectedAgentIds: [] };
    }
    const projected = await persistSolana8004TrustEvents({
      programId: program.programId,
      signature: input.signature,
      transactionSlot: input.slot,
      blockTime: transaction.blockTime == null ? null : new Date(transaction.blockTime * 1_000),
      endpointKey: selectedEndpoint.endpointKey,
      events,
    });
    return { status: "complete", ...projected };
  } catch (error) {
    try {
      await prisma.solana8004TrustSignature.update({
        where: { signature: input.signature },
        data: {
          status: "FAILED",
          endpointKey: selectedEndpoint?.endpointKey,
          lastError: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
        },
      });
    } catch (persistError) {
      throw new AggregateError(
        [error, persistError],
        `Solana 8004 trust sync ${input.signature} and failure-state persistence both failed`,
      );
    }
    throw error;
  }
}
