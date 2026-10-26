import { prisma } from "@/lib/db";
import { usdAmountToMicros } from "./costing";
import { fetchGeneration } from "./openrouter-api";
export type ReconciliationResult =
  | {
      status: "RECONCILED" | "ADJUSTED";
      localCostUsdMicros: bigint;
      actualCostUsdMicros: bigint;
    }
  | { status: "NO_OP"; reason: string }
  | { status: "RETRYING" }
  | { status: "FAILED"; reason: string };
const ZERO_USD_MICROS = BigInt(0);
const TWO_PERCENT_SCALE = BigInt(100);
const TWO_PERCENT_TOLERANCE = BigInt(2);
const MAX_ATTEMPTS = 5;
async function refreshRunReconciliation(runId: string): Promise<void> {
  const attempts = await prisma.agentChatRunAttempt.findMany({
    where: { runId, provider: "openrouter" },
    select: { reconciliationStatus: true, reconciledCostUsdMicros: true },
  });
  if (!attempts.length) {
    await prisma.llmRunUsage.updateMany({
      where: { runId },
      data: {
        reconciliationStatus: "NOT_APPLICABLE",
        reconciledCostUsdMicros: null,
      },
    });
    return;
  }
  const status = attempts.some(
    (attempt) => attempt.reconciliationStatus === "FAILED",
  )
    ? "FAILED"
    : attempts.some((attempt) => attempt.reconciliationStatus === "PENDING")
      ? "PENDING"
      : attempts.some((attempt) => attempt.reconciliationStatus === "RETRYING")
        ? "RETRYING"
        : attempts.some(
              (attempt) => attempt.reconciliationStatus === "ADJUSTED",
            )
          ? "ADJUSTED"
          : "RECONCILED";
  const reconciled = attempts.every(
    (attempt) => attempt.reconciledCostUsdMicros !== null,
  )
    ? attempts.reduce(
        (sum, attempt) =>
          sum + (attempt.reconciledCostUsdMicros ?? ZERO_USD_MICROS),
        ZERO_USD_MICROS,
      )
    : null;
  await prisma.llmRunUsage.updateMany({
    where: { runId },
    data: { reconciliationStatus: status, reconciledCostUsdMicros: reconciled },
  });
}
export async function reconcileGenerationAttempt(
  attemptId: string,
): Promise<ReconciliationResult> {
  const attempt = await prisma.agentChatRunAttempt.findUnique({
    where: { id: attemptId },
  });
  if (!attempt) return { status: "NO_OP", reason: "attempt not found" };
  if (attempt.provider !== "openrouter" || attempt.status !== "SUCCEEDED")
    return {
      status: "NO_OP",
      reason: "attempt is not a completed OpenRouter generation",
    };
  if (["RECONCILED", "ADJUSTED"].includes(attempt.reconciliationStatus))
    return { status: "NO_OP", reason: "already reconciled" };
  if (!attempt.providerRequestId)
    return { status: "NO_OP", reason: "no provider request id" };
  const response = await fetchGeneration(attempt.providerRequestId);
  if (!response) {
    const attempts = attempt.reconciliationAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.agentChatRunAttempt.update({
        where: { id: attempt.id },
        data: {
          reconciliationStatus: "FAILED",
          reconciliationAttempts: attempts,
        },
      });
      await refreshRunReconciliation(attempt.runId);
      return { status: "FAILED", reason: "max attempts exceeded" };
    }
    await prisma.agentChatRunAttempt.update({
      where: { id: attempt.id },
      data: {
        reconciliationStatus: "RETRYING",
        reconciliationAttempts: attempts,
      },
    });
    await refreshRunReconciliation(attempt.runId);
    return { status: "RETRYING" };
  }
  const localCostUsdMicros = attempt.localCostUsdMicros ?? ZERO_USD_MICROS;
  const actualCostUsdMicros = usdAmountToMicros(response.total_cost);
  const diff =
    localCostUsdMicros > actualCostUsdMicros
      ? localCostUsdMicros - actualCostUsdMicros
      : actualCostUsdMicros - localCostUsdMicros;
  const withinTolerance =
    localCostUsdMicros === ZERO_USD_MICROS
      ? diff === ZERO_USD_MICROS
      : diff * TWO_PERCENT_SCALE <= localCostUsdMicros * TWO_PERCENT_TOLERANCE;
  const status = withinTolerance ? "RECONCILED" : "ADJUSTED";
  await prisma.agentChatRunAttempt.update({
    where: { id: attempt.id },
    data: {
      reconciliationStatus: status,
      reconciliationAttempts: attempt.reconciliationAttempts + 1,
      reconciledCostUsdMicros: actualCostUsdMicros,
    },
  });
  await refreshRunReconciliation(attempt.runId);
  return { status, localCostUsdMicros, actualCostUsdMicros };
}
