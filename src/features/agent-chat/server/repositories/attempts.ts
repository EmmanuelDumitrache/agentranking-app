import type { StepResult, ToolSet } from "ai";
import type {
  AgentChatRunAttemptReason,
  AgentChatRunAttemptStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { calculateRunCostUsdMicros } from "@/lib/llm-provider/costing";
import { normalizeProviderUsage } from "@/lib/llm-provider/usage";
import { enqueueApplicationJobInTx } from "@/jobs/producer";
import { getJobProducer } from "@/jobs/boss";
import { JOB_QUEUES } from "@/jobs/queues";
import type { AgentChatModelDefinition } from "../../shared/model-registry-types";
import type { ProviderRuntimeFailure } from "@/lib/llm-provider/provider-failure";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";

function pricingData(model: AgentChatModelDefinition) {
  return {
    inputPriceUsdMicrosPerMillion: BigInt(model.pricing.inputUsdMicrosPerMillion),
    outputPriceUsdMicrosPerMillion: BigInt(model.pricing.outputUsdMicrosPerMillion),
    cachedInputPriceUsdMicrosPerMillion:
      model.pricing.cachedInputUsdMicrosPerMillion == null
        ? null
        : BigInt(model.pricing.cachedInputUsdMicrosPerMillion),
    cacheWritePriceUsdMicrosPerMillion:
      model.pricing.cacheWriteUsdMicrosPerMillion == null
        ? null
        : BigInt(model.pricing.cacheWriteUsdMicrosPerMillion),
    reasoningPriceUsdMicrosPerMillion:
      model.pricing.reasoningUsdMicrosPerMillion == null
        ? null
        : BigInt(model.pricing.reasoningUsdMicrosPerMillion),
  };
}

export async function beginRunAttempt(params: {
  runId: string;
  sequence: number;
  stepIndex: number;
  stepAttemptIndex: number;
  reason: AgentChatRunAttemptReason;
  model: AgentChatModelDefinition;
  sdkCallId?: string;
  sdkProvider?: string;
  sdkModelId?: string;
}) {
  const { model } = params;
  return await prisma.agentChatRunAttempt.create({
    data: {
      runId: params.runId,
      sequence: params.sequence,
      stepIndex: params.stepIndex,
      stepAttemptIndex: params.stepAttemptIndex,
      reason: params.reason,
      modelKey: model.modelKey,
      provider: model.provider,
      providerModelId: model.providerModelId,
      adapter: model.adapter,
      sdkCallId: params.sdkCallId ?? `${params.runId}:${params.sequence}`,
      sdkProvider: params.sdkProvider ?? model.provider,
      sdkModelId: params.sdkModelId ?? model.providerModelId,
      ...pricingData(model),
    },
  });
}

type AttemptStepResult = Pick<
  StepResult<ToolSet>,
  | "usage"
  | "providerMetadata"
  | "response"
  | "finishReason"
  | "rawFinishReason"
  | "performance"
>;

export async function completeRunAttempt(params: {
  attemptId: string;
  result: AttemptStepResult;
  model: AgentChatModelDefinition;
  status?: AgentChatRunAttemptStatus;
}) {
  const usage = normalizeProviderUsage(params.result);
  const localCostUsdMicros = calculateRunCostUsdMicros(usage, {
    inputUsdMicrosPerMillion: params.model.pricing.inputUsdMicrosPerMillion,
    outputUsdMicrosPerMillion: params.model.pricing.outputUsdMicrosPerMillion,
    cachedInputUsdMicrosPerMillion: params.model.pricing.cachedInputUsdMicrosPerMillion,
    cacheWriteUsdMicrosPerMillion: params.model.pricing.cacheWriteUsdMicrosPerMillion,
    reasoningUsdMicrosPerMillion: params.model.pricing.reasoningUsdMicrosPerMillion,
  });
  const result = params.result;
  const providerRequestId = usage.providerRequestId ?? result.response?.id;
  const now = new Date();
  const needsReconciliation = params.model.provider === "openrouter" && Boolean(providerRequestId);
  if (needsReconciliation) await getJobProducer();
  return await prisma.$transaction(async (tx) => {
    const updated = await tx.agentChatRunAttempt.updateMany({
      where: { id: params.attemptId, status: "RUNNING" },
      data: {
        status: params.status ?? "SUCCEEDED",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        totalTokens: usage.totalTokens,
        providerRequestId,
        localCostUsdMicros,
        providerCostUsdMicros: usage.providerCostUsdMicros,
        providerLatencyMs: result.performance?.responseTimeMs,
        durationMs: result.performance?.stepTimeMs,
        firstTokenAt:
          result.performance?.timeToFirstOutputMs == null
            ? undefined
            : new Date(
                now.getTime()
                  - Math.max(0, result.performance.stepTimeMs ?? 0)
                  + result.performance.timeToFirstOutputMs,
              ),
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
        reconciliationStatus: needsReconciliation ? "PENDING" : "NOT_APPLICABLE",
        completedAt: now,
      },
    });
    const attempt = await tx.agentChatRunAttempt.findUniqueOrThrow({
      where: { id: params.attemptId },
    });
    if (needsReconciliation && updated.count > 0) {
      await enqueueApplicationJobInTx(
        tx,
        JOB_QUEUES.OPENROUTER_RECONCILE,
        { v: 1, id: attempt.id },
        { startAfter: new Date(now.getTime() + 15_000), singletonKey: attempt.id },
      );
    }
    return attempt;
  });
}

export async function failRunAttempt(params: {
  attemptId: string;
  failure: ProviderRuntimeFailure;
  status?: Extract<AgentChatRunAttemptStatus, "FAILED" | "CANCELLED">;
}) {
  return await prisma.agentChatRunAttempt.updateMany({
    where: { id: params.attemptId, status: "RUNNING" },
    data: {
      status: params.status ?? (params.failure.kind === "cancelled" ? "CANCELLED" : "FAILED"),
      providerRequestId: params.failure.providerRequestId,
      errorCode: params.failure.publicError.code,
      errorMessage: params.failure.providerMessage ?? params.failure.publicError.message,
      errorJson: safeErrorDetails(params.failure.cause) as never,
      completedAt: new Date(),
    },
  });
}
