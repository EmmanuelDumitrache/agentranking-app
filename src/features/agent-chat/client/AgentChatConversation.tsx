"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { getToolName, isDataUIPart, isTextUIPart, isToolUIPart } from "ai";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Info,
  TriangleAlert,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { AgentChatWelcome } from "./AgentChatWelcome";
import { AgentChatApiError, parseAgentChatPublicError, type AgentChatPublicError } from "../shared/errors";
import type {
  AgentChatDataParts,
  AgentChatUIMessage,
  AgentChatUIPart,
} from "../shared/ui-message";
import type { McpContinuationResponse } from "../shared/contracts";
import { AgentChatReasoningPanel } from "./AgentChatReasoningPanel";
import { AgentChatToolCard } from "./AgentChatToolCard";
interface Props {
  messages: AgentChatUIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  onRetry?: () => void;
  onAddCredits?: () => void;
  onOpenSettings?: () => void;
  onChooseModel?: () => void;
  onStartNewConversation?: () => void;
  onRefresh?: () => void;
  loadError?: Error | null;
  onRetryLoad?: () => void;
  greeting?: string | null;
  agentName?: string;
  agentImage?: string | null;
  isVerified?: boolean;
  userImage?: string | null;
  userName?: string | null;
  onSelectPrompt?: (text: string) => void;
  promptsDisabled?: boolean;
  className?: string;
  onLoadEarlier?: () => Promise<void>;
  isHydrating?: boolean;
  onApprovalResponse?: (input: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void | PromiseLike<void>;
  onMcpContinuation?: (input: {
    continuationId: string;
    responses: McpContinuationResponse[];
  }) => void | Promise<void>;
  mcpContinuationDisabled?: boolean;
}
type SourceUIPart = Extract<
  AgentChatUIPart,
  { type: "source-url" | "source-document" }
>;
type ResponseErrorAction = {
  label: string;
  onClick: () => void;
};
function readableErrorMessage(
  error: Error | undefined,
  fallback: string,
): string {
  return parseAgentChatPublicError(error)?.message ?? (error?.message?.trim() || fallback);
}
function resolvePublicErrorAction({
  publicError,
  onRetry,
  onAddCredits,
  onOpenSettings,
  onChooseModel,
  onStartNewConversation,
  onRefresh,
}: {
  publicError: AgentChatPublicError | undefined;
  onRetry?: () => void;
  onAddCredits?: () => void;
  onOpenSettings?: () => void;
  onChooseModel?: () => void;
  onStartNewConversation?: () => void;
  onRefresh?: () => void;
}): ResponseErrorAction | null {
  const error = publicError;
  if (error) {
    if ((error.action === "OPEN_TOP_UP" || error.code === "INSUFFICIENT_CREDITS") && onAddCredits) {
      return { label: "Add credits", onClick: onAddCredits };
    }
    if ((error.code === "CHAT_DISABLED" || error.action === "OPEN_SETTINGS") && onOpenSettings) {
      return { label: "Open settings", onClick: onOpenSettings };
    }
    if ((error.action === "SELECT_MODEL" || error.code === "INVALID_MODEL" || error.code === "MODEL_UNAVAILABLE" || error.code === "MODEL_CAPABILITY_MISMATCH" || error.code === "PROVIDER_QUOTA_EXHAUSTED" || error.code === "PROVIDER_PERMISSION_DENIED") && onChooseModel) {
      return { label: "Choose model", onClick: onChooseModel };
    }
    if ((error.code === "CONTEXT_TOO_LARGE" || error.code === "CONVERSATION_NOT_FOUND" || error.code === "CONVERSATION_LIMIT") && onStartNewConversation) {
      return {
        label: error.code === "CONVERSATION_LIMIT" ? "Open existing chat" : "Reset chat",
        onClick: onStartNewConversation,
      };
    }
    if ((error.action === "REFRESH" || error.code === "RUN_ALREADY_ACTIVE") && onRefresh) {
      return { label: "Refresh chat", onClick: onRefresh };
    }
    if (!error.retryable && error.action !== "RETRY") return null;
  }
  return onRetry ? { label: "Retry", onClick: onRetry } : null;
}
function resolveResponseErrorAction({
  error,
  onRetry,
  onAddCredits,
  onOpenSettings,
  onChooseModel,
  onStartNewConversation,
  onRefresh,
}: {
  error: Error | undefined;
  onRetry?: () => void;
  onAddCredits?: () => void;
  onOpenSettings?: () => void;
  onChooseModel?: () => void;
  onStartNewConversation?: () => void;
  onRefresh?: () => void;
}): ResponseErrorAction | null {
  return resolvePublicErrorAction({
    publicError: parseAgentChatPublicError(error),
    onRetry,
    onAddCredits,
    onOpenSettings,
    onChooseModel,
    onStartNewConversation,
    onRefresh,
  });
}
function ResponseErrorActionButton({
  action,
}: {
  action: ResponseErrorAction | null;
}) {
  if (!action) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={action.onClick}
      className="h-7 shrink-0"
    >
      {action.label}
    </Button>
  );
}
function getMessageText(message: AgentChatUIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("\n\n");
}

