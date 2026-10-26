import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { estimateRouteReservation } from "@/lib/llm-provider/reservation";
import { redactSensitiveData } from "@/lib/security/sensitive-data-redaction";
import type { AgentChatAccess } from "../../shared/contracts";
import {
  DEFAULT_MAX_TOOL_STEPS,
  LLM_CREDIT_REASONS,
} from "../../shared/constants";
import type { AgentChatUIMessage } from "../../shared/ui-message";
import type { AgentRoutingPlan } from "../orchestration/types";
import { redactPersistedAgentChatParts } from "../persisted-ui-message";
import { projectMessageSearchFields } from "../message-search-projection";
import { ensureCurrentSettingsRevision } from "../repositories/settings";
import { HttpError } from "../http-error";
import {
  isContextDependentFollowUp,
  normalizeAgentWorkingState,
} from "../working-state";
import {
  estimateContextDemandTokens,
  estimateJsonCharsForBudget,
} from "./context-budget";

export type StartRunResult = {
  conversationId: string;
  runId: string;
  /** Expected UI message id for the response stream. Persisted only on successful settlement. */
  responseMessageId: string;
  triggerMessageId: string;
  settingsRevisionId: string;
  reservedCents: number;
  workerId: string;
  replayed: boolean;
};

const RUNTIME_LEASE_MS = 10_000;
const LOGICAL_CONTEXT_CHARS = 30_000_000;
const ROUTING_RECENT_MESSAGE_LIMIT = 24;
const ROUTING_RECENT_HISTORY_CHARS = 64_000;
const ROUTING_SUMMARY_CHARS = 14_000;
const ROUTING_WORKING_STATE_CHARS = 12_000;
const ROUTING_IMAGE_INPUT_CHARS = 16_384;
const ROUTING_FILE_INPUT_CHARS = 32_768;
const ROUTING_INLINE_ATTACHMENT_MESSAGES = 2;
const ROUTING_INLINE_ATTACHMENT_RECENT_MESSAGES = 6;
const ROUTING_INLINE_TEXT_RECENT_MESSAGES = 12;
const ROUTING_STALE_TEXT_INLINE_MAX_CHARS = 12_000;
const ROUTING_VIRTUALIZED_TEXT_CHARS = 3_500;
const ROUTING_INLINE_TOOL_INPUT_RECENT_MESSAGES = 8;
const ROUTING_STALE_INLINE_TOOL_INPUT_MAX_CHARS = 6_000;
const ROUTING_VIRTUALIZED_TOOL_INPUT_CHARS = 2_800;
const ROUTING_ATTACHMENT_CONTEXT_QUERY = /\b(?:image|photo|picture|screenshot|chart|graph|diagram|figure|attachment|file|document|pdf|spreadsheet|uploaded|visual)\b/i;
const ROUTING_BASE_SYSTEM_PROMPT_CHARS = 8_000;
const ROUTING_SYSTEM_PROMPT_CHARS = 20_000;

function messageHasFileAttachment(message: AgentChatUIMessage): boolean {
  return message.parts.some((part) =>
    part.type === "file"
    && typeof part.mediaType === "string"
    && part.mediaType.length > 0,
  );
}

function messageTextForRouting(message: AgentChatUIMessage): string {
  return message.parts
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n")
    .trim();
}

function messageHasAttachmentContextIntent(message: AgentChatUIMessage): boolean {
  return ROUTING_ATTACHMENT_CONTEXT_QUERY.test(messageTextForRouting(message));
}

