"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  dedupeTerminalLogLines,
  sortTerminalLogLines,
} from "@/lib/agent-trading/terminal-log-shared";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LlmCreditTopUpDialog } from "@/components/dashboard/llm-credit-top-up-dialog";
import { useHydrated } from "@/hooks/use-hydrated";
import { useSourceDraft } from "@/hooks/use-source-draft";
import {
  replaceAgentChatNewDraftUrl,
  useAgentChatUrlState,
} from "./url-state";
import { useAgentChatController } from "./chat-controller";
import { getAgentChatClientSessionId } from "./chat-session-identity";
import {
  useAgentChatConversation,
  useAgentChatConversations,
  useAgentChatModels,
  useAgentChatRun,
  useAgentChatSettings,
  useLlmCreditBalance,
} from "./query-hooks";
import { agentChatApi } from "./api";
import { agentChatKeys } from "./query-keys";
import { AgentChatApiError } from "../shared/errors";
import { AgentChatComposer } from "./AgentChatComposer";
import { AgentChatContextPanel } from "./AgentChatContextPanel";
import { AgentChatConversation } from "./AgentChatConversation";
import { AgentChatHeader } from "./AgentChatHeader";
import { AgentChatTerminalComposer } from "./AgentChatTerminalComposer";
import { AgentChatTerminalConversation } from "./AgentChatTerminalConversation";
import { AgentChatTerminalHeader } from "./AgentChatTerminalHeader";
import { AGENT_CHAT_MODEL_PICKER_TRIGGER_ID } from "./AgentChatModelPicker";
import { AgentChatSettingsSheet } from "./AgentChatSettingsSheet";
import type { ClientModelOption } from "../shared/contracts";
import type { AgentChatUIMessage } from "../shared/ui-message";
import {
  createTerminalLocalLine,
  executeTerminalCommand,
  type TerminalLocalLine,
} from "./terminal-commands";
import {
  bootTerminalLogLine,
  messagesToTerminalLogLines,
} from "./terminal-log-lines";
import { useTerminalActivityLog } from "./use-terminal-activity-log";
import {
  AGENT_CHAT_NEW_DRAFT_EVENT,
  type AgentChatNewDraftDetail,
} from "./new-chat-events";

