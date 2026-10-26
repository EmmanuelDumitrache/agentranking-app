import { Prisma } from "@/generated/prisma/client";
import { getToolName, isToolUIPart } from "ai";
import { prisma } from "@/lib/db";
import { usdMicrosToChargeCents } from "@/lib/llm-provider/costing";
import { LLM_CREDIT_REASONS } from "../../shared/constants";
import { redactSensitiveData, redactSensitiveText } from "@/lib/security/sensitive-data-redaction";
import { compactConversationContextSafely } from "../conversation-summary";
import { redactPersistedAgentChatParts } from "../persisted-ui-message";
import { projectMessageSearchFields } from "../message-search-projection";
import { mergeRunArtifactsIntoWorkingState } from "../working-state";
import { resolveAgentChatInitiatingTurn } from "./turn-lineage";
import { recordMcpOperationalEvent } from "../mcp/observability";
import {
  messageRequiresContinuation,
  validateAgentChatUIMessages,
  type AgentChatUIPart,
} from "../../shared/ui-message";
const ZERO_USD_MICROS = BigInt(0);
type SettleOutcome = "COMPLETED" | "FAILED" | "CANCELLED";
type SettleOptions = {
  firstTokenAt?: Date;
  responseMessage?: {
    id: string;
    parts: unknown;
    metadata?: unknown;
  };
  finishReason?: string;
  errorCode?: string;
  errorMessage?: string;
  errorJson?: unknown;
};
type SettleResult = {
  settled: boolean;
  settlementLedgerId?: string;
  remainingBalanceCents: number;
  finalChargeCents: number;
};
function sumNumber(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
function sumBigInt(values: Array<bigint | null>): bigint {
  return values.reduce<bigint>(
    (sum, value) => sum + (value ?? ZERO_USD_MICROS),
    ZERO_USD_MICROS,
  );
}
function usageStatus(
  outcome: SettleOutcome,
): "COMPLETE" | "FAILED" | "CANCELLED" {
  return outcome === "COMPLETED" ? "COMPLETE" : outcome;
}
function reconciliationStatus(
  attempts: Array<{ provider: string; reconciliationStatus: string }>,
) {
  const relevant = attempts.filter(
    (attempt) => attempt.provider === "openrouter",
  );
  if (!relevant.length) return "NOT_APPLICABLE" as const;
  if (relevant.some((attempt) => attempt.reconciliationStatus === "FAILED"))
    return "FAILED" as const;
  if (relevant.some((attempt) => attempt.reconciliationStatus === "PENDING"))
    return "PENDING" as const;
  if (relevant.some((attempt) => attempt.reconciliationStatus === "RETRYING"))
    return "RETRYING" as const;
  if (relevant.some((attempt) => attempt.reconciliationStatus === "ADJUSTED"))
    return "ADJUSTED" as const;
  return "RECONCILED" as const;
}

async function resolveMemorySourceMessageId(
  tx: Prisma.TransactionClient,
  run: { id: string; conversationId: string },
): Promise<string | null> {
  const initiating = await resolveAgentChatInitiatingTurn(tx, {
    runId: run.id,
    conversationId: run.conversationId,
  });
  if (
    !initiating ||
    (initiating.triggerKind !== "USER_MESSAGE" &&
      initiating.triggerKind !== "REGENERATE")
  ) {
    return null;
  }
  return initiating.message.id;
}

/** One terminal transaction for execution state, usage accounting, credits, and the assistant message. */
export async function settleRun(
  runId: string,
  outcome: SettleOutcome,
  options: SettleOptions = {},
): Promise<SettleResult> {
  let responseMessage: SettleOptions["responseMessage"];
  let responseRequiresContinuation = false;
  if (options.responseMessage) {
    const [validated] = await validateAgentChatUIMessages([
      {
        id: options.responseMessage.id,
        role: "assistant",
        parts: redactPersistedAgentChatParts(options.responseMessage.parts),
        ...(options.responseMessage.metadata == null
          ? {}
          : { metadata: redactSensitiveData(options.responseMessage.metadata) }),
      },
    ]);
    if (!validated) throw new Error("Completed run produced no valid UIMessage");
    responseRequiresContinuation = messageRequiresContinuation(validated);
    responseMessage = {
      id: validated.id,
      parts: validated.parts,
      ...(validated.metadata == null ? {} : { metadata: validated.metadata }),
    };
  }
  const safeOptions: SettleOptions = {
    ...options,
    responseMessage,
    errorMessage: options.errorMessage == null ? undefined : redactSensitiveText(options.errorMessage),
    errorJson: options.errorJson == null ? undefined : redactSensitiveData(options.errorJson),
  };
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM agent_chat_runs WHERE id = ${runId} FOR UPDATE`;
      const run = await tx.agentChatRun.findUnique({
        where: { id: runId },
        include: { attempts: { orderBy: { sequence: "asc" } } },
      });
      if (!run) throw new Error(`Agent chat run ${runId} not found`);
      if (run.settlementStatus === "SETTLED") {
        const account = await tx.appAccount.findUnique({
          where: { id: run.appAccountId },
          select: { llmBalanceCents: true },
        });
        return {
          settled: false,
          settlementLedgerId: run.settlementLedgerId ?? undefined,
          remainingBalanceCents: account?.llmBalanceCents ?? 0,
          finalChargeCents: run.finalChargeCents ?? 0,
        };
      }
      const now = new Date();
      await tx.agentChatRunAttempt.updateMany({
        where: { runId, status: "RUNNING" },
        data: {
          status: outcome === "CANCELLED" ? "CANCELLED" : "FAILED",
          errorCode: safeOptions.errorCode,
          errorMessage: safeOptions.errorMessage,
          errorJson: safeOptions.errorJson as Prisma.InputJsonValue | undefined,
          completedAt: now,
        },
      });
      const attempts = await tx.agentChatRunAttempt.findMany({
        where: { runId },
        orderBy: { sequence: "asc" },
      });
      const billable = attempts.filter(
        (attempt) => attempt.status === "SUCCEEDED",
      );
      const localCostUsdMicros = sumBigInt(
        billable.map((attempt) => attempt.localCostUsdMicros),
      );
      const providerCostUsdMicros = sumBigInt(
        billable.map((attempt) => attempt.providerCostUsdMicros),
      );
      const tokenUsage = {
        inputTokens: sumNumber(billable.map((attempt) => attempt.inputTokens)),
        outputTokens: sumNumber(
          billable.map((attempt) => attempt.outputTokens),
        ),
        reasoningTokens: sumNumber(
          billable.map((attempt) => attempt.reasoningTokens),
        ),
        cachedInputTokens: sumNumber(
          billable.map((attempt) => attempt.cachedInputTokens),
        ),
        cacheWriteTokens: sumNumber(
          billable.map((attempt) => attempt.cacheWriteTokens),
        ),
        totalTokens: sumNumber(billable.map((attempt) => attempt.totalTokens)),
      };
      const paidPricing = billable.some(
        (attempt) =>
          attempt.inputPriceUsdMicrosPerMillion > ZERO_USD_MICROS ||
          attempt.outputPriceUsdMicrosPerMillion > ZERO_USD_MICROS ||
          (attempt.reasoningPriceUsdMicrosPerMillion ?? ZERO_USD_MICROS) >
            ZERO_USD_MICROS ||
          (attempt.cachedInputPriceUsdMicrosPerMillion ?? ZERO_USD_MICROS) >
            ZERO_USD_MICROS ||
          (attempt.cacheWritePriceUsdMicrosPerMillion ?? ZERO_USD_MICROS) >
            ZERO_USD_MICROS,
      );
      let finalChargeCents = usdMicrosToChargeCents(localCostUsdMicros, {
        paidPricing,
        totalTokens: tokenUsage.totalTokens,
      });
      let billingAnomalyJson: Prisma.InputJsonValue | undefined;
      if (outcome === "COMPLETED" && billable.length === 0) {
        // A reservation is an authorization hold, not evidence of billable usage.
        // Fail open for the customer when provider-attempt instrumentation is absent:
        // refund the hold and persist an anomaly for operators to investigate.
        finalChargeCents = 0;
        billingAnomalyJson = {
          reason: "COMPLETED_WITHOUT_PROVIDER_ATTEMPT_USAGE",
        };
      }
      let adjustmentCents = run.reservedCents - finalChargeCents;
      let refundCents = Math.max(0, adjustmentCents);
      const settlementKey = `chat-run:${runId}:settle`;
      let settlementLedgerId: string | undefined;
      let remainingBalanceCents: number;
      const existingLedger = await tx.accountCreditLedger.findUnique({
        where: { idempotencyKey: settlementKey },
      });
      if (existingLedger) {
        settlementLedgerId = existingLedger.id;
        remainingBalanceCents = (
          await tx.appAccount.findUniqueOrThrow({
            where: { id: run.appAccountId },
            select: { llmBalanceCents: true },
          })
        ).llmBalanceCents;
      } else if (adjustmentCents !== 0) {
        let appliedDelta = adjustmentCents;
        if (adjustmentCents < 0) {
          const overage = -adjustmentCents;
          const debited = await tx.appAccount.updateMany({
            where: { id: run.appAccountId, llmBalanceCents: { gte: overage } },
            data: { llmBalanceCents: { decrement: overage } },
          });
          if (debited.count !== 1) {
            const account = await tx.appAccount.findUniqueOrThrow({
              where: { id: run.appAccountId },
              select: { llmBalanceCents: true },
            });
            appliedDelta = -account.llmBalanceCents;
            if (account.llmBalanceCents > 0) {
              await tx.appAccount.update({
                where: { id: run.appAccountId },
                data: { llmBalanceCents: 0 },
              });
            }
            finalChargeCents = run.reservedCents + account.llmBalanceCents;
            adjustmentCents = -account.llmBalanceCents;
            refundCents = 0;
            billingAnomalyJson = {
              reason: "INSUFFICIENT_BALANCE_FOR_PROVIDER_OVERAGE",
              actualCents: usdMicrosToChargeCents(localCostUsdMicros, {
                paidPricing,
                totalTokens: tokenUsage.totalTokens,
              }),
              chargedCents: finalChargeCents,
            };
          }
        } else {
          await tx.appAccount.update({
            where: { id: run.appAccountId },
            data: { llmBalanceCents: { increment: adjustmentCents } },
          });
        }
        remainingBalanceCents = (
          await tx.appAccount.findUniqueOrThrow({
            where: { id: run.appAccountId },
            select: { llmBalanceCents: true },
          })
        ).llmBalanceCents;
        const ledger = await tx.accountCreditLedger.create({
          data: {
            appAccountId: run.appAccountId,
            creditType: "LLM",
            delta: appliedDelta,
            balanceAfter: remainingBalanceCents,
            reason:
              appliedDelta > 0
                ? LLM_CREDIT_REASONS.CHAT_RUN_SETTLEMENT_REFUND
                : LLM_CREDIT_REASONS.CHAT_RUN_FINALIZE,
            referenceId: runId,
            idempotencyKey: settlementKey,
          },
        });
        settlementLedgerId = ledger.id;
      } else {
        remainingBalanceCents = (
          await tx.appAccount.findUniqueOrThrow({
            where: { id: run.appAccountId },
            select: { llmBalanceCents: true },
          })
        ).llmBalanceCents;
      }
      const finalAttempt = [...billable].reverse()[0] ?? null;
      const firstTokenAt =
        safeOptions.firstTokenAt ??
        attempts
          .map((attempt) => attempt.firstTokenAt)
          .filter((value): value is Date => value !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0];
      let responseMessageId: string | null = null;
      if (outcome === "COMPLETED" && safeOptions.responseMessage) {
        if (run.triggerKind === "REGENERATE" && run.triggerMessageId) {
          const trigger = await tx.agentChatMessage.findFirst({
            where: {
              id: run.triggerMessageId,
              conversationId: run.conversationId,
              role: "user",
            },
            select: { sequence: true },
          });
          if (trigger) {
            // Regeneration replaces the assistant branch after the initiating
            // user turn in canonical UI state. Historical runs remain in the
            // execution ledger because their transcript links are SET NULL on
            // message deletion. Sequence values are monotonic and need not be
            // compacted.
            await tx.agentChatMessage.deleteMany({
              where: {
                conversationId: run.conversationId,
                role: "assistant",
                sequence: { gt: trigger.sequence },
              },
            });
          }
        }
        const sequenceState = await tx.agentChatConversation.update({
          where: { id: run.conversationId },
          data: {
            nextMessageSequence: { increment: 1 },
            lastMessageAt: now,
          },
          select: { nextMessageSequence: true },
        });
        const response = await tx.agentChatMessage.create({
          data: {
            id: safeOptions.responseMessage.id,
            conversationId: run.conversationId,
            sequence: sequenceState.nextMessageSequence - 1,
            role: "assistant",
            parts: safeOptions.responseMessage.parts as Prisma.InputJsonValue,
            ...projectMessageSearchFields(safeOptions.responseMessage.parts),
            metadata: safeOptions.responseMessage.metadata == null
              ? undefined
              : safeOptions.responseMessage.metadata as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        responseMessageId = response.id;
      }
      await tx.agentChatRun.update({
        where: { id: runId },
        data: {
          settlementStatus: "SETTLED",
          settledAt: now,
          finalChargeCents,
          refundCents,
          settlementLedgerId: settlementLedgerId ?? null,
          status: outcome,
          completedAt: now,
          responseMessageId,
          finishReason: safeOptions.finishReason,
          finalModelKey: finalAttempt?.modelKey,
          finalProvider: finalAttempt?.provider,
          finalProviderModelId: finalAttempt?.providerModelId,
          finalAdapter: finalAttempt?.adapter,
          ...tokenUsage,
          localCostUsdMicros,
          providerCostUsdMicros,
          durationMs: Math.max(0, now.getTime() - run.startedAt.getTime()),
          firstTokenAt,
          errorCode: outcome === "COMPLETED" ? null : safeOptions.errorCode,
          errorMessage: outcome === "COMPLETED" ? null : safeOptions.errorMessage,
          errorJson:
            outcome === "COMPLETED"
              ? Prisma.JsonNull
              : (safeOptions.errorJson as Prisma.InputJsonValue | undefined),
          billingAnomalyJson: billingAnomalyJson ?? Prisma.JsonNull,
        },
      });
      if (
        outcome === "COMPLETED" &&
        !responseRequiresContinuation &&
        responseMessageId
      ) {
        const sourceMessageId = await resolveMemorySourceMessageId(tx, run);
        if (sourceMessageId) {
          await tx.agentMemoryExtractionOutbox.upsert({
            where: { sourceMessageId },
            create: {
              sourceMessageId,
              sourceRunId: runId,
              appAccountId: run.appAccountId,
              agentDbId: run.agentDbId,
              conversationId: run.conversationId,
            },
            update: {
              sourceRunId: runId,
              availableAt: now,
              claimToken: null,
              claimedAt: null,
              lastError: null,
            },
          });
        }
      }
      const reconciliation = reconciliationStatus(attempts);
      await tx.llmRunUsage.update({
        where: { runId },
        data: {
          status: usageStatus(outcome),
          ...tokenUsage,
          chargeCents: finalChargeCents,
          localCostUsdMicros,
          providerCostUsdMicros,
          reconciliationStatus: reconciliation,
          errorMessage: outcome === "COMPLETED" ? null : safeOptions.errorMessage,
          completedAt: now,
        },
      });
      await tx.agentChatRunRuntime.deleteMany({ where: { runId } });
      return {
        settled: true,
        settlementLedgerId,
        remainingBalanceCents,
        finalChargeCents,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (result.settled && outcome === "COMPLETED" && safeOptions.responseMessage) {
    if (Array.isArray(safeOptions.responseMessage.parts)) {
      for (const part of safeOptions.responseMessage.parts as AgentChatUIPart[]) {
        if (
          isToolUIPart(part)
          && part.state === "approval-requested"
          && getToolName(part).startsWith("mcp__")
        ) {
          recordMcpOperationalEvent({ event: "approval", outcome: "requested" });
        }
      }
    }
    const completedRun = await prisma.agentChatRun.findUniqueOrThrow({
      where: { id: runId },
      select: { conversationId: true },
    });
    await mergeRunArtifactsIntoWorkingState({
      conversationId: completedRun.conversationId,
      runId,
    });
    await compactConversationContextSafely(completedRun.conversationId);
  }
  return result;
}