function estimateUiPartsCharsForRouting(
  parts: unknown,
  logicalLimitChars: number,
  options: {
    includeFilePayloads?: boolean;
    includeTextPayloads?: boolean;
    includeToolInputPayloads?: boolean;
  } = {},
): number {
  const limit = Math.max(1, Math.trunc(logicalLimitChars));
  const includeFilePayloads = options.includeFilePayloads !== false;
  const includeTextPayloads = options.includeTextPayloads !== false;
  const includeToolInputPayloads = options.includeToolInputPayloads !== false;
  if (!Array.isArray(parts)) return estimateJsonCharsForBudget(parts, limit);
  let remaining = limit;
  let used = 0;
  for (const part of parts) {
    if (remaining <= 0) break;
    if (part && typeof part === "object" && !Array.isArray(part)) {
      const record = part as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        const textChars = !includeTextPayloads
          && record.text.length > ROUTING_STALE_TEXT_INLINE_MAX_CHARS
          ? ROUTING_VIRTUALIZED_TEXT_CHARS
          : record.text.length;
        const chars = Math.min(remaining, textChars + 32);
        used += chars;
        remaining -= chars;
        continue;
      }
      const partType = typeof record.type === "string" ? record.type : "";
      if (
        !includeToolInputPayloads
        && (partType === "dynamic-tool" || partType.startsWith("tool-"))
        && "input" in record
      ) {
        // Completed historical assistant tool calls remain canonical in the
        // transcript. Keep ordinary small inputs exact, but mirror the runtime
        // compiler's per-call virtualization for large stale arguments so an
        // old MCP/write body cannot force unnecessary model escalation.
        const inputProbeChars = estimateJsonCharsForBudget(
          record.input,
          Math.min(
            Math.max(1, remaining),
            ROUTING_STALE_INLINE_TOOL_INPUT_MAX_CHARS + 1,
          ),
        );
        if (inputProbeChars > ROUTING_STALE_INLINE_TOOL_INPUT_MAX_CHARS) {
          const withoutInput = Object.fromEntries(
            Object.entries(record).filter(([key]) => key !== "input"),
          );
          const metadataChars = estimateJsonCharsForBudget(withoutInput, remaining);
          const inputChars = Math.min(
            Math.max(0, remaining - metadataChars),
            ROUTING_VIRTUALIZED_TOOL_INPUT_CHARS,
          );
          const chars = Math.min(remaining, metadataChars + inputChars);
          used += chars;
          remaining -= chars;
          continue;
        }
      }
      const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
      if (record.type === "file" && mediaType.length > 0) {
        // Provider media inputs are not priced as the base64/URL transport
        // representation. Old file-bearing messages beyond the protected
        // working set are virtualized to a canonical message/part reference,
        // so route planning should not reserve a full media allowance for them.
        const mediaChars = includeFilePayloads
          ? (mediaType.startsWith("image/")
            ? ROUTING_IMAGE_INPUT_CHARS
            : ROUTING_FILE_INPUT_CHARS)
          : 384;
        const chars = Math.min(remaining, mediaChars);
        used += chars;
        remaining -= chars;
        continue;
      }
    }
    const chars = estimateJsonCharsForBudget(part, remaining);
    used += chars;
    remaining -= chars;
  }
  return used;
}

function estimateSystemPromptCharsForRouting(access: AgentChatAccess): number {
  let remaining = Math.max(
    0,
    ROUTING_SYSTEM_PROMPT_CHARS - ROUTING_BASE_SYSTEM_PROMPT_CHARS,
  );
  let chars = ROUTING_BASE_SYSTEM_PROMPT_CHARS;
  const persona = access.settings.persona?.trim();
  if (persona && remaining > 0) {
    const personaChars = Math.min(remaining, persona.length + 64);
    chars += personaChars;
    remaining -= personaChars;
  }
  const creatorInstructions = access.settings.systemInstructions?.trim();
  if (creatorInstructions && remaining > 0) {
    const instructionChars = estimateJsonCharsForBudget(
      creatorInstructions,
      remaining,
    );
    chars += instructionChars;
  }
  return Math.min(chars, ROUTING_SYSTEM_PROMPT_CHARS);
}

type ReplayableRun = {
  id: string;
  conversationId: string;
  triggerMessageId: string | null;
  responseMessageId: string | null;
  settingsRevisionId: string;
  reservedCents: number;
  runtime: { workerId: string } | null;
};

function responseMessageIdForRun(runId: string): string {
  return `agent-chat-response:${runId}`;
}

function replayResult(prior: ReplayableRun): StartRunResult {
  if (!prior.triggerMessageId) {
    throw new HttpError(
      409,
      "INVALID_MESSAGE",
      "The original run no longer has a transcript trigger",
    );
  }
  return {
    conversationId: prior.conversationId,
    runId: prior.id,
    responseMessageId:
      prior.responseMessageId ?? responseMessageIdForRun(prior.id),
    triggerMessageId: prior.triggerMessageId,
    settingsRevisionId: prior.settingsRevisionId,
    reservedCents: prior.reservedCents,
    workerId: prior.runtime?.workerId ?? "",
    replayed: true,
  };
}

