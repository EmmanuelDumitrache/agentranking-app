"use client";
import { AgentChatApiError, type AgentChatPublicError } from "../shared/errors";
import type {
  ModelsListResponse,
  ConversationListResponse,
  ConversationDetailResponse,
  RunStatusResponse,
  CancelRunResponse,
  CreditBalanceResponse,
} from "../shared/contracts";
import type { DepositListItem } from "@/lib/llm-credits/types";
// ── Error helpers ───────────────────────────────────────────────────────────
async function parseErrorBody(res: Response): Promise<never> {
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    // ignore parse errors
  }
  const errorObj =
    body.error && typeof body.error === "object" && body.error !== null
      ? (body.error as Record<string, unknown>)
      : undefined;
  if (errorObj && "code" in errorObj) {
    throw new AgentChatApiError(
      errorObj.code as AgentChatPublicError["code"],
      typeof errorObj.message === "string"
        ? errorObj.message
        : `Request failed: ${res.status}`,
      res.status,
      !!errorObj.retryable,
      errorObj.action as AgentChatPublicError["action"] | undefined,
      typeof body.requestId === "string" ? body.requestId : undefined,
    );
  }
  const message =
    typeof body.error === "string"
      ? body.error
      : `Request failed: ${res.status}`;
  throw new AgentChatApiError("INTERNAL", message, res.status, true);
}
async function request<T>(
  url: string,
  init?: RequestInit & { params?: Record<string, string> },
): Promise<T> {
  const { params, ...fetchInit } = init ?? {};
  const finalUrl = params
    ? `${url}?${new URLSearchParams(params).toString()}`
    : url;
  const res = await fetch(finalUrl, {
    headers: { "Content-Type": "application/json", ...fetchInit.headers },
    ...fetchInit,
  });
  if (!res.ok) {
    await parseErrorBody(res);
  }
  return res.json() as Promise<T>;
}
// ── API object ──────────────────────────────────────────────────────────────
export const agentChatApi = {
  // Models
  getModels(agentDbId: number, signal?: AbortSignal) {
    return request<ModelsListResponse>(
      `/api/dashboard/agents/${agentDbId}/chat/models`,
      { signal },
    );
  },
  // Settings
  getSettings(agentDbId: number, signal?: AbortSignal) {
    return request<{
      enabled: boolean;
      persona: string | null;
      systemInstructions: string | null;
      greeting: string | null;
    }>(`/api/dashboard/agents/${agentDbId}/chat/settings`, { signal });
  },
  updateSettings(
    agentDbId: number,
    data: {
      persona?: string | null;
      systemInstructions?: string | null;
      greeting?: string | null;
      enabled?: boolean;
    },
    signal?: AbortSignal,
  ) {
    return request<{
      enabled: boolean;
      persona: string | null;
      systemInstructions: string | null;
      greeting: string | null;
    }>(`/api/dashboard/agents/${agentDbId}/chat/settings`, {
      method: "PATCH",
      body: JSON.stringify(data),
      signal,
    });
  },
  // Conversations (threads)
  createConversation(
    agentDbId: number,
    data: { modelKey: string; titleSeed?: string },
    signal?: AbortSignal,
  ) {
    return request<ConversationDetailResponse["conversation"]>(
      `/api/dashboard/agents/${agentDbId}/chat/threads`,
      {
        method: "POST",
        body: JSON.stringify(data),
        signal,
      },
    );
  },
  getConversations(agentDbId: number, cursor?: string, signal?: AbortSignal) {
    return request<ConversationListResponse>(
      `/api/dashboard/agents/${agentDbId}/chat/threads`,
      { signal, params: cursor ? { cursor } : undefined },
    );
  },
  getConversation(
    agentDbId: number,
    conversationId: string,
    signal?: AbortSignal,
  ) {
    return request<ConversationDetailResponse>(
      `/api/dashboard/agents/${agentDbId}/chat/threads/${conversationId}`,
      { signal },
    );
  },
  getEarlierMessages(
    agentDbId: number,
    conversationId: string,
    before: number,
    signal?: AbortSignal,
  ) {
    return request<ConversationDetailResponse>(
      `/api/dashboard/agents/${agentDbId}/chat/threads/${conversationId}`,
      { signal, params: { before: String(before) } },
    );
  },
  renameConversation(
    agentDbId: number,
    conversationId: string,
    title: string,
    signal?: AbortSignal,
  ) {
    return request<{ id: string; title: string }>(
      `/api/dashboard/agents/${agentDbId}/chat/threads/${conversationId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title }),
        signal,
      },
    );
  },
  updateConversationStatus(
    agentDbId: number,
    conversationId: string,
    status: "ACTIVE" | "ARCHIVED",
    signal?: AbortSignal,
  ) {
    return request<ConversationDetailResponse["conversation"]>(
      `/api/dashboard/agents/${agentDbId}/chat/threads/${conversationId}`,
      { method: "PATCH", body: JSON.stringify({ status }), signal },
    );
  },
  deleteConversation(
    agentDbId: number,
    conversationId: string,
    signal?: AbortSignal,
  ) {
    return request<{ deleted: boolean }>(
      `/api/dashboard/agents/${agentDbId}/chat/threads/${conversationId}`,
      { method: "DELETE", signal },
    );
  },
  // Runs
  getRun(agentDbId: number, runId: string, signal?: AbortSignal) {
    return request<RunStatusResponse>(
      `/api/dashboard/agents/${agentDbId}/chat/runs/${runId}`,
      { signal },
    );
  },
  cancelRun(agentDbId: number, runId: string, signal?: AbortSignal) {
    return request<CancelRunResponse>(
      `/api/dashboard/agents/${agentDbId}/chat/runs/${runId}/cancel`,
      { method: "POST", signal },
    );
  },
  // Billing / Credits
  getBalance(signal?: AbortSignal) {
    return request<CreditBalanceResponse>(
      "/api/dashboard/credits/llm/balance",
      { method: "GET", signal },
    );
  },
  getDepositConfig(signal?: AbortSignal) {
    return request<{
      costMarginBps?: number;
      minUsdCents?: number;
      quoteTtlSeconds?: number;
      depositAsset?: string;
      solOverpayToleranceBps?: number;
      usdcOverpayToleranceBps?: number;
    }>("/api/dashboard/credits/llm/deposits/config", { signal });
  },
  createDeposit(data: { asset: string; cents: number }, signal?: AbortSignal) {
    return request<{ deposit: Record<string, unknown> }>(
      "/api/dashboard/credits/llm/deposits",
      {
        method: "POST",
        body: JSON.stringify(data),
        signal,
      },
    );
  },
  listDeposits(limit = 20, signal?: AbortSignal) {
    return request<{ deposits: DepositListItem[] }>(
      "/api/dashboard/credits/llm/deposits",
      { signal, params: { limit: String(limit) } },
    );
  },
  getDeposit(depositId: string, signal?: AbortSignal) {
    return request<{ deposit: Record<string, unknown> }>(
      `/api/dashboard/credits/llm/deposits/${depositId}`,
      { signal },
    );
  },
  syncDeposit(depositId: string, signal?: AbortSignal) {
    return request<{ ok: boolean; deposit?: Record<string, unknown> }>(
      `/api/dashboard/credits/llm/deposits/${depositId}/sync`,
      { method: "POST", signal },
    );
  },
  cancelDeposit(depositId: string, signal?: AbortSignal) {
    return request<{ deposit: DepositListItem }>(
      `/api/dashboard/credits/llm/deposits/${depositId}`,
      { method: "DELETE", signal },
    );
  },
};
