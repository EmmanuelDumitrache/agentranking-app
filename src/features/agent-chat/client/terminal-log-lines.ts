import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import type { AgentChatUIMessage } from "../shared/ui-message";
import type { TerminalLogLineDto } from "@/lib/agent-trading/terminal-log-shared";
import type { TerminalLocalLine } from "./terminal-commands";

function humanizeToolName(value: string): string {
  return value
    .replace(/^tool-/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getMessageText(message: AgentChatUIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function messageTimestamp(message: AgentChatUIMessage): string {
  if (message.metadata?.createdAt) return message.metadata.createdAt;
  return new Date().toISOString();
}

function toolStateLabel(state: string): string {
  switch (state) {
    case "output-available":
      return "done";
    case "output-error":
      return "error";
    case "input-available":
      return "running";
    case "approval-requested":
      return "awaiting approval";
    default:
      return state.replace(/-/g, " ");
  }
}

export function messagesToTerminalLogLines(
  messages: readonly AgentChatUIMessage[],
): TerminalLogLineDto[] {
  const lines: TerminalLogLineDto[] = [];

  for (const message of messages) {
    const at = messageTimestamp(message);
    if (message.role === "user") {
      const text = getMessageText(message);
      if (!text) continue;
      const channel = text.startsWith("/") ? "cmd" : "chat";
      lines.push({
        id: `msg:user:${message.id}`,
        at,
        channel,
        text: channel === "cmd" ? text : `> ${text}`,
      });
      continue;
    }

    const toolParts = message.parts.filter(isToolUIPart);

    for (const part of toolParts) {
      const toolName = humanizeToolName(getToolName(part));
      const state = toolStateLabel(part.state);
      lines.push({
        id: `msg:tool:${message.id}:${part.toolCallId}`,
        at,
        channel: part.state === "output-error" ? "err" : "exec",
        text: `${toolName} — ${state}${part.errorText ? ` (${part.errorText})` : ""}`,
      });
    }

    const text = getMessageText(message);
    if (text && toolParts.length === 0) {
      // Terminal is an activity log — skip assistant prose (old /help replies, etc.).
      continue;
    } else if (text && toolParts.length > 0) {
      const compact =
        text.length > 96 ? `${text.slice(0, 96).trimEnd()}…` : text;
      lines.push({
        id: `msg:note:${message.id}`,
        at,
        channel: "chat",
        text: compact,
      });
    }
  }

  return lines;
}

export function localLinesToTerminalLogLines(
  localLines: Array<Pick<TerminalLocalLine, "id" | "kind" | "text" | "at">>,
): TerminalLogLineDto[] {
  return localLines.map((line) => ({
    id: line.id,
    at: line.at,
    channel:
      line.kind === "user"
        ? line.text.startsWith("/")
          ? "cmd"
          : "chat"
        : line.kind === "error"
          ? "err"
          : "sys",
    text: line.text,
  }));
}

export function bootTerminalLogLine(agentName: string): TerminalLogLineDto {
  return {
    id: `boot:${Date.now()}`,
    at: new Date().toISOString(),
    channel: "sys",
    text: `${agentName.trim() || "Agent"} terminal connected — type /help`,
  };
}