async function findReplay(requestId: string): Promise<ReplayableRun | null> {
  return prisma.agentChatRun.findUnique({
    where: { requestId },
    select: {
      id: true,
      conversationId: true,
      triggerMessageId: true,
      responseMessageId: true,
      settingsRevisionId: true,
      reservedCents: true,
      runtime: { select: { workerId: true } },
    },
  });
}

function uniqueConflictTarget(error: Prisma.PrismaClientKnownRequestError): string[] {
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof target === "string" ? [target] : [];
}

function isActiveRunUniqueConflict(
  error: Prisma.PrismaClientKnownRequestError,
): boolean {
  const target = uniqueConflictTarget(error).map((entry) => entry.toLowerCase());
  return target.some(
    (entry) =>
      entry.includes("agent_chat_one_active_run") ||
      entry === "conversation_id" ||
      entry === "conversationid",
  );
}

async function estimatePersistedContextChars(
  access: AgentChatAccess,
  conversationId: string,
  options: {
    throughMessageId?: string;
    inlineAttachmentMessages?: number;
    inheritWorkingObjectiveForAttachmentContext?: boolean;
    currentAttachmentOutsideHistory?: boolean;
  } = {},
): Promise<number[]> {
  const conversation = await prisma.agentChatConversation.findFirst({
    where: {
      id: conversationId,
      appAccountId: access.appAccountId,
      agentDbId: access.agentDbId,
      status: "ACTIVE",
    },
    select: {
      contextSummary: true,
      summaryThroughSequence: true,
      workingState: true,
    },
  });
  if (!conversation) return [];

  const throughMessage = options.throughMessageId
    ? await prisma.agentChatMessage.findFirst({
        where: {
          id: options.throughMessageId,
          conversationId,
        },
        select: { sequence: true },
      })
    : null;
  if (options.throughMessageId && !throughMessage) {
    throw new HttpError(
      409,
      "INVALID_MESSAGE",
      "The regeneration source message is no longer available",
    );
  }
  if (
    throughMessage &&
    conversation.summaryThroughSequence != null &&
    throughMessage.sequence <= conversation.summaryThroughSequence
  ) {
    throw new HttpError(
      409,
      "INVALID_MESSAGE",
      "This older turn has already been compacted and cannot be regenerated safely",
    );
  }

  let remaining = ROUTING_RECENT_HISTORY_CHARS;
  const chars: number[] = [];
  if (conversation.contextSummary) {
    const summaryChars = Math.min(
      conversation.contextSummary.length,
      ROUTING_SUMMARY_CHARS,
      remaining,
    );
    chars.push(summaryChars);
    remaining -= summaryChars;
  }
  if (remaining > 0 && conversation.workingState != null) {
    const workingStateChars = estimateJsonCharsForBudget(
      redactSensitiveData(conversation.workingState),
      Math.min(remaining, ROUTING_WORKING_STATE_CHARS),
    );
    chars.push(workingStateChars);
    remaining -= workingStateChars;
  }
  if (remaining <= 0) return chars;

  const history = await prisma.agentChatMessage.findMany({
    where: {
      conversationId,
      ...(conversation.summaryThroughSequence == null && throughMessage == null
        ? {}
        : {
            sequence: {
              ...(conversation.summaryThroughSequence == null
                ? {}
                : { gt: conversation.summaryThroughSequence }),
              ...(throughMessage == null
                ? {}
                : { lte: throughMessage.sequence }),
            },
          }),
    },
    orderBy: { sequence: "desc" },
    take: ROUTING_RECENT_MESSAGE_LIMIT,
    select: { role: true, parts: true },
  });
  let inlineAttachmentMessages = Math.max(
    0,
    Math.min(
      ROUTING_INLINE_ATTACHMENT_MESSAGES,
      Math.trunc(options.inlineAttachmentMessages ?? ROUTING_INLINE_ATTACHMENT_MESSAGES),
    ),
  );
  if (options.inheritWorkingObjectiveForAttachmentContext) {
    const objective = normalizeAgentWorkingState(conversation.workingState).objective;
    if (ROUTING_ATTACHMENT_CONTEXT_QUERY.test(objective)) {
      inlineAttachmentMessages = Math.max(
        inlineAttachmentMessages,
        Math.max(
          0,
          ROUTING_INLINE_ATTACHMENT_MESSAGES
            - (options.currentAttachmentOutsideHistory ? 1 : 0),
        ),
      );
    }
  }
  let recentUserTurns = 0;
  for (const [historyIndex, item] of history.entries()) {
    if (remaining <= 0) break;
    const hasAttachment = Array.isArray(item.parts) && item.parts.some((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return false;
      const record = part as Record<string, unknown>;
      const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
      return record.type === "file" && mediaType.length > 0;
    });
    const attachmentInsideRecentWorkingSet =
      historyIndex < ROUTING_INLINE_ATTACHMENT_RECENT_MESSAGES;
    const includeFilePayloads =
      !hasAttachment || (attachmentInsideRecentWorkingSet && inlineAttachmentMessages > 0);
    if (hasAttachment && includeFilePayloads) inlineAttachmentMessages -= 1;
    const partChars = estimateUiPartsCharsForRouting(
      item.parts,
      remaining,
      {
        includeFilePayloads,
        includeTextPayloads:
          historyIndex < ROUTING_INLINE_TEXT_RECENT_MESSAGES,
        includeToolInputPayloads:
          historyIndex < ROUTING_INLINE_TOOL_INPUT_RECENT_MESSAGES
          || recentUserTurns < 3,
      },
    );
    chars.push(partChars);
    remaining -= partChars;
    if (item.role === "user") recentUserTurns += 1;
  }
  return chars;
}

