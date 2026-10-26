import "server-only";

import { prisma } from "@/lib/db";
import { requestPublicHttp } from "@/lib/outbound-http";
import {
  agentTalkUnavailableMessage,
  resolveAgentTalkTarget,
  type AgentTalkTarget,
} from "@/lib/public-site/agent-talk-target";

const TALK_TIMEOUT_MS = 8_000;
const TALK_MAX_RESPONSE_BYTES = 32_768;
const TALK_MAX_MESSAGE_CHARS = 2_000;

const AGENT_TALK_SELECT = {
  id: true,
  chainId: true,
  agentId: true,
  services: {
    select: {
      id: true,
      name: true,
      endpoint: true,
      normalizedType: true,
      endpointKind: true,
      endpointValid: true,
    },
  },
  verificationSignals: {
    where: { signalType: { in: ["endpoint_live", "endpoint_failing"] as string[] } },
    select: {
      signalType: true,
      status: true,
      value: true,
      payloadJson: true,
      lastCheckedAt: true,
      expiresAt: true,
    },
  },
};

export type AgentTalkSendResult =
  | { readonly ok: true; readonly reply: string }
  | { readonly ok: false; readonly reason: string; readonly message: string };

function extractReplyText(payload: unknown): string | null {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["reply", "message", "response", "text", "content", "output"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const choices = record.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const message = (choices[0] as Record<string, unknown>).message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string" && content.trim()) return content.trim();
    }
  }
  return null;
}

export async function resolveAgentTalkTargetForAgent(
  chainId: number,
  agentId: number,
): Promise<AgentTalkTarget | null> {
  const agent = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: AGENT_TALK_SELECT,
  });
  if (!agent) return null;
  return resolveAgentTalkTarget(agent.services, agent.verificationSignals);
}

export async function sendAgentTalkMessage(
  chainId: number,
  agentId: number,
  message: string,
): Promise<AgentTalkSendResult> {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > TALK_MAX_MESSAGE_CHARS) {
    return {
      ok: false,
      reason: "invalid_message",
      message: agentTalkUnavailableMessage("invalid_message"),
    };
  }

  const target = await resolveAgentTalkTargetForAgent(chainId, agentId);
  if (!target || target.status !== "live") {
    const reason = target?.status === "unavailable" ? target.reason : "endpoint_not_live";
    return {
      ok: false,
      reason,
      message: agentTalkUnavailableMessage(reason),
    };
  }

  try {
    const response = await requestPublicHttp(target.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "Content-Type": "application/json",
        "User-Agent": "AgentRanking-PublicTalk/1.0",
      },
      body: JSON.stringify({ message: trimmed }),
      timeoutMs: TALK_TIMEOUT_MS,
      maxResponseBytes: TALK_MAX_RESPONSE_BYTES,
      maxRedirects: 2,
      allowHttp: false,
    });

    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        reason: "endpoint_failing",
        message: agentTalkUnavailableMessage("endpoint_failing"),
      };
    }

    const contentType = response.headers["content-type"] ?? "";
    const bodyText = response.body;
    if (!bodyText.trim()) {
      return {
        ok: false,
        reason: "endpoint_failing",
        message: agentTalkUnavailableMessage("endpoint_failing"),
      };
    }

    if (contentType.includes("json")) {
      try {
        const parsed = JSON.parse(bodyText) as unknown;
        const reply = extractReplyText(parsed);
        if (reply) return { ok: true, reply };
      } catch {
        // fall through to plain text
      }
    }

    return { ok: true, reply: bodyText.trim().slice(0, TALK_MAX_MESSAGE_CHARS) };
  } catch {
    return {
      ok: false,
      reason: "endpoint_failing",
      message: agentTalkUnavailableMessage("endpoint_failing"),
    };
  }
}
