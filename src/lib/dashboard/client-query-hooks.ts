"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJsonWithQuerySignal } from "@/lib/fetch-with-query-signal";
import { dashboardKeys } from "@/lib/query-keys/dashboard";

export type AgentEvmWallet = {
  isCustodial?: boolean;
  provider?: string | null;
  address?: string | null;
  chainId?: number | null;
  status?: string;
  balance?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AgentEvmActivityItem = {
  hash: string;
  [key: string]: unknown;
};

export type AgentTransfer = {
  [key: string]: unknown;
};

function readEvmWallet(agentDbId: number, signal: AbortSignal): Promise<AgentEvmWallet> {
  return fetchJsonWithQuerySignal(
    `/api/dashboard/agents/${agentDbId}/evm-wallet`,
    signal,
  );
}

function readEvmActivity(
  agentDbId: number,
  signal: AbortSignal,
): Promise<{ items?: AgentEvmActivityItem[] }> {
  return fetchJsonWithQuerySignal(
    `/api/dashboard/agents/${agentDbId}/evm-activity`,
    signal,
  );
}

function readTransfers(
  agentDbId: number,
  params: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ items?: AgentTransfer[] }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query}` : "";
  return fetchJsonWithQuerySignal(
    `/api/dashboard/agents/${agentDbId}/transfers${suffix}`,
    signal,
  );
}

export function useAgentEvmWallet(agentDbId: number | null) {
  return useQuery({
    queryKey: dashboardKeys.evmWallet(agentDbId ?? 0),
    queryFn: ({ signal }) => readEvmWallet(agentDbId!, signal),
    enabled: agentDbId != null,
    staleTime: 30 * 1000,
  });
}

export function useAgentEvmActivity(agentDbId: number | null) {
  return useQuery({
    queryKey: dashboardKeys.evmActivity(agentDbId ?? 0),
    queryFn: ({ signal }) => readEvmActivity(agentDbId!, signal),
    enabled: agentDbId != null,
    staleTime: 15 * 1000,
  });
}

export function useAgentTransfers(
  agentDbId: number | null,
  params: Record<string, unknown> = {},
) {
  const normalized = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
  return useQuery({
    queryKey: dashboardKeys.transfers(agentDbId ?? 0, normalized),
    queryFn: ({ signal }) => readTransfers(agentDbId!, normalized, signal),
    enabled: agentDbId != null,
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
  });
}

export function useSyncAgentBalance(agentDbId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/dashboard/agents/${agentDbId}/sync-balance`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to synchronise balance");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardKeys.wallet(agentDbId ?? 0),
      });
    },
  });
}