export async function estimateRunInputTokenDemand(
  access: AgentChatAccess,
  message: AgentChatUIMessage,
  conversationId: string,
  options: {
    messageAlreadyPersisted?: boolean;
    throughMessageId?: string;
    additionalSystemPromptChars?: number;
  } = {},
): Promise<number> {
  const hasCurrentAttachment = messageHasFileAttachment(message);
  const routingUserText = messageTextForRouting(message);
  const attachmentContextIntent = messageHasAttachmentContextIntent(message);
  const inheritWorkingObjectiveForAttachmentContext =
    isContextDependentFollowUp(routingUserText);
  const historyInlineAttachmentMessages = options.messageAlreadyPersisted
    ? (hasCurrentAttachment
      ? (attachmentContextIntent ? ROUTING_INLINE_ATTACHMENT_MESSAGES : 1)
      : (attachmentContextIntent ? ROUTING_INLINE_ATTACHMENT_MESSAGES : 0))
    : (attachmentContextIntent
      ? Math.max(0, ROUTING_INLINE_ATTACHMENT_MESSAGES - (hasCurrentAttachment ? 1 : 0))
      : 0);
  return estimateContextDemandTokens({
    systemPromptChars:
      estimateSystemPromptCharsForRouting(access)
      + Math.max(0, Math.trunc(options.additionalSystemPromptChars ?? 0)),
    currentMessageChars: options.messageAlreadyPersisted
      ? 0
      : estimateUiPartsCharsForRouting(message.parts, LOGICAL_CONTEXT_CHARS),
    historyMessageChars: await estimatePersistedContextChars(
      access,
      conversationId,
      {
        throughMessageId: options.throughMessageId,
        inlineAttachmentMessages: historyInlineAttachmentMessages,
        inheritWorkingObjectiveForAttachmentContext,
        currentAttachmentOutsideHistory: hasCurrentAttachment && !options.messageAlreadyPersisted,
      },
    ),
    safetyTokens: 256,
  });
}

