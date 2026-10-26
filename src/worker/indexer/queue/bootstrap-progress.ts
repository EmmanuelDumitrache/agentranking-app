import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db.js";
import { redactRpcErrorText } from "../sync/rpc.js";
import { getBootstrapExecutionState, type IndexerBootstrapPhase } from "./bootstrap-state.js";
import { enqueueBootstrapAdvance } from "./producer.js";
export type BootstrapSourceProgress = {
  phase: IndexerBootstrapPhase;
  sourceKey: string;
  complete?: boolean;
  deferredReason?: string | null;
  failedError?: unknown;
  targetBlock?: bigint | null;
  targetSlot?: bigint | null;
  targetGeneration?: bigint | null;
  observedBlock?: bigint | null;
  observedSlot?: bigint | null;
  observedGeneration?: bigint | null;
  discoveredCount?: number;
  completedCount?: number;
  rejectedCount?: number;
};

const ROUTINE_PROGRESS_WRITE_INTERVAL_MS = 5_000;
type RoutineProgressWrite = { readonly startedAt: number };
const routineProgressWrites = new Map<string, RoutineProgressWrite>();

function safeError(error: unknown): string | null {
  if (error == null) return null;
  return redactRpcErrorText(error instanceof Error ? error.message : String(error)).slice(0, 4_000);
}
export async function recordBootstrapSourceProgress(input: BootstrapSourceProgress): Promise<void> {
  const progressKey = `${input.phase}:${input.sourceKey}`;
  const nowMs = Date.now();
  const routineProgress = input.failedError == null && input.complete !== true && !input.deferredReason;
  let reservation: RoutineProgressWrite | null = null;
  if (routineProgress) {
    const current = routineProgressWrites.get(progressKey);
    if (current && nowMs - current.startedAt < ROUTINE_PROGRESS_WRITE_INTERVAL_MS) return;
    reservation = { startedAt: nowMs };
    routineProgressWrites.set(progressKey, reservation);
  } else {
    routineProgressWrites.delete(progressKey);
  }
  const state = await getBootstrapExecutionState();
  if (!state.epochId || state.phase !== input.phase) {
    if (reservation && routineProgressWrites.get(progressKey) === reservation) {
      routineProgressWrites.delete(progressKey);
    }
    return;
  }
  const now = new Date(nowMs);
  const status: "FAILED" | "COMPLETE" | "RUNNING" = input.failedError != null
    ? "FAILED"
    : input.complete
      ? "COMPLETE"
      : "RUNNING";
  const data = {
    status,
    ...(input.targetBlock !== undefined ? { targetBlock: input.targetBlock } : {}),
    ...(input.targetSlot !== undefined ? { targetSlot: input.targetSlot } : {}),
    ...(input.targetGeneration !== undefined ? { targetGeneration: input.targetGeneration } : {}),
    ...(input.observedBlock !== undefined ? { observedBlock: input.observedBlock } : {}),
    ...(input.observedSlot !== undefined ? { observedSlot: input.observedSlot } : {}),
    ...(input.observedGeneration !== undefined ? { observedGeneration: input.observedGeneration } : {}),
    ...(input.discoveredCount !== undefined ? { discoveredCount: input.discoveredCount } : {}),
    ...(input.completedCount !== undefined ? { completedCount: input.completedCount } : {}),
    ...(input.rejectedCount !== undefined ? { rejectedCount: input.rejectedCount } : {}),
    degradedReason: input.deferredReason ?? null,
    lastError: input.failedError != null || input.deferredReason
      ? safeError(input.failedError) ?? input.deferredReason
      : null,
    completedAt: status === "COMPLETE" ? now : null,
  } satisfies Prisma.IndexerBootstrapSourceUpdateManyMutationInput;
  try {
    await prisma.indexerBootstrapSource.updateMany({
      where: { epochId: state.epochId, phase: input.phase, sourceKey: input.sourceKey },
      data,
    });
    // Source progress does not alter the epoch phase read by the execution-state
    // cache. The coordinator invalidates that cache when it actually transitions
    // the epoch, so generation bumps here only force every worker to reload an
    // unchanged phase after each coalesced progress update.
    await enqueueBootstrapAdvance({ reason: `source-progress:${input.sourceKey}` });
  } catch (error) {
    if (reservation && routineProgressWrites.get(progressKey) === reservation) {
      routineProgressWrites.delete(progressKey);
    }
    throw error;
  }
}
