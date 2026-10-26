"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  convertFileListToFileUIParts,
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import type {
  AgentChatUIMessage,
  AgentChatMessageMetadata,
} from "../shared/ui-message";
import { AgentChatApiError, type AgentChatPublicError } from "../shared/errors";
import type { McpContinuationResponse } from "../shared/contracts";
import { agentChatApi } from "./api";

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `request-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function agentChatTransportFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.ok) return response;
  try {
    const body = (await response.clone().json()) as {
      error?: Partial<AgentChatPublicError>;
      requestId?: unknown;
    };
    const publicError = body.error;
    if (
      publicError &&
      typeof publicError.code === "string" &&
      typeof publicError.message === "string"
    ) {
      throw new AgentChatApiError(
        publicError.code as AgentChatPublicError["code"],
        publicError.message,
        response.status,
        publicError.retryable === true,
        publicError.action,
        typeof body.requestId === "string" ? body.requestId : undefined,
      );
    }
  } catch (error) {
    if (error instanceof AgentChatApiError) throw error;
  }
  return response;
}

type ToolApprovalContinuation = {
  assistantUiMessageId: string;
  approvals: Array<{ id: string; approved: boolean; reason?: string }>;
};

type PendingMcpContinuation = {
  conversationId: string;
  requestId: string;
  modelKey: string;
  continuationId: string;
  responses: McpContinuationResponse[];
  uiMode: "chat" | "terminal";
};

function getToolApprovalContinuation(
  messages: readonly AgentChatUIMessage[],
): ToolApprovalContinuation | null {
  const message = messages.at(-1);
  if (!message || message.role !== "assistant") return null;

  const approvals: ToolApprovalContinuation["approvals"] = [];
  for (const part of message.parts) {
    if (
      !isToolUIPart(part) ||
      part.state !== "approval-responded" ||
      !part.approval ||
      typeof part.approval.approved !== "boolean"
    ) {
      continue;
    }
    approvals.push({
      id: part.approval.id,
      approved: part.approval.approved,
      ...(typeof part.approval.reason === "string"
        ? { reason: part.approval.reason }
        : {}),
    });
  }

  return approvals.length
    ? { assistantUiMessageId: message.id, approvals }
    : null;
}

function latestRunId(messages: readonly AgentChatUIMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const metadata = message.metadata as AgentChatMessageMetadata | undefined;
    if (metadata?.runId) return metadata.runId;
  }
  return null;
}

function reconcilePersistedMessages(
  current: AgentChatUIMessage[],
  persisted: AgentChatUIMessage[],
): AgentChatUIMessage[] {
  if (current.length === 0) return persisted;
  if (persisted.length === 0) return current;

  const persistedIds = new Set(persisted.map((message) => message.id));
  const firstOverlap = current.findIndex((message) =>
    persistedIds.has(message.id),
  );
  if (firstOverlap < 0) {
    // A non-empty Chat with no shared ids is not the same history snapshot. Do
    // not let an asynchronous query overwrite potentially live local state.
    return current;
  }

  // The persisted window may omit older pages loaded with "Load earlier", but
  // it must never be allowed to replace a newer local tail. During a run the
  // assistant id exists locally before settlement; if PostgreSQL has not caught
  // up yet, that id will be missing and we keep the browser transcript intact.
  for (let index = firstOverlap; index < current.length; index += 1) {
    const message = current[index];
    if (message && !persistedIds.has(message.id)) return current;
  }

  return [...current.slice(0, firstOverlap), ...persisted];
}

function isExpectedStreamInterruption(error: Error): boolean {
  return (
    error.name === "AbortError" ||
    (error instanceof AgentChatApiError &&
      (error.code === "REQUEST_CANCELLED" ||
        error.code === "RUN_ALREADY_ACTIVE"))
  );
}

export interface UseAgentChatControllerParams {
  agentDbId: number;
  conversationId: string | null;
  clientSessionId: string;
  modelKey: string;
  uiMode?: "chat" | "terminal";
  initialMessages?: AgentChatUIMessage[];
  onConversationCreated?: (conversationId: string) => void;
  onRunSettled?: () => void;
}

export interface UseAgentChatControllerReturn {
  messages: AgentChatUIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  send: (text: string, files?: FileList) => Promise<void>;
  stop: () => void;
  retry: () => void;
  activeRun: { conversationId: string; runId: string } | null;
  isPreparingSend: boolean;
  prependMessages: (messages: AgentChatUIMessage[]) => void;
  replaceMessages: (messages: AgentChatUIMessage[]) => void;
  addToolApprovalResponse: (input: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void | PromiseLike<void>;
  submitMcpContinuation: (input: {
    continuationId: string;
    responses: McpContinuationResponse[];
  }) => Promise<void>;
  isMcpContinuationActive: boolean;
}

export function useAgentChatController({
  agentDbId,
  conversationId,
  clientSessionId,
  modelKey,
  initialMessages,
  uiMode = "chat",
  onConversationCreated,
  onRunSettled,
}: UseAgentChatControllerParams): UseAgentChatControllerReturn {
  const effectiveConversationIdRef = useRef<string | null>(conversationId);
  const latestRunIdRef = useRef<string | null>(null);
  const preparingSendRef = useRef(false);
  const pendingMcpContinuationRef = useRef<PendingMcpContinuation | null>(null);
  const hydrationSessionRef = useRef(clientSessionId);
  const hydratedMessageSourceRef = useRef<{
    clientSessionId: string;
    messages: AgentChatUIMessage[];
  } | null>(
    initialMessages !== undefined
      ? { clientSessionId, messages: initialMessages }
      : null,
  );
  const [isPreparingSend, setIsPreparingSend] = useState(false);
  const [isMcpContinuationActive, setIsMcpContinuationActive] = useState(false);

  useEffect(() => {
    effectiveConversationIdRef.current = conversationId;
  }, [conversationId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgentChatUIMessage>({
        api: `/api/dashboard/agents/${agentDbId}/chat/stream`,
        fetch: agentChatTransportFetch,
        prepareSendMessagesRequest({ messages, body }) {
          const requestBody = body as Record<string, unknown> | undefined;
          if (requestBody?.kind === "mcp-continuation") {
            return { body: requestBody };
          }

          const canonicalConversationId =
            typeof requestBody?.conversationId === "string"
              ? requestBody.conversationId
              : conversationId;
          const approvalContinuation = getToolApprovalContinuation(
            messages as AgentChatUIMessage[],
          );
          if (approvalContinuation) {
            const metadata = messages.at(-1)?.metadata as
              | AgentChatMessageMetadata
              | undefined;
            return {
              body: {
                kind: "tool-approval",
                conversationId: canonicalConversationId,
                requestId:
                  typeof requestBody?.requestId === "string"
                    ? requestBody.requestId
                    : `tool-approval:${approvalContinuation.assistantUiMessageId}`,
                modelKey:
                  typeof requestBody?.modelKey === "string"
                    ? requestBody.modelKey
                    : metadata?.modelKey ?? modelKey,
                assistantUiMessageId: approvalContinuation.assistantUiMessageId,
                approvals: approvalContinuation.approvals,
                uiMode:
                  requestBody?.uiMode === "terminal" ||
                  requestBody?.uiMode === "chat"
                    ? requestBody.uiMode
                    : uiMode,
              },
            };
          }

          let lastUserMessage: AgentChatUIMessage | undefined;
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            const candidate = messages[index];
            if (candidate?.role === "user") {
              lastUserMessage = candidate;
              break;
            }
          }

          return {
            body: {
              kind: "message",
              conversationId: canonicalConversationId,
              requestId:
                typeof requestBody?.requestId === "string"
                  ? requestBody.requestId
                  : generateRequestId(),
              triggerKind:
                requestBody?.triggerKind === "REGENERATE"
                  ? "REGENERATE"
                  : "USER_MESSAGE",
              message: lastUserMessage ?? messages.at(-1),
              modelKey:
                typeof requestBody?.modelKey === "string"
                  ? requestBody.modelKey
                  : modelKey,
              uiMode:
                requestBody?.uiMode === "terminal" ||
                requestBody?.uiMode === "chat"
                  ? requestBody.uiMode
                  : uiMode,
            },
          };
        },
      }),
    [agentDbId, conversationId, modelKey, uiMode],
  );

  const {
    messages: rawMessages,
    status: rawStatus,
    error: rawError,
    sendMessage,
    stop: stopStream,
    regenerate,
    setMessages,
    clearError,
    addToolApprovalResponse,
  } = useChat<AgentChatUIMessage>({
    id: clientSessionId,
    transport,
    messages: initialMessages,
    onFinish() {
      pendingMcpContinuationRef.current = null;
      setIsMcpContinuationActive(false);
      onRunSettled?.();
    },
    onError(error) {
      if (!isExpectedStreamInterruption(error)) {
        console.error("[agent-chat] stream error:", error);
      }
      pendingMcpContinuationRef.current = null;
      setIsMcpContinuationActive(false);
      onRunSettled?.();
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    throttle: 50,
  });

  useEffect(() => {
    const runId = latestRunId(rawMessages as AgentChatUIMessage[]);
    if (runId) latestRunIdRef.current = runId;
  }, [rawMessages]);

  useEffect(() => {
    if (hydrationSessionRef.current !== clientSessionId) {
      // useChat has just constructed a new Chat for this id and consumes the
      // current messages option synchronously as its initial snapshot. Record
      // that source without replaying it through setMessages.
      hydrationSessionRef.current = clientSessionId;
      hydratedMessageSourceRef.current =
        initialMessages !== undefined
          ? { clientSessionId, messages: initialMessages }
          : null;
      return;
    }
    if (initialMessages === undefined) return;
    if (
      isPreparingSend ||
      isMcpContinuationActive ||
      rawStatus === "submitted" ||
      rawStatus === "streaming"
    ) {
      return;
    }
    const hydrated = hydratedMessageSourceRef.current;
    if (
      hydrated?.clientSessionId === clientSessionId &&
      hydrated.messages === initialMessages
    ) {
      return;
    }

    // Query-backed history can arrive after a client-side conversation switch.
    // `messages` is only an initializer in useChat; without this reconciliation
    // a Chat created while the query is pending stays permanently empty. Never
    // reconcile while a local send/stream is active, because the browser copy
    // then contains optimistic and partial assistant state newer than PostgreSQL.
    hydratedMessageSourceRef.current = {
      clientSessionId,
      messages: initialMessages,
    };
    setMessages((current) =>
      reconcilePersistedMessages(
        current as AgentChatUIMessage[],
        initialMessages,
      ),
    );
  }, [
    clientSessionId,
    initialMessages,
    isMcpContinuationActive,
    isPreparingSend,
    rawStatus,
    setMessages,
  ]);

  const ensureConversation = useCallback(
    async (titleSeed: string): Promise<string> => {
      const existing = effectiveConversationIdRef.current;
      if (existing) return existing;
      const created = await agentChatApi.createConversation(agentDbId, {
        modelKey,
        ...(titleSeed.trim() ? { titleSeed } : {}),
      });
      effectiveConversationIdRef.current = created.id;
      onConversationCreated?.(created.id);
      return created.id;
    },
    [agentDbId, modelKey, onConversationCreated],
  );

  const send = useCallback(
    async (text: string, files?: FileList) => {
      if (preparingSendRef.current) return;
      preparingSendRef.current = true;
      setIsPreparingSend(true);
      latestRunIdRef.current = null;
      try {
        const fileParts = files
          ? await convertFileListToFileUIParts(files)
          : undefined;
        const targetConversationId = await ensureConversation(text);
        const requestBody = {
          conversationId: targetConversationId,
          requestId: generateRequestId(),
          triggerKind: "USER_MESSAGE" as const,
          modelKey,
          uiMode,
        };
        if (text.length === 0 && fileParts?.length) {
          void sendMessage({ files: fileParts }, { body: requestBody });
          return;
        }
        void sendMessage({ text, files: fileParts }, { body: requestBody });
      } finally {
        preparingSendRef.current = false;
        setIsPreparingSend(false);
      }
    }, [ensureConversation, modelKey, sendMessage, uiMode]);

  const retry = useCallback(() => {
    const targetConversationId = effectiveConversationIdRef.current;
    if (!targetConversationId) return;
    latestRunIdRef.current = null;
    regenerate({
      body: {
        conversationId: targetConversationId,
        requestId: generateRequestId(),
        triggerKind: "REGENERATE",
        modelKey,
        uiMode,
      },
    });
  }, [modelKey, regenerate, uiMode]);

  const submitMcpContinuation = useCallback(
    async (input: {
      continuationId: string;
      responses: McpContinuationResponse[];
    }) => {
      const targetConversationId = effectiveConversationIdRef.current;
      if (!targetConversationId) {
        throw new AgentChatApiError(
          "INVALID_MESSAGE",
          "MCP continuation requires a persisted conversation",
          409,
          false,
        );
      }
      if (pendingMcpContinuationRef.current) return;
      const pending: PendingMcpContinuation = {
        conversationId: targetConversationId,
        requestId: generateRequestId(),
        modelKey,
        continuationId: input.continuationId,
        responses: input.responses,
        uiMode,
      };
      pendingMcpContinuationRef.current = pending;
      setIsMcpContinuationActive(true);
      latestRunIdRef.current = null;
      try {
        await regenerate({
          body: {
            kind: "mcp-continuation",
            conversationId: pending.conversationId,
            requestId: pending.requestId,
            modelKey: pending.modelKey,
            continuationId: pending.continuationId,
            responses: pending.responses,
            uiMode: pending.uiMode,
          },
        });
      } catch (error) {
        pendingMcpContinuationRef.current = null;
        setIsMcpContinuationActive(false);
        throw error;
      }
    },
    [modelKey, regenerate, uiMode],
  );

  const activeRun = useMemo(() => {
    if (
      rawStatus !== "submitted" &&
      rawStatus !== "streaming" &&
      !isMcpContinuationActive
    ) {
      return null;
    }
    const runId = latestRunId(rawMessages as AgentChatUIMessage[]);
    return runId && conversationId
      ? { conversationId, runId }
      : null;
  }, [conversationId, isMcpContinuationActive, rawMessages, rawStatus]);

  const stop = useCallback(() => {
    // The browser stream is no longer the server run's cancellation signal.
    // Resolve the durable active run by conversation when no metadata chunk has
    // arrived yet, so Stop works during provider startup as well as mid-stream.
    const cancelDurableRun = async () => {
      let runId = latestRunIdRef.current;
      if (!runId) {
        const targetConversationId = effectiveConversationIdRef.current;
        if (targetConversationId) {
          const detail = await agentChatApi.getConversation(
            agentDbId,
            targetConversationId,
          );
          runId = detail.activeRun?.id ?? null;
        }
      }
      if (runId) await agentChatApi.cancelRun(agentDbId, runId);
    };
    void cancelDurableRun().catch((error) => {
      if (
        !(error instanceof AgentChatApiError && error.code === "RUN_NOT_FOUND")
      ) {
        console.warn("[agent-chat] failed to request run cancellation", error);
      }
    });
    stopStream();
  }, [agentDbId, stopStream]);

  const prependMessages = useCallback(
    (older: AgentChatUIMessage[]) => {
      setMessages((current) => {
        const ids = new Set(current.map((message) => message.id));
        return [...older.filter((message) => !ids.has(message.id)), ...current];
      });
    },
    [setMessages],
  );

  const replaceMessages = useCallback(
    (next: AgentChatUIMessage[]) => {
      setMessages(next);
      clearError();
    },
    [clearError, setMessages],
  );

  const status: UseAgentChatControllerReturn["status"] =
    rawStatus === "submitted" || rawStatus === "streaming"
      ? rawStatus
      : rawStatus === "error"
        ? "error"
        : "ready";

  return {
    messages: rawMessages as AgentChatUIMessage[],
    status,
    error: rawError ?? undefined,
    send,
    stop,
    retry,
    activeRun,
    isPreparingSend,
    prependMessages,
    replaceMessages,
    addToolApprovalResponse,
    submitMcpContinuation,
    isMcpContinuationActive,
  };
}
