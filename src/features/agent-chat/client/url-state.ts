"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

// Chat selection is client UI state once the workspace is mounted. Using the
// App Router for query-only changes causes a new RSC navigation, which can
// replace the component that owns an in-flight `useChat` stream. Next.js keeps
// `useSearchParams` in sync with the native History API, so shallow history
// writes preserve the live controller while still producing shareable URLs.

type ParsedUrlState = {
  conversation: string | null;
  context: string | null;
};

type UrlStatePatch = Partial<{
  conversation: string | null;
  context: string | null;
}>;

type HistoryMode = "push" | "replace";

function parseUrlState(
  searchParams: Pick<URLSearchParams, "get">,
): ParsedUrlState {
  return {
    conversation: searchParams.get("conversation") ?? null,
    context: searchParams.get("context") ?? null,
  };
}

function applyUrlStatePatch(
  currentParams: URLSearchParams,
  patch: UrlStatePatch,
): URLSearchParams {
  const next = new URLSearchParams(currentParams.toString());
  if ("conversation" in patch) {
    if (patch.conversation) {
      next.set("conversation", patch.conversation);
    } else {
      next.delete("conversation");
    }
  }
  if ("context" in patch) {
    if (patch.context) {
      next.set("context", patch.context);
    } else {
      next.delete("context");
    }
  }
  return next;
}

function writeAgentChatHistory(
  patch: UrlStatePatch,
  mode: HistoryMode,
  options: { clearNewConversationIntent?: boolean } = {},
): void {
  if (typeof window === "undefined") return;

  // Read the live location at invocation time rather than a render-captured
  // searchParams value. This prevents two rapid query-only updates from
  // accidentally restoring a parameter removed by the first update.
  const next = applyUrlStatePatch(
    new URLSearchParams(window.location.search),
    patch,
  );
  if (options.clearNewConversationIntent) next.delete("new");

  const query = next.toString();
  const href =
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  const currentHref =
    `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (mode === "push" && href === currentHref) return;

  if (mode === "replace") {
    window.history.replaceState(null, "", href);
  } else {
    window.history.pushState(null, "", href);
  }
}

export function pushAgentChatConversationUrl(id: string | null): void {
  writeAgentChatHistory(
    { conversation: id },
    "push",
    { clearNewConversationIntent: true },
  );
}

export function replaceAgentChatConversationUrl(id: string | null): void {
  writeAgentChatHistory(
    { conversation: id },
    "replace",
    { clearNewConversationIntent: true },
  );
}

export function replaceAgentChatNewDraftUrl(): void {
  writeAgentChatHistory(
    { conversation: null },
    "replace",
    { clearNewConversationIntent: true },
  );
}

export function useAgentChatUrlState(): {
  conversationId: string | null;
  contextPanel: string | null;
  setConversationId: (id: string | null) => void;
  replaceConversationId: (id: string | null) => void;
  setContextPanel: (panel: string | null) => void;
} {
  const searchParams = useSearchParams();
  const state = useMemo(() => parseUrlState(searchParams), [searchParams]);

  const setConversationId = useCallback((id: string | null) => {
    pushAgentChatConversationUrl(id);
  }, []);

  const replaceConversationId = useCallback((id: string | null) => {
    replaceAgentChatConversationUrl(id);
  }, []);

  const setContextPanel = useCallback((panel: string | null) => {
    writeAgentChatHistory({ context: panel }, "push");
  }, []);

  return {
    conversationId: state.conversation,
    contextPanel: state.context,
    setConversationId,
    replaceConversationId,
    setContextPanel,
  };
}