async function createReservedRun(
  tx: Prisma.TransactionClient,
  args: {
    access: AgentChatAccess;
    routingPlan: AgentRoutingPlan;
    conversationId: string;
    triggerMessageId: string;
    requestId: string;
    triggerKind:
      | "USER_MESSAGE"
      | "REGENERATE"
      | "TOOL_APPROVAL"
      | "MCP_INPUT"
      | "SCHEDULE";
    parentRunId?: string;
    estimatedInputTokens: number;
    continuationLabel?: string;
    workerId: string;
    additionalModelCalls?: number;
  },
): Promise<{ runId: string; settingsRevisionId: string; reservedCents: number }> {
  const settingsRevision = await ensureCurrentSettingsRevision(tx, args.access);
  if (!settingsRevision.enabled) {
    throw new HttpError(403, "CHAT_DISABLED", "Chat is disabled for this agent");
  }

  const routeModels = [
    args.routingPlan.primaryModel,
    ...args.routingPlan.fallbackModels,
  ];
  const estimate = estimateRouteReservation(
    routeModels,
    args.estimatedInputTokens,
    DEFAULT_MAX_TOOL_STEPS + Math.max(0, Math.trunc(args.additionalModelCalls ?? 0)),
  );
  const run = await tx.agentChatRun.create({
    data: {
      requestId: args.requestId,
      conversationId: args.conversationId,
      appAccountId: args.access.appAccountId,
      agentDbId: args.access.agentDbId,
      triggerMessageId: args.triggerMessageId,
      triggerKind: args.triggerKind,
      parentRunId: args.parentRunId,
      settingsRevisionId: settingsRevision.id,
      status: "PREPARING",
      settlementStatus: "PENDING",
      requestedModelKey: args.routingPlan.requestedModel.modelKey,
      initialModelKey: args.routingPlan.primaryModel.modelKey,
      routingPolicy: args.routingPlan.routingPolicy,
      routingReason: args.routingPlan.reason,
      routingJson: {
        requestedModelKey: args.routingPlan.requestedModel.modelKey,
        primaryModelKey: args.routingPlan.primaryModel.modelKey,
        fallbackModelKeys: args.routingPlan.fallbackModels.map(
          (model) => model.modelKey,
        ),
        ...(args.continuationLabel
          ? { continuation: args.continuationLabel }
          : {}),
      } as Prisma.InputJsonValue,
      pricingRevision: estimate.pricingRevision,
      reservationInputTokens: estimate.estimatedInputTokens,
      reservationOutputTokens: estimate.estimatedOutputTokens,
      maxToolSteps: DEFAULT_MAX_TOOL_STEPS,
      reservedCents: estimate.reservedCents,
    },
  });

  await tx.llmRunUsage.create({
    data: {
      runId: run.id,
      appAccountId: args.access.appAccountId,
      agentDbId: args.access.agentDbId,
    },
  });
  const now = new Date();
  await tx.agentChatRunRuntime.create({
    data: {
      runId: run.id,
      workerId: args.workerId,
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + RUNTIME_LEASE_MS),
    },
  });

  if (estimate.reservedCents > 0) {
    const debit = await tx.appAccount.updateMany({
      where: {
        id: args.access.appAccountId,
        llmBalanceCents: { gte: estimate.reservedCents },
      },
      data: { llmBalanceCents: { decrement: estimate.reservedCents } },
    });
    if (debit.count !== 1) {
      throw new HttpError(
        402,
        "INSUFFICIENT_CREDITS",
        "Insufficient credits for this run",
      );
    }
    const account = await tx.appAccount.findUniqueOrThrow({
      where: { id: args.access.appAccountId },
      select: { llmBalanceCents: true },
    });
    const ledger = await tx.accountCreditLedger.create({
      data: {
        appAccountId: args.access.appAccountId,
        creditType: "LLM",
        delta: -estimate.reservedCents,
        balanceAfter: account.llmBalanceCents,
        reason: LLM_CREDIT_REASONS.CHAT_RUN_RESERVE,
        referenceId: run.id,
        idempotencyKey: `chat-run:${run.id}:reserve`,
      },
    });
    await tx.agentChatRun.update({
      where: { id: run.id },
      data: { reservationLedgerId: ledger.id },
    });
  }

  await tx.agentChatRun.update({
    where: { id: run.id },
    data: { status: "RESERVED" },
  });
  return {
    runId: run.id,
    settingsRevisionId: settingsRevision.id,
    reservedCents: estimate.reservedCents,
  };
}

async function rethrowUniqueRunConflict(
  error: unknown,
  access: AgentChatAccess,
  requestId: string,
  conversationId: string,
): Promise<StartRunResult> {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    throw error;
  }

  const conflictTarget = uniqueConflictTarget(error);

  const accepted = await findReplay(requestId);
  if (
    accepted &&
    accepted.conversationId === conversationId &&
    (await prisma.agentChatRun.findUnique({
      where: { id: accepted.id },
      select: { appAccountId: true, agentDbId: true },
    }))?.appAccountId === access.appAccountId
  ) {
    const identity = await prisma.agentChatRun.findUniqueOrThrow({
      where: { id: accepted.id },
      select: { agentDbId: true },
    });
    if (identity.agentDbId === access.agentDbId) return replayResult(accepted);
  }

  if (conflictTarget.length > 0 && !isActiveRunUniqueConflict(error)) {
    throw error;
  }

  const active = await prisma.agentChatRun.findFirst({
    where: {
      conversationId,
      appAccountId: access.appAccountId,
      agentDbId: access.agentDbId,
      settlementStatus: "PENDING",
      status: { in: ["PREPARING", "RESERVED", "STREAMING"] },
    },
    select: { id: true },
  });
  if (active) {
    throw new HttpError(
      409,
      "RUN_ALREADY_ACTIVE",
      "This conversation already has an active response",
      true,
    );
  }
  throw error;
}

