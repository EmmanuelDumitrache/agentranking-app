"use client";

import { useMemo, useRef } from "react";
import { isToolUIPart } from "ai";
import { useReducedMotion } from "motion/react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  dedupeTerminalLogLines,
  formatTerminalLogTimestamp,
  sortTerminalLogLines,
  type TerminalLogLineDto,
} from "@/lib/agent-trading/terminal-log-shared";
import { cn } from "@/lib/utils";
import type { TerminalLocalLine } from "./terminal-commands";
import { AgentChatToolCard } from "./AgentChatToolCard";
import { isMcpInputRequiredOutput } from "./McpElicitationCard";
import type { AgentChatToolUIPart, AgentChatUIMessage } from "../shared/ui-message";
import type { McpContinuationResponse } from "../shared/contracts";
import { parseAgentChatPublicError } from "../shared/errors";

const CHANNEL_COLORS: Record<string, string> = {
  sys: "text-[#6b7280]",
  cmd: "text-[#d4d4d8]",
  exec: "text-[#fbbf24]",
  trade: "text-[#60a5fa]",
  copy: "text-[#a78bfa]",
  schedule: "text-[#f472b6]",
  wallet: "text-[#a1a1aa]",
  chat: "text-[#9ca3af]",
  err: "text-[#fca5a5]",
};

