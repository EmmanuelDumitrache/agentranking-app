import { prisma } from "../db.js";
import { redactSensitiveText } from "../lib/secret-redaction.js";
export type SyncOutcomeStatus = "updated" | "unchanged" | "skipped" | "deferred" | "partial" | "failed";
export type SyncOutcome = {
  status: SyncOutcomeStatus;
  reason?: string;
  observed?: boolean;
  mutated?: boolean;
  cursorAdvanced?: boolean;
  complete?: boolean;
  coverage?: Record<string, unknown>;
};

const ROUTINE_SYNC_OUTCOME_WRITE_INTERVAL_MS = 5_000;
type RoutineSyncOutcomeWrite = { readonly startedAt: number };
const routineSyncOutcomeWrites = new Map<string, RoutineSyncOutcomeWrite>();

export async function recordSyncOutcome(input: {
  key: string;
  chainId?: number;
  outcome: SyncOutcome;
  error?: unknown;
  coalesceRoutineSuccess?: boolean;
}): Promise<void> {
  const nowMs = Date.now();
  const routineSuccess = input.coalesceRoutineSuccess === true &&
    input.error == null &&
    input.outcome.complete !== true &&
    (input.outcome.status === "updated" || input.outcome.status === "unchanged");
  let reservation: RoutineSyncOutcomeWrite | null = null;
  if (routineSuccess) {
    const current = routineSyncOutcomeWrites.get(input.key);
    if (current && nowMs - current.startedAt < ROUTINE_SYNC_OUTCOME_WRITE_INTERVAL_MS) return;
    reservation = { startedAt: nowMs };
    routineSyncOutcomeWrites.set(input.key, reservation);
  } else {
    routineSyncOutcomeWrites.delete(input.key);
  }
  const now = new Date(nowMs);
  const authoritativeSuccess = input.outcome.observed === true &&
    input.outcome.status !== "failed" && input.outcome.status !== "deferred" && input.outcome.status !== "skipped";
  const errorMessage = input.error == null
    ? undefined
    : redactSensitiveText(input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 1_000);
  const create = {
    key: input.key,
    lastSyncedAt: authoritativeSuccess ? now : new Date(0),
    lastChainId: input.chainId,
    lastAttemptAt: now,
    lastSuccessfulObservationAt: authoritativeSuccess ? now : null,
    lastMutationAt: input.outcome.mutated ? now : null,
    lastCursorAdvancedAt: input.outcome.cursorAdvanced ? now : null,
    lastCompleteReconciliationAt: input.outcome.complete ? now : null,
    lastErrorAt: input.outcome.status === "failed" || input.error != null ? now : null,
    lastOutcomeStatus: input.outcome.status,
    lastOutcomeReason: errorMessage ?? input.outcome.reason ?? null,
    lastCoverage: input.outcome.coverage as never,
  };
  try {
    await prisma.syncState.upsert({
      where: { key: input.key },
      create,
      update: {
        lastChainId: input.chainId,
        lastAttemptAt: now,
        ...(authoritativeSuccess ? { lastSyncedAt: now, lastSuccessfulObservationAt: now } : {}),
        ...(input.outcome.mutated ? { lastMutationAt: now } : {}),
        ...(input.outcome.cursorAdvanced ? { lastCursorAdvancedAt: now } : {}),
        ...(input.outcome.complete ? { lastCompleteReconciliationAt: now } : {}),
        ...(input.outcome.status === "failed" || input.error != null ? { lastErrorAt: now } : {}),
        lastOutcomeStatus: input.outcome.status,
        lastOutcomeReason: errorMessage ?? input.outcome.reason ?? null,
        lastCoverage: input.outcome.coverage as never,
      },
    });
  } catch (error) {
    if (reservation && routineSyncOutcomeWrites.get(input.key) === reservation) {
      routineSyncOutcomeWrites.delete(input.key);
    }
    throw error;
  }
}