export async function startRun(
  access: AgentChatAccess,
  routingPlan: AgentRoutingPlan,
  message: AgentChatUIMessage,
  requestId: string,
  conversationId: string,
  options: {
    estimatedInputTokens?: number;
    triggerKind?: "USER_MESSAGE" | "REGENERATE" | "SCHEDULE";
    additionalModelCalls?: number;
  } = {},
): Promise<StartRunResult> {
  const prior = await findReplay(requestId);
  if (prior) {
    const identity = await prisma.agentChatRun.findUniqueOrThrow({
      where: { id: prior.id },
      select: { appAccountId: true, agentDbId: true },
    });
    if (
      identity.appAccountId !== access.appAccountId ||
      identity.agentDbId !== access.agentDbId ||
      prior.conversationId !== conversationId
    ) {
      throw new HttpError(
        409,
        "INVALID_MESSAGE",
        "Request identifier is already in use",
      );
    }
    return replayResult(prior);
  }

  const estimatedInputTokens =
    options.estimatedInputTokens ??
    (await estimateRunInputTokenDemand(
      access,
      message,
      conversationId,
      options.triggerKind === "REGENERATE"
        ? {
            messageAlreadyPersisted: true,
            throughMessageId: message.id,
          }
        : undefined,
    ));
  const persistedParts = redactPersistedAgentChatParts(message.parts);
  const workerId = crypto.randomUUID();

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const conversation = await tx.agentChatConversation.findFirst({
          where: {
            id: conversationId,
            appAccountId: access.appAccountId,
            agentDbId: access.agentDbId,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (!conversation) {
          throw new HttpError(
            404,
            "CONVERSATION_NOT_FOUND",
            "Active conversation not found",
          );
        }

        const existingUser = await tx.agentChatMessage.findUnique({
          where: { id: message.id },
          select: { id: true, conversationId: true, role: true, sequence: true },
        });
        if (
          existingUser &&
          (existingUser.conversationId !== conversationId ||
            existingUser.role !== "user")
        ) {
          throw new HttpError(
            409,
            "INVALID_MESSAGE",
            "Message identifier is already in use",
          );
        }

        const triggerKind = options.triggerKind ?? "USER_MESSAGE";
        if (triggerKind === "REGENERATE" && !existingUser) {
          throw new HttpError(
            409,
            "INVALID_MESSAGE",
            "Regeneration requires an existing canonical user message",
          );
        }
        if (triggerKind === "REGENERATE" && existingUser) {
          const laterUserMessage = await tx.agentChatMessage.findFirst({
            where: {
              conversationId,
              role: "user",
              sequence: { gt: existingUser.sequence },
            },
            select: { id: true },
          });
          if (laterUserMessage) {
            throw new HttpError(
              409,
              "INVALID_MESSAGE",
              "Only the latest user turn can be regenerated",
            );
          }
        }
        if (triggerKind !== "REGENERATE" && existingUser) {
          throw new HttpError(
            409,
            "INVALID_MESSAGE",
            "Message identifier is already in use",
          );
        }

        let triggerMessageId = existingUser?.id;
        if (!triggerMessageId) {
          const sequenceState = await tx.agentChatConversation.update({
            where: { id: conversationId },
            data: {
              nextMessageSequence: { increment: 1 },
              lastMessageAt: new Date(),
              defaultModelKey: routingPlan.requestedModel.modelKey,
            },
            select: { nextMessageSequence: true },
          });
          const userMessage = await tx.agentChatMessage.create({
            data: {
              id: message.id,
              conversationId,
              sequence: sequenceState.nextMessageSequence - 1,
              role: "user",
              parts: persistedParts as Prisma.InputJsonValue,
              ...projectMessageSearchFields(persistedParts),
              metadata: {
                createdAt: new Date().toISOString(),
              } as Prisma.InputJsonValue,
            },
            select: { id: true },
          });
          triggerMessageId = userMessage.id;
        } else {
          await tx.agentChatConversation.update({
            where: { id: conversationId },
            data: { defaultModelKey: routingPlan.requestedModel.modelKey },
          });
        }

        const reserved = await createReservedRun(tx, {
          access,
          routingPlan,
          conversationId,
          triggerMessageId,
          requestId,
          triggerKind,
          estimatedInputTokens,
          workerId,
          additionalModelCalls: options.additionalModelCalls,
        });
        return { ...reserved, triggerMessageId };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      conversationId,
      runId: result.runId,
      responseMessageId: responseMessageIdForRun(result.runId),
      triggerMessageId: result.triggerMessageId,
      settingsRevisionId: result.settingsRevisionId,
      reservedCents: result.reservedCents,
      workerId,
      replayed: false,
    };
  } catch (error) {
    return rethrowUniqueRunConflict(
      error,
      access,
      requestId,
      conversationId,
    );
  }
}

export async function estimateContinuationInputTokenDemand(
  access: AgentChatAccess,
  conversationId: string,
): Promise<number> {
  return estimateContextDemandTokens({
    systemPromptChars: estimateSystemPromptCharsForRouting(access),
    currentMessageChars: 128,
    historyMessageChars: await estimatePersistedContextChars(
      access,
      conversationId,
    ),
    safetyTokens: 256,
  });
}

export async function startContinuationRun(
  access: AgentChatAccess,
  routingPlan: AgentRoutingPlan,
  params: {
    conversationId: string;
    triggerMessageId: string;
    parentRunId: string;
    requestId: string;
    estimatedInputTokens: number;
    triggerKind: "TOOL_APPROVAL" | "MCP_INPUT";
    additionalModelCalls?: number;
  },
): Promise<StartRunResult> {
  const prior = await findReplay(params.requestId);
  if (prior) {
    const identity = await prisma.agentChatRun.findUniqueOrThrow({
      where: { id: prior.id },
      select: { appAccountId: true, agentDbId: true },
    });
    if (
      identity.appAccountId !== access.appAccountId ||
      identity.agentDbId !== access.agentDbId ||
      prior.conversationId !== params.conversationId
    ) {
      throw new HttpError(
        409,
        "INVALID_MESSAGE",
        "Request identifier is already in use",
      );
    }
    return replayResult(prior);
  }

  const workerId = crypto.randomUUID();
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const triggerMessage = await tx.agentChatMessage.findFirst({
          where: {
            id: params.triggerMessageId,
            conversationId: params.conversationId,
            role: "assistant",
            conversation: {
              appAccountId: access.appAccountId,
              agentDbId: access.agentDbId,
              status: "ACTIVE",
            },
          },
          select: { id: true },
        });
        if (!triggerMessage) {
          throw new HttpError(
            409,
            "INVALID_MESSAGE",
            "The continuation is not associated with a valid assistant message",
          );
        }
        const parentRun = await tx.agentChatRun.findFirst({
          where: {
            id: params.parentRunId,
            conversationId: params.conversationId,
            appAccountId: access.appAccountId,
            agentDbId: access.agentDbId,
            status: "COMPLETED",
            settlementStatus: "SETTLED",
            responseMessageId: triggerMessage.id,
          },
          select: { id: true },
        });
        if (!parentRun) {
          throw new HttpError(
            409,
            "INVALID_MESSAGE",
            "Continuation parent run does not own the canonical assistant message",
          );
        }

        return createReservedRun(tx, {
          access,
          routingPlan,
          conversationId: params.conversationId,
          triggerMessageId: triggerMessage.id,
          parentRunId: params.parentRunId,
          requestId: params.requestId,
          triggerKind: params.triggerKind,
          continuationLabel:
            params.triggerKind === "TOOL_APPROVAL"
              ? "tool-approval"
              : "mcp-continuation",
          estimatedInputTokens: params.estimatedInputTokens,
          workerId,
          additionalModelCalls: params.additionalModelCalls,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      conversationId: params.conversationId,
      runId: result.runId,
      responseMessageId: responseMessageIdForRun(result.runId),
      triggerMessageId: params.triggerMessageId,
      settingsRevisionId: result.settingsRevisionId,
      reservedCents: result.reservedCents,
      workerId,
      replayed: false,
    };
  } catch (error) {
    return rethrowUniqueRunConflict(
      error,
      access,
      params.requestId,
      params.conversationId,
    );
  }
}