interface Props {
  lines: TerminalLogLineDto[];
  localLines?: TerminalLocalLine[];
  status: "submitted" | "streaming" | "ready" | "error";
  error?: Error;
  onRetry?: () => void;
  onAddCredits?: () => void;
  onOpenSettings?: () => void;
  onChooseModel?: () => void;
  agentName?: string;
  className?: string;
  isHydrating?: boolean;
  activityLoading?: boolean;
  activityError?: string | null;
  onRefreshActivity?: () => void;
  messages?: readonly AgentChatUIMessage[];
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

function expandLocalLines(localLines: TerminalLocalLine[]): TerminalLogLineDto[] {
  const expanded: TerminalLogLineDto[] = [];
  for (const line of localLines) {
    const channel =
      line.kind === "user"
        ? line.text.startsWith("/")
          ? "cmd"
          : "chat"
        : line.kind === "error"
          ? "err"
          : "sys";
    const rows =
      line.kind === "output" || line.kind === "error"
        ? line.text.split("\n").filter((row) => row.length > 0)
        : [line.text];
    rows.forEach((text, index) => {
      expanded.push({
        id: `${line.id}:${index}`,
        at: line.at,
        channel,
        text,
      });
    });
  }
  return expanded;
}

function collectPendingToolApprovals(
  messages: readonly AgentChatUIMessage[],
): Array<{ messageId: string; part: AgentChatToolUIPart }> {
  const pending: Array<{ messageId: string; part: AgentChatToolUIPart }> = [];

  for (const message of messages) {
    for (const part of message.parts) {
      if (
        isToolUIPart(part) &&
        (part.state === "approval-requested" ||
          isMcpInputRequiredOutput(part.output))
      ) {
        pending.push({ messageId: message.id, part });
      }
    }
  }
  return pending;
}

function TerminalWelcome({ agentName }: { agentName: string }) {
  const name = agentName.trim() || "Agent";
  return (
    <div className="ui-terminal-welcome mb-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#6b7280]">
      {`${name} activity log — UTC timestamps
/trade/copy/schedule/wallet events stream here
/help for commands · /status for wallet`}
    </div>
  );
}

function TerminalLogRow({ line }: { line: TerminalLogLineDto }) {
  const ts = formatTerminalLogTimestamp(line.at);
  const channel = line.channel.padEnd(8, " ");
  const channelColor = CHANNEL_COLORS[line.channel] ?? "text-[#9ca3af]";

  return (
    <div className="ui-terminal-log-row break-words font-mono text-[11px] leading-[1.35] tracking-tight [overflow-wrap:anywhere]">
      <span className="text-[#52525b]">{ts}  </span>
      <span className={cn("font-medium", channelColor)}>[{channel}]</span>
      <span className="text-[#d4d4d8]"> {line.text}</span>
    </div>
  );
}

export function AgentChatTerminalConversation({
  lines,
  localLines = [],
  status,
  error,
  onRetry,
  onAddCredits,
  onOpenSettings,
  onChooseModel,
  agentName = "Agent",
  className,
  isHydrating = false,
  activityLoading = false,
  activityError = null,
  onRefreshActivity,
  messages = [],
  onApprovalResponse,
  onMcpContinuation,
  mcpContinuationDisabled = false,
}: Props) {
  const stickContextRef = useRef<StickToBottomContext | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const isGenerating = status === "submitted" || status === "streaming";

  const mergedLines = useMemo(() => {
    return dedupeTerminalLogLines(
      sortTerminalLogLines([...lines, ...expandLocalLines(localLines)]),
    );
  }, [lines, localLines]);

  const pendingApprovals = useMemo(
    () => collectPendingToolApprovals(messages),
    [messages],
  );

  const isEmpty = !isHydrating && mergedLines.length === 0 && status === "ready";

  const publicError = parseAgentChatPublicError(error);
  const errorMessage = publicError?.message ?? error?.message ?? "The response failed. Please try again.";
  const errorAction = (() => {
    if (!publicError) return onRetry ? { label: "retry", onClick: onRetry } : null;
    if (publicError.action === "SELECT_MODEL" && onChooseModel) {
      return { label: "choose model", onClick: onChooseModel };
    }
    if (publicError.action === "OPEN_SETTINGS" && onOpenSettings) {
      return { label: "open settings", onClick: onOpenSettings };
    }
    if (publicError.action === "OPEN_TOP_UP" && onAddCredits) {
      return { label: "add credits", onClick: onAddCredits };
    }
    if ((publicError.action === "RETRY" || publicError.retryable) && onRetry) {
      return { label: "retry", onClick: onRetry };
    }
    return null;
  })();

  return (
    <div
      className={cn(
        "ui-terminal-conversation flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0a0a0a]",
        className,
      )}
    >
      <Conversation
        contextRef={stickContextRef}
        initial="instant"
        resize={isGenerating || shouldReduceMotion ? "instant" : "smooth"}
        className="min-h-0 flex-1 bg-[#0a0a0a]"
        aria-busy={isGenerating || isHydrating}
        aria-label="Terminal activity log"
      >
        <ConversationContent className="gap-0.5 px-3 py-2 font-mono sm:px-4">
          {isHydrating || activityLoading ? (
            <p
              className="font-mono text-[11px] text-[#6b7280]"
              role="status"
            >
              loading activity stream…
            </p>
          ) : null}

          {isEmpty ? <TerminalWelcome agentName={agentName} /> : null}

          {activityError ? (
            <div
              className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#fca5a5]"
              role="alert"
            >
              <span>activity feed: {activityError}</span>
              {onRefreshActivity ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={onRefreshActivity}
                  className="h-5 px-1.5 text-[10px]"
                >
                  retry
                </Button>
              ) : null}
            </div>
          ) : null}

          {mergedLines.map((line) => (
            <TerminalLogRow key={line.id} line={line} />
          ))}

          {status === "error" ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#fca5a5]" role="alert">
              <span>run error: {errorMessage}</span>
              {errorAction ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={errorAction.onClick}
                  className="h-5 px-1.5 text-[10px]"
                >
                  {errorAction.label}
                </Button>
              ) : null}
            </div>
          ) : null}

          {isGenerating && pendingApprovals.length === 0 ? (
            <div className="font-mono text-[11px] text-[#6b7280]">
              <Shimmer className="text-[#fbbf24]">
                {status === "submitted" ? "[run     ] executing…" : "[stream  ] receiving…"}
              </Shimmer>
            </div>
          ) : null}

          {pendingApprovals.map(({ messageId, part }) => (
            <div key={`${messageId}:${part.toolCallId}`} className="my-1">
              <AgentChatToolCard
                part={part}
                onApprovalResponse={onApprovalResponse}
                onMcpContinuation={onMcpContinuation}
                continuationDisabled={mcpContinuationDisabled}
              />
            </div>
          ))}
        </ConversationContent>
        <ConversationScrollButton className="border-[#3a3a3c] bg-[#2d2d2d] text-[#d1d1d6] hover:bg-[#3a3a3c]" />
      </Conversation>
    </div>
  );
}
