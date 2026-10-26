"use client";

import { useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { PublicSitePanel } from "@/components/public-site/public-site-ui";
import {
  agentTalkUnavailableMessage,
  type AgentTalkTarget,
} from "@/lib/public-site/agent-talk-target";
import { cn } from "@/lib/utils";

type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
};

type Props = {
  readonly chainId: number;
  readonly agentId: number;
  readonly talk: AgentTalkTarget;
};

export function AgentTalkPanel({ chainId, agentId, talk }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = talk.status === "live" && !pending;

  async function handleSend(event?: React.FormEvent) {
    event?.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !canSend) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/agents/${chainId}/${agentId}/talk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = (await response.json()) as { ok?: boolean; reply?: string; message?: string };
      if (!response.ok || payload.ok !== true || typeof payload.reply !== "string" || !payload.reply) {
        const message =
          payload.message ?? agentTalkUnavailableMessage("endpoint_failing");
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: message,
          },
        ]);
        setError(message);
        return;
      }

      const reply = payload.reply;
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: reply,
        },
      ]);
    } catch {
      const message = agentTalkUnavailableMessage("endpoint_failing");
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: message,
        },
      ]);
      setError(message);
    } finally {
      setPending(false);
    }
  }

  const unavailableMessage =
    talk.status === "unavailable"
      ? agentTalkUnavailableMessage(talk.reason)
      : null;

  function handleToggle(event: React.ToggleEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || talk.status !== "live") return;
    requestAnimationFrame(() => {
      document.getElementById("agent-talk-input")?.focus();
    });
  }

  return (
    <PublicSitePanel>
      <details id="talk-panel" className="group" onToggle={handleToggle}>
        <summary className="cursor-pointer list-none rounded-md [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Talk
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-foreground/80">
              Talk to this agent
              <ChevronDown
                className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </span>
          </span>
        </summary>

        <div className="mt-4 space-y-4">
          <div className="min-h-[160px] rounded-xl border border-border/60 bg-muted/10 p-4">
            {messages.length === 0 ? (
              <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm text-muted-foreground">
                  {talk.status === "live"
                    ? "Start a conversation with this agent."
                    : "This agent does not expose a live talk endpoint yet."}
                </p>
                {talk.status === "live" ? null : (
                  <p className="max-w-sm text-xs text-muted-foreground">{unavailableMessage}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                      message.role === "user"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "border border-border/60 bg-card/70 text-foreground",
                    )}
                  >
                    {message.content}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSend} className="space-y-2">
            <div className="flex gap-2">
              <input
                id="agent-talk-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  talk.status === "live"
                    ? "Ask the agent anything..."
                    : "Talk unavailable for this agent"
                }
                disabled={!canSend}
                maxLength={2000}
                className="ui-input flex-1"
              />
              <button
                type="submit"
                disabled={!canSend || draft.trim().length === 0}
                className="ui-btn ui-btn-primary ui-btn-sm"
              >
                {pending ? "Sending..." : "Send"}
              </button>
            </div>
            {error ? <p className="text-xs text-muted-foreground">{error}</p> : null}
            {messages.length > 0 ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
              >
                Clear chat
              </button>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Messages go to the agent&apos;s declared HTTPS endpoint when our last health check marked it live.
            </p>
          </form>
        </div>
      </details>
    </PublicSitePanel>
  );
}