function isRenderableMessagePart(part: AgentChatUIPart): boolean {
  if (isToolUIPart(part)) return true;
  switch (part.type) {
    case "text":
    case "reasoning":
      return typeof part.text === "string" && part.text.trim().length > 0;
    case "file":
    case "source-url":
    case "source-document":
    case "data-notice":
      return true;
    // AI SDK lifecycle/control parts are intentionally invisible. Rendering a
    // bubble for these alone creates the tiny empty assistant pill visible
    // between submit and the first user-visible stream part.
    case "step-start":
    case "data-run":
      return false;
    default:
      return false;
  }
}

function hasRenderableMessageContent(message: AgentChatUIMessage): boolean {
  return message.parts.some(isRenderableMessagePart);
}
function NoticePart({ data }: { data: AgentChatDataParts["notice"] }) {
  const level = data.level;
  const Icon =
    level === "error"
      ? AlertCircle
      : level === "warning"
        ? TriangleAlert
        : Info;
  return (
    <div
      role={level === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed",
        level === "error" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        level === "warning" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        level === "info" && "bg-muted/60 text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{data.message}</span>
    </div>
  );
}
function FilePart({ part }: { part: Extract<AgentChatUIPart, { type: "file" }> }) {
  const name = part.filename || "Image attachment";
  const url = part.url;
  const mediaType = part.mediaType;
  const isImage = mediaType.startsWith("image/") && url.length > 0;
  if (!isImage) {
    return (
      <div className="rounded-lg border border-[#212121] bg-[#181818] p-2 text-xs text-neutral-300">
        {name}
      </div>
    );
  }
  return (
    <figure className="w-fit max-w-full overflow-hidden rounded-lg border border-[#212121] bg-[#181818]">
      <Image
        src={url}
        alt={name}
        width={320}
        height={240}
        unoptimized
        className="max-h-72 h-auto w-auto max-w-full object-contain"
      />
      <figcaption className="max-w-80 truncate border-t border-[#212121] px-2 py-1.5 text-[11px] text-neutral-500">
        {name}
      </figcaption>
    </figure>
  );
}
function SourcePart({ part }: { part: SourceUIPart }) {
  const title = part.title;
  const url = part.type === "source-url" ? part.url : null;
  let safeUrl: string | null = null;
  let hostname: string | null = null;
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        safeUrl = parsed.toString();
        hostname = parsed.hostname.replace(/^www\./i, "");
      }
    } catch {
      // Untrusted source URLs remain visible as text, but invalid URLs are not linked.
    }
  }
  const label = title || url || "Source";
  if (!safeUrl) {
    return (
      <div className="rounded-lg border border-[#212121] bg-[#181818] p-2 text-xs text-neutral-300">
        {label}
      </div>
    );
  }
  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg border border-[#212121] bg-[#181818] p-2 text-xs text-neutral-200 transition-colors hover:bg-[#212121] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
    >
      <ExternalLink
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate" title={label}>
        {label}
      </span>
      {hostname ? (
        <span className="hidden max-w-36 shrink-0 truncate text-[10px] text-muted-foreground sm:inline">
          {hostname}
        </span>
      ) : null}
      <span className="sr-only">Opens in a new tab</span>
    </a>
  );
}
interface PartRendererProps {
  part: AgentChatUIPart;
  isStreaming: boolean;
  onApprovalResponse?: (input: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void | PromiseLike<void>;
  onMcpContinuation?: (input: {
    continuationId: string;
    responses: McpContinuationResponse[];
  }) => void | Promise<void>;
  mcpContinuationDisabled?: boolean;
}
function SourcesGroup({ parts }: { parts: readonly SourceUIPart[] }) {
  if (parts.length === 1) return <SourcePart part={parts[0]} />;
  return (
    <details className="group/sources overflow-hidden rounded-lg border border-[#212121] bg-[#141414]">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-xs text-neutral-300 outline-none hover:bg-[#181818] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500 [&::-webkit-details-marker]:hidden">
        <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">Sources</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {parts.length}
        </span>
        <ChevronDown
          aria-hidden
          className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none group-open/sources:rotate-180"
        />
      </summary>
      <div className="space-y-1.5 border-t border-[#212121] p-2">
        {parts.map((part, index) => (
          <SourcePart
            key={`${part.type}:${part.type === "source-url" ? part.url : part.sourceId}:${index}`}
            part={part}
          />
        ))}
      </div>
    </details>
  );
}

function getStablePartKey(part: AgentChatUIPart, index: number): string {
  if (isToolUIPart(part)) {
    return `tool:${part.toolCallId}`;
  }
  if (part.type === "file") {
    return `file:${part.url || part.filename || index}`;
  }
  if (part.type === "source-url" || part.type === "source-document") {
    return `source:${part.sourceId}`;
  }
  return `${part.type}:${index}`;
}

type RenderablePartEntry =
  | {
      kind: "part";
      part: AgentChatUIPart;
      sourceIndex: number;
      key: string;
    }
  | {
      kind: "reasoning";
      text: string;
      sourceIndex: number;
      key: string;
    }
  | {
      kind: "sources";
      parts: SourceUIPart[];
      sourceIndex: number;
      key: string;
    };

function buildRenderablePartEntries(
  parts: readonly AgentChatUIPart[],
): RenderablePartEntry[] {
  const entries: RenderablePartEntry[] = [];
  let index = 0;
  while (index < parts.length) {
    const part = parts[index];
    if (part.type === "step-start" || part.type === "data-run") {
      index += 1;
      continue;
    }
    if (part.type === "source-url" || part.type === "source-document") {
      const firstIndex = index;
      const sources: SourceUIPart[] = [];
      let lastSourceIndex = index;
      while (index < parts.length) {
        const candidate = parts[index];
        if (candidate.type === "source-url" || candidate.type === "source-document") {
          sources.push(candidate);
          lastSourceIndex = index;
          index += 1;
          continue;
        }
        if (candidate.type === "step-start" || candidate.type === "data-run") {
          index += 1;
          continue;
        }
        break;
      }
      entries.push({
        kind: "sources",
        parts: sources,
        sourceIndex: lastSourceIndex,
        key: `sources:${firstIndex}`,
      });
      continue;
    }
    if (part.type !== "reasoning") {
      entries.push({
        kind: "part",
        part,
        sourceIndex: index,
        key: getStablePartKey(part, index),
      });
      index += 1;
      continue;
    }

    const firstIndex = index;
    const reasoning: string[] = [];
    let lastReasoningIndex = index;
    while (index < parts.length) {
      const candidate = parts[index];
      if (candidate.type === "reasoning") {
        if (typeof candidate.text === "string" && candidate.text.trim()) {
          reasoning.push(candidate.text);
        }
        lastReasoningIndex = index;
        index += 1;
        continue;
      }
      if (candidate.type === "step-start" || candidate.type === "data-run") {
        index += 1;
        continue;
      }
      break;
    }
    if (reasoning.length > 0) {
      entries.push({
        kind: "reasoning",
        text: reasoning.join("\n\n"),
        sourceIndex: lastReasoningIndex,
        key: `reasoning:${firstIndex}`,
      });
    }
  }
  return entries;
}
const TERMINAL_TOOL_STATES = new Set([
  "output-available",
  "output-denied",
  "output-error",
]);
function partRendererPropsEqual(
  previous: PartRendererProps,
  next: PartRendererProps,
): boolean {
  if (previous.isStreaming !== next.isStreaming) return false;
  if (previous.onApprovalResponse !== next.onApprovalResponse) return false;
  if (previous.onMcpContinuation !== next.onMcpContinuation) return false;
  if (previous.mcpContinuationDisabled !== next.mcpContinuationDisabled) return false;
  const left = previous.part;
  const right = next.part;
  if (left === right) return true;
  if (left.type !== right.type) return false;
  if (isToolUIPart(left) && isToolUIPart(right)) {
    return (
      left.toolCallId === right.toolCallId &&
      left.state === right.state &&
      getToolName(left) === getToolName(right) &&
      left.errorText === right.errorText &&
      left.output === right.output &&
      TERMINAL_TOOL_STATES.has(left.state)
    );
  }
  switch (left.type) {
    case "text":
      return right.type === "text" && left.text === right.text;
    case "reasoning":
      return right.type === "reasoning" && left.text === right.text;
    case "step-start":
      return right.type === "step-start";
    case "data-run":
      return right.type === "data-run";
    case "file":
      return (
        right.type === "file" &&
        left.url === right.url &&
        left.mediaType === right.mediaType &&
        left.filename === right.filename
      );
    case "source-url":
      return (
        right.type === "source-url" &&
        left.title === right.title &&
        left.url === right.url
      );
    case "source-document":
      return (
        right.type === "source-document" &&
        left.sourceId === right.sourceId &&
        left.title === right.title &&
        left.filename === right.filename
      );
    case "data-notice":
      return (
        right.type === "data-notice" &&
        left.data.level === right.data.level &&
        left.data.message === right.data.message
      );
    default:
      return isDataUIPart(left);
  }
}

const PartRenderer = memo(function PartRenderer({
  part,
  isStreaming,
  onApprovalResponse,
  onMcpContinuation,
  mcpContinuationDisabled,
}: PartRendererProps) {
  switch (part.type) {
    case "text":
      return typeof part.text === "string" ? (
        <MessageResponse isAnimating={isStreaming}>{part.text}</MessageResponse>
      ) : null;
    case "reasoning":
      return typeof part.text === "string" ? (
        <AgentChatReasoningPanel text={part.text} isStreaming={isStreaming} />
      ) : null;
    case "step-start":
    case "data-run":
      return null;
    case "file":
      return <FilePart part={part} />;
    case "data-notice":
      return <NoticePart data={part.data} />;
    case "source-url":
    case "source-document":
      return <SourcePart part={part} />;
    default:
      if (isDataUIPart(part)) return null;
      if (isToolUIPart(part)) {
        return (
          <AgentChatToolCard
            part={part}
            onApprovalResponse={onApprovalResponse}
            onMcpContinuation={onMcpContinuation}
            continuationDisabled={mcpContinuationDisabled}
          />
        );
      }
      return null;
  }
}, partRendererPropsEqual);
function MessageCopyAction({ message }: { message: AgentChatUIMessage }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const timeoutRef = useRef<number | null>(null);
  const text = useMemo(() => getMessageText(message), [message]);
  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );
  const resetCopyStateLater = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setCopyState("idle"), 1_800);
  }, []);
  const handleCopy = useCallback(async () => {
    if (!text) return;
    if (!navigator.clipboard?.writeText) {
      setCopyState("failed");
      resetCopyStateLater();
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    resetCopyStateLater();
  }, [resetCopyStateLater, text]);
  if (!text) return null;
  const feedback =
    copyState === "copied"
      ? "Copied"
      : copyState === "failed"
        ? "Copy failed"
        : "Copy message";
  return (
    <>
      <MessageAction
        tooltip={feedback}
        label={feedback}
        onClick={() => void handleCopy()}
      >
        {copyState === "copied" ? (
          <Check aria-hidden className="size-3.5" />
        ) : copyState === "failed" ? (
          <AlertCircle aria-hidden className="size-3.5" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
      </MessageAction>
      <span className="sr-only" role="status" aria-live="polite">
        {copyState === "copied"
          ? "Message copied to clipboard"
          : copyState === "failed"
            ? "Message could not be copied"
            : ""}
      </span>
    </>
  );
}
interface ChatMessageItemProps {
  message: AgentChatUIMessage;
  isStreaming: boolean;
  paintOptimized?: boolean;
  agentImage?: string | null;
  agentName?: string;
  userImage?: string | null;
  userName?: string | null;
  onApprovalResponse?: (input: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void | PromiseLike<void>;
  onMcpContinuation?: (input: {
    continuationId: string;
    responses: McpContinuationResponse[];
  }) => void | Promise<void>;
  mcpContinuationDisabled?: boolean;
  onRetry?: () => void;
  onAddCredits?: () => void;
  onOpenSettings?: () => void;
  onChooseModel?: () => void;
  onStartNewConversation?: () => void;
  onRefresh?: () => void;
  responseFailed?: boolean;
  responseError?: AgentChatPublicError;
  responseErrorMessage?: string;
  showThinking?: boolean;
}
const ChatMessageItem = memo(
  function ChatMessageItem({
    message,
    isStreaming,
    paintOptimized = false,
    agentImage,
    agentName,
    userImage,
    userName,
    onApprovalResponse,
    onMcpContinuation,
    mcpContinuationDisabled,
    onRetry,
    onAddCredits,
    onOpenSettings,
    onChooseModel,
    onStartNewConversation,
    onRefresh,
    responseFailed = false,
    responseError,
    responseErrorMessage,
    showThinking = false,
  }: ChatMessageItemProps) {
    const meta = message.metadata;
    const isCancelled = responseError?.code === "REQUEST_CANCELLED";
    const failedAction = responseFailed && !isCancelled
      ? resolvePublicErrorAction({
          publicError: responseError,
          onRetry,
          onAddCredits,
          onOpenSettings,
          onChooseModel,
          onStartNewConversation,
          onRefresh,
        })
      : null;
    const parts = useMemo(() => message.parts ?? [], [message.parts]);
    const renderableParts = useMemo(
      () => buildRenderablePartEntries(parts),
      [parts],
    );
    const lastTextIndex = isStreaming
      ? parts.findLastIndex((part) => part.type === "text")
      : -1;
    const lastReasoningIndex = isStreaming
      ? parts.findLastIndex((part) => part.type === "reasoning")
      : -1;
    const hasCopyableText = parts.some(
      (part) => part.type === "text" && typeof part.text === "string" && part.text.trim(),
    );
    const isUser = message.role === "user";
    return (
      <div
        className={cn(
          "flex w-full",
          isUser ? "justify-end" : "justify-start",
          paintOptimized &&
            "[content-visibility:auto] [contain-intrinsic-size:0_6rem]",
        )}
      >
        <Message
          from={message.role}
          role="article"
          aria-label={isUser ? "Your message" : `${agentName ?? "Agent"} message`}
        >
          <AgentAvatar
            image={isUser ? userImage : agentImage}
            name={isUser ? (userName ?? "You") : (agentName ?? "Agent")}
            size="sm"
            decorative
            className="size-8 shrink-0 self-start rounded-md"
          />
          <div className="flex min-w-0 max-w-[min(100%,40rem)] flex-col gap-1">
            <MessageContent
              className={cn(
                "!border-[#212121] !backdrop-blur-none",
                isUser ? "!bg-[#212121]" : "!bg-[#181818]",
              )}
            >
              {showThinking ? <Shimmer>Thinking...</Shimmer> : null}
              {renderableParts.map((entry) => {
                if (entry.kind === "sources") {
                  return <SourcesGroup key={entry.key} parts={entry.parts} />;
                }
                if (entry.kind === "reasoning") {
                  return (
                    <AgentChatReasoningPanel
                      key={entry.key}
                      text={entry.text}
                      isStreaming={
                        isStreaming && entry.sourceIndex === lastReasoningIndex
                      }
                    />
                  );
                }
                const { part, sourceIndex: index } = entry;
                const partIsStreaming =
                  isStreaming &&
                  part.type === "text" &&
                  index === lastTextIndex;
                return (
                  <PartRenderer
                    key={entry.key}
                    part={part}
                    isStreaming={partIsStreaming}
                    onApprovalResponse={onApprovalResponse}
                    onMcpContinuation={onMcpContinuation}
                    mcpContinuationDisabled={mcpContinuationDisabled}
                  />
                );
              })}
              {!isUser && meta?.fallbackUsed && !isStreaming ? (
                <div
                  className="mt-1 rounded-md bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground"
                  role="status"
                >
                  The selected model could not complete this request, so a compatible fallback model completed it.
                </div>
              ) : null}
              {responseFailed && (
                <div
                  className="mt-1 flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground"
                  role="alert"
                >
                  <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0" />
                  <span className="min-w-0 flex-1">
                    {isCancelled
                      ? "Response cancelled"
                      : (responseErrorMessage
                          ?? responseError?.message
                          ?? "Response failed")}
                  </span>
                  {!isCancelled ? (
                    <ResponseErrorActionButton action={failedAction} />
                  ) : null}
                </div>
              )}
            </MessageContent>
            {hasCopyableText ? (
              <MessageActions
                className={cn(
                  "ui-chat-message-actions opacity-100 transition-opacity motion-reduce:transition-none",
                  isUser && "justify-end",
                )}
              >
                <MessageCopyAction message={message} />
              </MessageActions>
            ) : null}
          </div>
        </Message>
      </div>
    );
  },
  (previous, next) =>
    previous.message === next.message &&
    previous.isStreaming === next.isStreaming &&
    previous.paintOptimized === next.paintOptimized &&
    previous.agentImage === next.agentImage &&
    previous.agentName === next.agentName &&
    previous.userImage === next.userImage &&
    previous.userName === next.userName &&
    previous.onApprovalResponse === next.onApprovalResponse &&
    previous.onMcpContinuation === next.onMcpContinuation &&
    previous.mcpContinuationDisabled === next.mcpContinuationDisabled &&
    previous.onRetry === next.onRetry &&
    previous.onAddCredits === next.onAddCredits &&
    previous.onOpenSettings === next.onOpenSettings &&
    previous.onChooseModel === next.onChooseModel &&
    previous.onStartNewConversation === next.onStartNewConversation &&
    previous.onRefresh === next.onRefresh &&
    previous.responseFailed === next.responseFailed &&
    previous.responseError === next.responseError &&
    previous.responseErrorMessage === next.responseErrorMessage &&
    previous.showThinking === next.showThinking,
);
export function AgentChatConversation({
  messages,
  status,
  error,
  onRetry,
  onAddCredits,
  onOpenSettings,
  onChooseModel,
  onStartNewConversation,
  onRefresh,
  loadError,
  onRetryLoad,
  greeting,
  agentName,
  agentImage,
  isVerified = false,
  userImage,
  userName,
  onSelectPrompt,
  promptsDisabled = false,
  className,
  onLoadEarlier,
  isHydrating = false,
  onApprovalResponse,
  onMcpContinuation,
  mcpContinuationDisabled = false,
}: Props) {
  const stickContextRef = useRef<StickToBottomContext | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const handleLoadEarlier = useCallback(async () => {
    if (!onLoadEarlier || isLoadingEarlier) return;
    const scrollElement = stickContextRef.current?.scrollRef.current;
    const previousHeight = scrollElement?.scrollHeight ?? 0;
    const previousTop = scrollElement?.scrollTop ?? 0;
    setHistoryError(null);
    setIsLoadingEarlier(true);
    try {
      await onLoadEarlier();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!scrollElement) return;
          scrollElement.scrollTop =
            previousTop +
            Math.max(0, scrollElement.scrollHeight - previousHeight);
        });
      });
    } catch (loadError) {
      setHistoryError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load earlier messages.",
      );
    } finally {
      setIsLoadingEarlier(false);
    }
  }, [isLoadingEarlier, onLoadEarlier]);
  const isInitialLoading = isHydrating;
  const hasLoadError =
    !isInitialLoading && messages.length === 0 && !!loadError;
  const isEmpty =
    !isInitialLoading &&
    !hasLoadError &&
    messages.length === 0 &&
    status === "ready";
  const isError =
    !hasLoadError && status === "error" && messages.length === 0 && !!error;
  const isGenerating = status === "submitted" || status === "streaming";
  const isActivelyStreaming = status === "streaming";
  const loadErrorMessage = readableErrorMessage(
    loadError ?? undefined,
    "Conversation history is temporarily unavailable.",
  );
  const loadErrorAction = resolveResponseErrorAction({
    error: loadError ?? undefined,
    onRetry: onRetryLoad,
    onStartNewConversation,
    onRefresh,
  });
  const loadRequestId =
    loadError instanceof AgentChatApiError ? loadError.requestId : undefined;
  const responseErrorMessage = readableErrorMessage(
    error,
    "The response failed. Please try again.",
  );
  const responsePublicError = parseAgentChatPublicError(error);
  const responseErrorAction = resolveResponseErrorAction({
    error,
    onRetry,
    onAddCredits,
    onOpenSettings,
    onChooseModel,
    onStartNewConversation,
    onRefresh,
  });
  const responseRequestId =
    error instanceof AgentChatApiError ? error.requestId : undefined;
  const lastMessage = messages.at(-1);
  const inFlightAssistantId =
    isGenerating &&
    lastMessage?.role === "assistant" &&
    (status === "streaming" || !lastMessage.metadata?.completedAt)
      ? lastMessage.id
      : null;
  const failedAssistantId =
    status === "error" && messages.at(-1)?.role === "assistant"
      ? messages.at(-1)?.id ?? null
      : null;
  return (
    <div
      className={cn(
        "ui-chat-conversation flex h-full min-h-0 flex-col overflow-hidden !bg-[#0f0f0f] text-neutral-100",
        className,
      )}
    >
      <Conversation
        contextRef={stickContextRef}
        initial="instant"
        resize={isGenerating || shouldReduceMotion ? "instant" : "smooth"}
        className="min-h-0 flex-1 !bg-[#0f0f0f]"
        aria-busy={isGenerating || isInitialLoading}
        aria-label="Agent conversation"
      >
        <ConversationContent className="mx-auto w-full max-w-4xl gap-5 !bg-[#0f0f0f] px-3 py-4 sm:px-6 sm:py-6">
          {onLoadEarlier && messages.length > 0 && !isGenerating && (
            <div className="flex flex-col items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isLoadingEarlier}
                onClick={() => void handleLoadEarlier()}
              >
                {isLoadingEarlier
                  ? "Loading earlier messages…"
                  : "Load earlier messages"}
              </Button>
              {historyError && (
                <p
                  className="max-w-md text-center text-xs text-destructive"
                  role="alert"
                >
                  {historyError}
                </p>
              )}
            </div>
          )}
          {isInitialLoading && (
            <div
              className="space-y-5 py-3"
              aria-label="Loading conversation"
              role="status"
            >
              <Skeleton className="h-16 w-3/4 rounded-lg" />
              <Skeleton className="ml-auto h-16 w-1/2 rounded-lg" />
              <Skeleton className="h-28 w-2/3 rounded-lg" />
            </div>
          )}
          {hasLoadError && (
            <div
              className="flex min-h-[45dvh] flex-col items-center justify-center gap-3 px-4 py-12 text-center"
              role="alert"
            >
              <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle aria-hidden className="size-6 text-destructive" />
              </div>
              <div className="max-w-md space-y-1.5">
                <p className="font-medium">Could not load this conversation</p>
                <p className="text-sm text-muted-foreground">
                  {loadErrorMessage}
                </p>
              </div>
              <ResponseErrorActionButton action={loadErrorAction} />
              {loadRequestId && (
                <p className="text-[11px] text-muted-foreground">
                  Request reference: {loadRequestId}
                </p>
              )}
            </div>
          )}
          {isEmpty && (
            <AgentChatWelcome
              agentName={agentName || "Agent"}
              agentImage={agentImage}
              isVerified={isVerified}
              greeting={greeting}
              disabled={promptsDisabled || !onSelectPrompt}
              onSelectPrompt={(text) => onSelectPrompt?.(text)}
            />
          )}
          {isError && (
            <div
              className="flex min-h-[45dvh] flex-col items-center justify-center gap-3 px-4 py-12 text-center"
              role="alert"
            >
              <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle aria-hidden className="size-6 text-destructive" />
              </div>
              <div className="max-w-md space-y-1.5">
                <p className="font-medium">Response failed</p>
                <p className="text-sm text-muted-foreground">
                  {responseErrorMessage}
                </p>
              </div>
              <ResponseErrorActionButton action={responseErrorAction} />
              {responseRequestId && (
                <p className="text-[11px] text-muted-foreground">
                  Request reference: {responseRequestId}
                </p>
              )}
            </div>
          )}
          {!isInitialLoading &&
            messages.map((message, messageIndex) => {
              const paintOptimized =
                messages.length > 6 && messageIndex < messages.length - 3;
              const renderable = hasRenderableMessageContent(message);
              const showThinking =
                isGenerating &&
                message.id === inFlightAssistantId &&
                !renderable;
              const responseFailed = message.id === failedAssistantId;
              // Completed/control-only assistant messages have no user-visible
              // content and should not reserve an avatar/bubble row. During an
              // active run the same shell becomes the single Thinking row.
              if (
                message.role === "assistant" &&
                !renderable &&
                !showThinking &&
                !responseFailed
              ) {
                return null;
              }
              return (
                <ChatMessageItem
                  key={message.id}
                  message={message}
                  isStreaming={
                    isActivelyStreaming && message.id === inFlightAssistantId
                  }
                  paintOptimized={paintOptimized}
                  agentImage={agentImage}
                  agentName={agentName}
                  userImage={userImage}
                  userName={userName}
                  onApprovalResponse={onApprovalResponse}
                  onMcpContinuation={onMcpContinuation}
                  mcpContinuationDisabled={mcpContinuationDisabled}
                  onRetry={onRetry}
                  onAddCredits={onAddCredits}
                  onOpenSettings={onOpenSettings}
                  onChooseModel={onChooseModel}
                  onStartNewConversation={onStartNewConversation}
                  onRefresh={onRefresh}
                  responseFailed={responseFailed}
                  responseError={
                    responseFailed ? responsePublicError : undefined
                  }
                  responseErrorMessage={
                    responseFailed ? responseErrorMessage : undefined
                  }
                  showThinking={showThinking}
                />
              );
            })}
          {isGenerating &&
            !inFlightAssistantId &&
            !isInitialLoading &&
            !hasLoadError && (
              <div className="flex w-full justify-start">
                <Message from="assistant" aria-label="Agent is thinking">
                  <AgentAvatar
                    image={agentImage}
                    name={agentName ?? "Agent"}
                    size="sm"
                    decorative
                    className="size-8 shrink-0 self-start rounded-md"
                  />
                  <MessageContent className="!border-[#212121] !bg-[#181818] !backdrop-blur-none">
                    <Shimmer>Thinking...</Shimmer>
                  </MessageContent>
                </Message>
              </div>
            )}
          {status === "error" && messages.length > 0 && !isError && !failedAssistantId && (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                {responseErrorMessage}
                {responseRequestId && (
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Request reference: {responseRequestId}
                  </span>
                )}
              </span>
              <ResponseErrorActionButton action={responseErrorAction} />
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton
          aria-label="Scroll to latest message"
          className="bottom-3 z-20 border-[#212121] bg-[#181818] text-neutral-300 shadow-md hover:bg-[#212121] hover:text-white"
        />
      </Conversation>
    </div>
  );
}