const MODEL_STORAGE_KEY = "agent-chat:model-key";
const DEFAULT_MODEL_KEY = "openrouter:openai/gpt-4o-mini";
const ACTIVE_RUN_STATUSES = new Set(["PREPARING", "RESERVED", "STREAMING"]);
function loadModelPreference(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL_KEY;
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) ?? DEFAULT_MODEL_KEY;
  } catch {
    return DEFAULT_MODEL_KEY;
  }
}
function saveModelPreference(modelKey: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, modelKey);
  } catch {
    // localStorage can be unavailable in hardened/private browser contexts.
  }
}
function providerLabelFromCredentialId(providerId: string): string {
  switch (providerId.trim().toLowerCase()) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "deepseek":
      return "DeepSeek";
    case "google-ai-studio":
      return "Google AI Studio";
    default:
      return providerId
        .split(/[._-]+/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}
interface AgentChatShellAgent {
  id: number;
  name: string;
  description: string | null;
  image?: string;
  isVerified: boolean;
}
interface Props {
  agent: AgentChatShellAgent;
  appearance?: "default" | "terminal";
}
export function AgentChatShell({ agent, appearance = "default" }: Props) {
  const { conversationId, setConversationId, replaceConversationId } =
    useAgentChatUrlState();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const wasStreaming = useRef(false);
  const refreshedRemoteRunRef = useRef<string | null>(null);
  const implicitConversationIdRef = useRef<string | null>(null);
  const preferDraftRef = useRef(false);
  const rejectedConversationIdsRef = useRef<Set<string>>(new Set());
  const consumedNewConversationIntentRef = useRef(false);
  const modelPreferenceHydrated = useHydrated();
  const [modelKey, setModelKey] = useSourceDraft(
    modelPreferenceHydrated ? "stored-model" : "server-model",
    modelPreferenceHydrated ? loadModelPreference() : DEFAULT_MODEL_KEY,
  );
  const [draftSessionKey, setDraftSessionKey] = useState(0);
  const [terminalLocalLines, setTerminalLocalLines] = useState<TerminalLocalLine[]>(
    [],
  );
  const [terminalBootLine] = useState(() => bootTerminalLogLine(agent.name));
  const terminalActivity = useTerminalActivityLog(
    agent.id,
    appearance === "terminal",
  );
  const [promotedConversationId, setPromotedConversationId] = useState<
    string | null
  >(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [streamConversationLock, setStreamConversationLock] = useState<{
    conversationId: string | null;
    settled: boolean;
  } | null>(null);
  const [cursorOverride, setCursorOverride] = useState<{
    conversationId: string;
    value: number | null;
  } | null>(null);
  const activeConversationId = streamConversationLock
    ? streamConversationLock.conversationId
    : conversationId;
  const clientSessionId = useMemo(
    () =>
      getAgentChatClientSessionId({
        agentDbId: agent.id,
        conversationId: activeConversationId,
        promotedConversationId,
        draftSessionKey,
      }),
    [agent.id, activeConversationId, draftSessionKey, promotedConversationId],
  );
  const {
    data: balance,
    isLoading: isBalanceLoading,
    isError: isBalanceError,
    refetch: refetchBalance,
  } = useLlmCreditBalance();
  const {
    data: modelData,
    isLoading: isModelsLoading,
    isError: isModelsError,
    refetch: refetchModels,
  } = useAgentChatModels(agent.id);
  const {
    data: settings,
    isLoading: isSettingsLoading,
    isError: isSettingsError,
    refetch: refetchSettings,
  } = useAgentChatSettings(agent.id);
  // Shared with sidebar — avoid a second GET /chat/threads via a "primary" key.
  const {
    data: conversationsData,
    isLoading: isConversationsLoading,
    isSuccess: isConversationsReady,
  } = useAgentChatConversations(agent.id);
  const primaryConversationId = useMemo(() => {
    const items = conversationsData?.pages.flatMap((page) => page.items) ?? [];
    const active =
      items.find((item) => item.status === "ACTIVE") ?? items[0] ?? null;
    return active?.id ?? null;
  }, [conversationsData]);
  const applyNewDraftState = useCallback(() => {
    preferDraftRef.current = true;
    implicitConversationIdRef.current = null;
    setPromotedConversationId(null);
    setCursorOverride(null);
    setDraftSessionKey((value) => value + 1);
  }, []);
  const startNewDraft = useCallback(() => {
    // The current useChat instance owns the local SSE lifecycle. Starting a new
    // draft while that instance is locked would change its client id and detach
    // the visible stream. Ignore draft switches while the local run owns it.
    if (streamConversationLock) return;
    applyNewDraftState();
    replaceConversationId(null);
  }, [applyNewDraftState, replaceConversationId, streamConversationLock]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AgentChatNewDraftDetail>).detail;
      if (detail?.agentDbId !== agent.id) return;
      startNewDraft();
    };
    window.addEventListener(AGENT_CHAT_NEW_DRAFT_EVENT, handler);
    return () => window.removeEventListener(AGENT_CHAT_NEW_DRAFT_EVENT, handler);
  }, [agent.id, startNewDraft]);
  useEffect(() => {
    if (searchParams.get("new") !== "1") {
      consumedNewConversationIntentRef.current = false;
      return;
    }
    if (
      streamConversationLock ||
      consumedNewConversationIntentRef.current
    ) {
      return;
    }
    consumedNewConversationIntentRef.current = true;

    // Consume the server-entry `?new=1` marker without starting another RSC
    // navigation. The mounted shell owns draft identity and must survive this
    // query-string cleanup. Defer the local state transition out of the effect
    // body so React observes one coherent draft + URL update.
    queueMicrotask(() => {
      applyNewDraftState();
      replaceAgentChatNewDraftUrl();
    });
  }, [applyNewDraftState, searchParams, streamConversationLock]);
  useEffect(() => {
    if (!isConversationsReady) return;
    // Explicit conversation from Chat nav / sidebar — leave draft mode.
    if (conversationId) {
      preferDraftRef.current = false;
      return;
    }
    // `?new=1` draft: stay on welcome prompts until the first message.
    if (preferDraftRef.current) return;
    // Selecting Chat with an existing thread → open the latest one.
    // No chats yet → leave URL empty so the starter prompts show.
    if (
      primaryConversationId &&
      !rejectedConversationIdsRef.current.has(primaryConversationId)
    ) {
      replaceConversationId(primaryConversationId);
    }
  }, [
    conversationId,
    isConversationsReady,
    primaryConversationId,
    replaceConversationId,
  ]);
  const deferConversationReadForLocalRun =
    !!activeConversationId &&
    !!streamConversationLock &&
    !streamConversationLock.settled;
  const {
    data: conversationData,
    isLoading: isConversationLoading,
    isError: isConversationError,
    error: conversationError,
    refetch: refetchConversation,
  } = useAgentChatConversation(agent.id, activeConversationId, {
    // A local useChat stream is the freshest transcript owner. Do not let a
    // concurrent detail read replace it with PostgreSQL's pre-settlement view.
    // This is especially important for the first turn: createConversation
    // persists the thread before startRun persists the user message, so an eager
    // read can legitimately return an empty transcript. Settlement invalidates
    // this query and the controller then reconciles the canonical history.
    enabled: !deferConversationReadForLocalRun,
  });
  const availableModels = useMemo(
    () =>
      modelData?.models.filter((model) => model.availability === "available") ??
      [],
    [modelData],
  );
  const preferredModel = useMemo(
    () =>
      modelData?.models.find((model) => model.modelKey === modelKey) ?? null,
    [modelData, modelKey],
  );
  const selectedModel = useMemo(
    () =>
      availableModels.find((model) => model.modelKey === modelKey) ??
      availableModels.find((model) => model.isDefault) ??
      availableModels[0] ??
      null,
    [availableModels, modelKey],
  );
  const effectiveModelKey = selectedModel?.modelKey ?? modelKey;
  const usingTemporaryModelFallback =
    !!preferredModel &&
    !!selectedModel &&
    preferredModel.modelKey !== selectedModel.modelKey;
  useEffect(() => {
    if (
      !modelPreferenceHydrated ||
      !modelData ||
      !selectedModel ||
      modelKey === selectedModel.modelKey ||
      modelData.models.some((model) => model.modelKey === modelKey)
    ) return;
    saveModelPreference(selectedModel.modelKey);
  }, [modelData, modelKey, modelPreferenceHydrated, selectedModel]);
  const handleModelSelect = useCallback((key: string) => {
    setModelKey(key);
    saveModelPreference(key);
  }, [setModelKey]);
  const handleConversationCreated = useCallback(
    (newId: string) => {
      preferDraftRef.current = false;
      implicitConversationIdRef.current = newId;
      rejectedConversationIdsRef.current.delete(newId);
      setPromotedConversationId(newId);
      setStreamConversationLock((current) =>
        current ? { ...current, conversationId: newId } : current,
      );
      replaceConversationId(newId);
      void queryClient.invalidateQueries({
        queryKey: agentChatKeys.conversations(agent.id),
      });
    },
    [agent.id, queryClient, replaceConversationId],
  );
  const effectivePromotedConversationId =
    promotedConversationId === activeConversationId &&
    (isConversationLoading || (!conversationData && !isConversationError))
      ? promotedConversationId
      : null;
  const modelsUnavailable = isModelsError && !modelData;
  const settingsUnavailable = isSettingsError && !settings;
  const conversationUnavailable = isConversationError && !conversationData;
  const balanceUnavailable = isBalanceError && !balance;
  /** While models registry loads, keep composer usable with the stored preference. */
  const composerModel = useMemo((): ClientModelOption | null => {
    if (selectedModel) return selectedModel;
    if (!modelPreferenceHydrated || !modelKey || modelsUnavailable) return null;
    if (!isModelsLoading) return null;
    const byokMatch = /^byok:([^:]+):/.exec(modelKey);
    const credentialProvider = byokMatch?.[1] ?? null;
    const isByok = credentialProvider !== null;
    const provider = modelKey.startsWith("opencode:")
      ? "opencode"
      : credentialProvider ?? "openrouter";
    return {
      modelKey,
      provider,
      providerLabel:
        provider === "opencode"
          ? "OpenCode"
          : isByok
            ? providerLabelFromCredentialId(provider) || "Provider key"
            : "OpenRouter",
      label: "Loading models…",
      description: "",
      capabilities: {
        tools: true,
        reasoning: false,
        images: false,
        attachments: false,
        webSearch: false,
      },
      isFree: false,
      isDefault: false,
      credentialSource: isByok ? "byok" : "platform",
      billingOwner: isByok ? "user" : "platform",
      billingLabel: isByok ? "Your provider credential" : "AgentRanking credits",
      pricing: { inputPerMillionCents: 0, outputPerMillionCents: 0 },
      availability: "available",
    };
  }, [
    isModelsLoading,
    modelKey,
    modelPreferenceHydrated,
    modelsUnavailable,
    selectedModel,
  ]);
  const sendModelKey = composerModel?.modelKey ?? effectiveModelKey;
  // Deleted / missing conversation in the URL → fall back to latest active chat.
  useEffect(() => {
    if (!conversationUnavailable || !activeConversationId) return;
    const isMissing =
      conversationError instanceof AgentChatApiError &&
      (conversationError.code === "CONVERSATION_NOT_FOUND" ||
        conversationError.status === 404);
    if (!isMissing) return;
    rejectedConversationIdsRef.current.add(activeConversationId);
    // A long-lived browser tab can retain a now-deleted thread list across a
    // local DB reset/reseed. Refresh the shared list as soon as a detail 404
    // proves that one cached summary is stale instead of walking old entries
    // indefinitely.
    void queryClient.invalidateQueries({
      queryKey: agentChatKeys.conversations(agent.id),
    });
    const nextPrimary =
      primaryConversationId &&
      primaryConversationId !== activeConversationId &&
      !rejectedConversationIdsRef.current.has(primaryConversationId)
        ? primaryConversationId
        : null;
    if (nextPrimary) {
      replaceConversationId(nextPrimary);
      return;
    }
    preferDraftRef.current = true;
    replaceConversationId(null);
  }, [
    activeConversationId,
    agent.id,
    conversationError,
    conversationUnavailable,
    primaryConversationId,
    queryClient,
    replaceConversationId,
  ]);
  const contextAgent = useMemo(
    () => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      image: agent.image ?? "",
      isVerified: agent.isVerified,
    }),
    [agent.description, agent.id, agent.image, agent.isVerified, agent.name],
  );
  const initialMessages: AgentChatUIMessage[] | undefined =
    conversationData?.messages;
  const previousCursor =
    cursorOverride?.conversationId === activeConversationId
      ? cursorOverride.value
      : (conversationData?.previousCursor ?? null);
  // Deep-linked ?conversation= must not wait on the threads list before painting.
  // Always pass the real conversation id into the controller — never null it out
  // while history is loading, or a just-created thread (starter prompt / first
  // send) gets remounted as a draft and the stream is dropped.
  const conversationHistoryReady =
    !activeConversationId ||
    (!isConversationLoading && !conversationUnavailable);
  const controllerReady = activeConversationId
    ? conversationHistoryReady
    : !isConversationsLoading;
  const handleRunSettled = useCallback(() => {
    setStreamConversationLock((current) =>
      current ? { ...current, settled: true } : current,
    );
  }, []);
  const {
    messages,
    status,
    error,
    send: controllerSend,
    stop: controllerStop,
    retry,
    isPreparingSend,
    prependMessages,
    replaceMessages,
    addToolApprovalResponse,
    submitMcpContinuation,
    isMcpContinuationActive,
  } = useAgentChatController({
    agentDbId: agent.id,
    conversationId: activeConversationId,
    clientSessionId,
    modelKey: sendModelKey,
    initialMessages:
      activeConversationId && conversationHistoryReady
        ? initialMessages
        : undefined,
    onConversationCreated: handleConversationCreated,
    onRunSettled: handleRunSettled,
    uiMode: appearance === "terminal" ? "terminal" : "chat",
  });
  const isStreaming = status === "streaming" || status === "submitted";
  const isLocalRunBusy =
    isPreparingSend || isStreaming || isMcpContinuationActive;
  const sessionLogLines = useMemo(() => {
    if (appearance !== "terminal") return [];
    return dedupeTerminalLogLines(
      sortTerminalLogLines([
        terminalBootLine,
        ...terminalActivity.lines,
        ...messagesToTerminalLogLines(messages),
      ]),
    );
  }, [appearance, messages, terminalActivity.lines, terminalBootLine]);
  const send = useCallback(async (text: string, files?: FileList) => {
    setStreamConversationLock({
      conversationId: activeConversationId,
      settled: false,
    });
    try {
      await controllerSend(text, files);
    } catch (cause) {
      setStreamConversationLock(null);
      throw cause;
    }
  }, [activeConversationId, controllerSend]);
  const stop = useCallback(() => {
    controllerStop();
    setStreamConversationLock(null);
  }, [controllerStop]);
  const persistedActiveRunId = conversationData?.activeRun?.id ?? null;
  const { data: remoteRunData } = useAgentChatRun(
    agent.id,
    isLocalRunBusy ? null : persistedActiveRunId,
  );
  const remoteRun = isLocalRunBusy
    ? null
    : (remoteRunData ?? conversationData?.activeRun ?? null);
  const remoteRunActive =
    !!remoteRun && ACTIVE_RUN_STATUSES.has(remoteRun.status);
  const activeRunConflict =
    error instanceof AgentChatApiError && error.code === "RUN_ALREADY_ACTIVE";
  // A refresh detaches the browser from the live SSE response but does not
  // cancel the durable run. Treat the persisted run as locally busy, poll it,
  // and hydrate the final canonical transcript when settlement completes.
  const isRunBusy = isLocalRunBusy || remoteRunActive;
  const effectiveStatus =
    remoteRunActive && (status === "ready" || status === "error")
      ? "submitted"
      : status;
  const effectiveError = remoteRunActive ? undefined : error;
  useEffect(() => {
    if (!activeRunConflict || !activeConversationId) return;
    // useChat optimistically appended the rejected user message before the
    // server's one-active-run invariant returned 409. Rehydrate immediately so
    // multi-tab/rapid-submit races display the canonical transcript while the
    // already-running response continues in the background.
    void (async () => {
      const refreshedConversation = await refetchConversation();
      if (refreshedConversation.data?.messages) {
        replaceMessages(refreshedConversation.data.messages);
      }
      await queryClient.invalidateQueries({
        queryKey: agentChatKeys.conversations(agent.id),
      });
    })();
  }, [
    activeConversationId,
    activeRunConflict,
    agent.id,
    queryClient,
    refetchConversation,
    replaceMessages,
  ]);
  useEffect(() => {
    if (isStreaming) {
      wasStreaming.current = true;
      return;
    }
    if (!wasStreaming.current) return;
    wasStreaming.current = false;
    void refetchBalance();
    void queryClient.invalidateQueries({
      queryKey: agentChatKeys.conversations(agent.id),
    });
    const conversationToRefresh = activeConversationId ?? conversationId;
    if (conversationToRefresh) {
      void queryClient.invalidateQueries({
        queryKey: agentChatKeys.conversation(agent.id, conversationToRefresh),
      });
    }
  }, [
    activeConversationId,
    agent.id,
    conversationId,
    isStreaming,
    queryClient,
    refetchBalance,
  ]);
  useEffect(() => {
    if (
      !remoteRunData ||
      ACTIVE_RUN_STATUSES.has(remoteRunData.status) ||
      refreshedRemoteRunRef.current === remoteRunData.id
    )
      return;
    refreshedRemoteRunRef.current = remoteRunData.id;
    void (async () => {
      const refreshedConversation = activeConversationId
        ? await refetchConversation()
        : null;
      if (refreshedConversation?.data?.messages) {
        replaceMessages(refreshedConversation.data.messages);
      }
      await Promise.all([
        refetchBalance(),
        queryClient.invalidateQueries({
          queryKey: agentChatKeys.conversations(agent.id),
        }),
        ...(activeConversationId
          ? [
              queryClient.invalidateQueries({
                queryKey: agentChatKeys.conversation(
                  agent.id,
                  activeConversationId,
                ),
              }),
            ]
          : []),
      ]);
    })();
  }, [
    activeConversationId,
    agent.id,
    queryClient,
    refetchBalance,
    refetchConversation,
    replaceMessages,
    remoteRunData,
  ]);
  useEffect(() => {
    if (!streamConversationLock) return;
    if (conversationId !== streamConversationLock.conversationId) {
      // A local run owns its conversation selection until settlement. This also
      // closes the tiny draft-promotion window where useSearchParams has not yet
      // observed the native-history replacement.
      replaceConversationId(streamConversationLock.conversationId);
      return;
    }
    if (!streamConversationLock.settled) return;
    queueMicrotask(() => {
      setStreamConversationLock((current) =>
        current?.settled && current.conversationId === conversationId
          ? null
          : current,
      );
    });
  }, [conversationId, replaceConversationId, streamConversationLock]);
  const paidModelSelected =
    !!composerModel &&
    composerModel.billingOwner === "platform" &&
    !composerModel.isFree;
  const balancePendingForPaidModel =
    paidModelSelected && isBalanceLoading && !balance;
  const balanceUnavailableForPaidModel =
    paidModelSelected && balanceUnavailable;
  const lacksPaidCredits =
    paidModelSelected && !!balance && balance.availableCents <= 0;
  const composerDisabled =
    !modelPreferenceHydrated ||
    !controllerReady ||
    conversationUnavailable ||
    modelsUnavailable ||
    isSettingsLoading ||
    settingsUnavailable ||
    settings?.enabled === false ||
    !composerModel ||
    balancePendingForPaidModel ||
    balanceUnavailableForPaidModel ||
    lacksPaidCredits;
  const disabledReason = !modelPreferenceHydrated
    ? "Loading model preference"
    : conversationUnavailable
      ? "Conversation could not be loaded"
      : !controllerReady
        ? "Loading conversation"
        : modelsUnavailable
          ? "Models are unavailable"
          : isSettingsLoading
            ? "Loading chat settings"
            : settingsUnavailable
              ? "Chat settings are unavailable"
              : settings?.enabled === false
                ? "Chat is disabled in settings"
                : !composerModel
                  ? isModelsLoading
                    ? "Loading models"
                    : "Choose an available model"
                  : balancePendingForPaidModel
                    ? "Checking credit balance"
                    : balanceUnavailableForPaidModel
                      ? "Credit balance is unavailable"
                      : lacksPaidCredits
                        ? "Add credits or choose a free model"
                        : undefined;
  // Both chat appearances share the same readiness contract. Keeping a
  // terminal-specific copy previously let terminal input race settings loads
  // that correctly blocked the standard composer.
  const effectiveComposerDisabled = composerDisabled;
  const effectiveDisabledReason = disabledReason;
  const terminalHistoryLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (appearance !== "terminal" || !activeConversationId || isRunBusy) return;
    if (terminalHistoryLoadedRef.current === activeConversationId) return;
    const initialCursor =
      cursorOverride?.conversationId === activeConversationId
        ? cursorOverride.value
        : (conversationData?.previousCursor ?? null);
    if (initialCursor == null) {
      terminalHistoryLoadedRef.current = activeConversationId;
      return;
    }
    if (!conversationHistoryReady) return;

    const loadAllEarlier = async () => {
      let cursor: number | null = initialCursor;
      while (cursor != null) {
        const currentCursor = cursor;
        const page = await agentChatApi.getEarlierMessages(
          agent.id,
          activeConversationId,
          currentCursor,
        );
        prependMessages(page.messages);
        cursor = page.previousCursor;
        setCursorOverride({
          conversationId: activeConversationId,
          value: page.previousCursor,
        });
      }
      terminalHistoryLoadedRef.current = activeConversationId;
    };

    void loadAllEarlier();
  }, [
    activeConversationId,
    agent.id,
    appearance,
    conversationData?.previousCursor,
    conversationHistoryReady,
    cursorOverride,
    isRunBusy,
    prependMessages,
  ]);
  // Rare recovery path (context overflow / missing thread) — resets to a fresh
  // single chat without exposing a multi-conversation UI.
  const resetChat = useCallback(() => {
    if (isRunBusy) return;
    applyNewDraftState();
    setConversationId(null);
  }, [applyNewDraftState, isRunBusy, setConversationId]);
  const sendTerminal = useCallback(
    async (text: string) => {
      if (appearance !== "terminal") {
        await send(text);
        return;
      }
      const result = await executeTerminalCommand(text, {
        agentDbId: agent.id,
        agentName: agent.name,
        agentCardConfigured: true,
      });
      if (result.handled) {
        setTerminalLocalLines((current) => {
          const next = result.clearLocal || result.resetSession ? [] : [...current];
          return [
            ...next,
            createTerminalLocalLine({ kind: "user", text }),
            ...result.lines.map((line) => createTerminalLocalLine(line)),
          ];
        });
        if (result.resetSession) {
          resetChat();
        }
        return;
      }
      await send(text);
    },
    [agent.id, agent.name, appearance, resetChat, send],
  );
  const toggleContext = useCallback(
    () => setContextOpen((value) => !value),
    [],
  );
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openTopUp = useCallback(() => setTopUpOpen(true), []);
  const closeTopUp = useCallback(() => setTopUpOpen(false), []);
  const openModelPicker = useCallback(() => {
    document.getElementById(AGENT_CHAT_MODEL_PICKER_TRIGGER_ID)?.click();
  }, []);
  const retryModels = useCallback(() => void refetchModels(), [refetchModels]);
  const retryBalance = useCallback(
    () => void refetchBalance(),
    [refetchBalance],
  );
  const retryConversation = useCallback(
    () => void refetchConversation(),
    [refetchConversation],
  );
  const retrySettings = useCallback(
    () => void refetchSettings(),
    [refetchSettings],
  );
  const refreshChatState = useCallback(() => {
    void Promise.all([
      refetchModels(),
      refetchSettings(),
      refetchBalance(),
      ...(activeConversationId ? [refetchConversation()] : []),
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.conversations(agent.id),
      }),
    ]);
  }, [
    activeConversationId,
    agent.id,
    queryClient,
    refetchBalance,
    refetchConversation,
    refetchModels,
    refetchSettings,
  ]);
  const settledTopUp = useCallback(
    () => void refetchBalance(),
    [refetchBalance],
  );
  return (
    <div
      className={cn(
        "ui-chat-shell flex h-full min-h-0 flex-col overflow-hidden",
        appearance === "terminal"
          ? "ui-chat-shell--terminal"
          : "!bg-[#0f0f0f] text-neutral-100",
      )}
    >
      <Sheet open={contextOpen} onOpenChange={setContextOpen}>
        <SheetContent
          side="right"
          className="flex w-[min(20rem,92vw)] flex-col gap-0 overflow-hidden border-l border-[#212121] bg-[#0f0f0f] p-0 text-neutral-100 sm:w-80"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Agent context</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <AgentChatContextPanel
              agent={contextAgent}
              selectedModel={selectedModel}
            />
          </div>
        </SheetContent>
      </Sheet>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {appearance === "terminal" ? (
          <AgentChatTerminalHeader
            agentName={agent.name}
            onOpenSettings={openSettings}
            modelKey={effectiveModelKey}
            onModelSelect={handleModelSelect}
            models={modelData?.models ?? availableModels}
            modelsLoading={isModelsLoading || !modelPreferenceHydrated}
            modelsError={modelsUnavailable}
            onRetryModels={retryModels}
            isStreaming={isRunBusy}
            selectedModel={composerModel}
          />
        ) : (
          <AgentChatHeader
            contextOpen={contextOpen}
            onToggleContext={toggleContext}
            onOpenSettings={openSettings}
            modelKey={effectiveModelKey}
            onModelSelect={handleModelSelect}
            models={modelData?.models ?? availableModels}
            modelsLoading={isModelsLoading || !modelPreferenceHydrated}
            modelsError={modelsUnavailable}
            onRetryModels={retryModels}
            isStreaming={isRunBusy}
          />
        )}
        {appearance !== "terminal" && settings?.enabled === false && (
          <div
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
            role="status"
          >
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
            <span className="min-w-48 flex-1 leading-relaxed">
              Chat is disabled for this agent.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 bg-background/70"
              onClick={openSettings}
            >
              Open settings
            </Button>
          </div>
        )}
        {appearance !== "terminal" &&
          usingTemporaryModelFallback &&
          preferredModel &&
          selectedModel && (
          <div
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
            role="status"
          >
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
            <span className="min-w-48 flex-1 leading-relaxed">
              {preferredModel.label} is unavailable. Using {selectedModel.label}
              .
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 bg-background/70"
              onClick={openModelPicker}
              disabled={isRunBusy}
            >
              Change model
            </Button>
          </div>
        )}
        {appearance === "terminal" ? (
          <AgentChatTerminalConversation
            lines={sessionLogLines}
            localLines={terminalLocalLines}
            status={effectiveStatus}
            error={effectiveError}
            onRetry={retry}
            onAddCredits={openTopUp}
            onOpenSettings={openSettings}
            onChooseModel={openModelPicker}
            agentName={agent.name}
            className="min-h-0 flex-1"
            activityLoading={terminalActivity.loading}
            activityError={terminalActivity.error}
            onRefreshActivity={() => void terminalActivity.refresh()}
            messages={messages}
            onApprovalResponse={(input) => addToolApprovalResponse(input)}
            onMcpContinuation={(input) => submitMcpContinuation(input)}
            mcpContinuationDisabled={isRunBusy || isMcpContinuationActive}
            isHydrating={
              (!activeConversationId && isConversationsLoading) ||
              (!!activeConversationId &&
                isConversationLoading &&
                !(
                  activeConversationId === effectivePromotedConversationId &&
                  messages.length > 0
                ))
            }
          />
        ) : (
          <AgentChatConversation
            messages={messages}
            status={effectiveStatus}
            error={effectiveError}
            onRetry={retry}
            onAddCredits={openTopUp}
            onOpenSettings={openSettings}
            onChooseModel={openModelPicker}
            onStartNewConversation={resetChat}
            onRefresh={refreshChatState}
            loadError={conversationUnavailable ? conversationError : null}
            onRetryLoad={retryConversation}
            greeting={settings?.greeting}
            agentName={agent.name}
            agentImage={agent.image}
            isVerified={agent.isVerified}
            userImage={session?.user?.image}
            userName={session?.user?.name}
            onSelectPrompt={(text) => {
              void send(text);
            }}
            onApprovalResponse={(input) => addToolApprovalResponse(input)}
            onMcpContinuation={(input) => submitMcpContinuation(input)}
            mcpContinuationDisabled={isRunBusy || isMcpContinuationActive}
            promptsDisabled={
              isRunBusy ||
              settings?.enabled === false ||
              !composerModel ||
              modelsUnavailable ||
              settingsUnavailable
            }
            className="min-h-0 flex-1"
            isHydrating={
              (!activeConversationId && isConversationsLoading) ||
              (!!activeConversationId &&
                isConversationLoading &&
                !(
                  activeConversationId === effectivePromotedConversationId &&
                  messages.length > 0
                ))
            }
            onLoadEarlier={
              activeConversationId && previousCursor !== null && !isRunBusy
                ? async () => {
                    const page = await agentChatApi.getEarlierMessages(
                      agent.id,
                      activeConversationId,
                      previousCursor,
                    );
                    prependMessages(page.messages);
                    setCursorOverride({
                      conversationId: activeConversationId,
                      value: page.previousCursor,
                    });
                  }
                : undefined
            }
          />
        )}
        {appearance === "terminal" ? (
          <AgentChatTerminalComposer
            key={`terminal:${activeConversationId ?? `draft:${draftSessionKey}`}`}
            agentName={agent.name}
            status={effectiveStatus}
            onSend={sendTerminal}
            onStop={stop}
            isPreparing={isPreparingSend}
            isDisabled={effectiveComposerDisabled}
            disabledReason={effectiveDisabledReason}
            className="shrink-0"
          />
        ) : (
          <AgentChatComposer
            key={activeConversationId ?? `draft:${draftSessionKey}`}
            className="shrink-0"
            status={effectiveStatus}
            onSend={send}
            onStop={stop}
            isPreparing={isPreparingSend}
            selectedModel={composerModel}
            isDisabled={effectiveComposerDisabled}
            disabledReason={effectiveDisabledReason}
            balanceCents={balance?.availableCents}
            balanceError={balanceUnavailableForPaidModel}
            onAddCredits={openTopUp}
            onRetryBalance={retryBalance}
          />
        )}
      </div>
      <AgentChatSettingsSheet
        agentDbId={agent.id}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        isLoading={isSettingsLoading}
        isError={settingsUnavailable}
        onRetry={retrySettings}
      />
      <LlmCreditTopUpDialog
        open={topUpOpen}
        onClose={closeTopUp}
        onSettled={settledTopUp}
      />
    </div>
  );
}
