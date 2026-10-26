"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  agentName: string;
  status: "submitted" | "streaming" | "ready" | "error";
  onSend: (text: string) => Promise<void> | void;
  onStop: () => void;
  isPreparing: boolean;
  isDisabled: boolean;
  disabledReason?: string;
  className?: string;
}

const MAX_MESSAGE_CHARS = 32_000;

function terminalSlug(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return slug || "agent";
}

function AgentChatTerminalComposerComponent({
  agentName,
  status,
  onSend,
  onStop,
  isPreparing,
  isDisabled,
  disabledReason,
  className,
}: Props) {
  const [input, setInput] = useState("");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submissionPendingRef = useRef(false);
  const isStreaming = status === "streaming" || status === "submitted";
  const slug = terminalSlug(agentName);
  const characterLimitVisible = input.length >= MAX_MESSAGE_CHARS * 0.9;
  const statusMessage = submissionError
    ? submissionError
    : isDisabled && disabledReason
      ? disabledReason
      : isStreaming
        ? "agent is running — you can draft the next command"
        : isPreparing
          ? "preparing message"
          : null;

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      inputRef.current?.focus();
    }
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (
      !text ||
      isStreaming ||
      isPreparing ||
      submissionPendingRef.current ||
      isDisabled
    ) {
      return;
    }
    submissionPendingRef.current = true;
    setSubmissionError(null);
    try {
      await onSend(text);
      setInput("");
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch {
      setSubmissionError(
        "command was not sent — your draft is still here; try again",
      );
    } finally {
      submissionPendingRef.current = false;
    }
  }, [input, isDisabled, isPreparing, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (
        event.key === "Enter" &&
        !event.nativeEvent.isComposing &&
        !isStreaming &&
        !isPreparing &&
        !isDisabled
      ) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend, isDisabled, isPreparing, isStreaming],
  );

  const placeholder = isPreparing
    ? "preparing…"
    : isStreaming
      ? "agent running — type next command"
      : isDisabled
        ? (disabledReason ?? "unavailable")
        : "message or /command";

  return (
    <div
      className={cn(
        "ui-terminal-composer shrink-0 border-t border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 font-mono text-sm",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor="terminal-input" className="shrink-0 select-none">
          <span className="text-[#d4d4d8]">{slug}</span>
          <span className="text-[#d4d4d8]">@terminal</span>
          <span className="text-[#d4d4d8]"> $</span>
        </label>
        <input
          ref={inputRef}
          id="terminal-input"
          value={input}
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(event) => {
            setSubmissionError(null);
            setInput(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isPreparing}
          aria-label="Terminal message input"
          aria-describedby={statusMessage || characterLimitVisible ? "terminal-input-status" : undefined}
          className="min-w-0 w-full flex-1 rounded-sm bg-transparent text-[#d4d4d8] outline-none placeholder:text-[#3f3f46] focus-visible:ring-1 focus-visible:ring-[#52525b] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-60"
          autoComplete="off"
          spellCheck={false}
        />
        {isStreaming ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onStop}
            className="h-6 shrink-0 gap-1 px-2 text-[#fca5a5] hover:bg-[#1f1f1f] hover:text-[#fecaca]"
          >
            <Square aria-hidden className="size-3 fill-current" />
            stop
          </Button>
        ) : null}
      </div>
      {statusMessage || characterLimitVisible ? (
        <div
          id="terminal-input-status"
          className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[1ch] font-mono text-[11px]"
          role={submissionError ? "alert" : "status"}
          aria-live={submissionError ? "assertive" : "polite"}
        >
          {statusMessage ? (
            <span
              className={cn(
                submissionError || (isDisabled && disabledReason)
                  ? "text-[#fca5a5]"
                  : "text-[#71717a]",
              )}
            >
              {statusMessage}
            </span>
          ) : null}
          {characterLimitVisible ? (
            <span className="ml-auto shrink-0 tabular-nums text-[#71717a]">
              {input.length.toLocaleString()}/{MAX_MESSAGE_CHARS.toLocaleString()}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const AgentChatTerminalComposer = memo(AgentChatTerminalComposerComponent);
