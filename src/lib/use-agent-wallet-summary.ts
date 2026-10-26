"use client";
/**
 * Shared hook for an agent's multi-chain wallet summary.
 * Server-seeded state is authoritative on mount; balance synchronisation is
 * performed only by the explicit refresh action.
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentWalletSummary } from "@/lib/agent-wallet-summary.server";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
export type UseAgentWalletSummaryOptions = {
  /** Authoritative route-level snapshot for the selected agent. */
  initialData: AgentWalletSummary;
};
export type UseAgentWalletSummaryReturn = {
  summary: AgentWalletSummary | null;
  loading: boolean;
  error: string | null;
  /** Explicitly synchronise live balances, then reload the summary. */
  refresh: () => Promise<void>;
  /** Reload after an explicit wallet-setup mutation. */
  refreshAfterSetup: () => Promise<void>;
};
async function readSummary(
  agentId: number,
  signal: AbortSignal,
): Promise<AgentWalletSummary> {
  const response = await fetch(`/api/dashboard/agents/${agentId}/wallets/summary`, {
    signal,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error || "Failed to load wallet summary");
  }
  const payload: unknown = await response.json();
  const summary =
    payload !== null && typeof payload === "object" && "summary" in payload
      ? (payload as { summary?: AgentWalletSummary }).summary ?? null
      : (payload as AgentWalletSummary | null);
  if (!summary || summary.agentId !== agentId) {
    throw new Error("Wallet summary did not match the selected agent");
  }
  return summary;
}
export function useAgentWalletSummary(
  agentDbId: number | null,
  options: UseAgentWalletSummaryOptions,
): UseAgentWalletSummaryReturn {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: dashboardKeys.walletSummary(agentDbId ?? 0),
    queryFn: ({ signal }) => readSummary(agentDbId!, signal),
    enabled: agentDbId != null,
    initialData:
      options.initialData.agentId === agentDbId
        ? options.initialData
        : undefined,
    refetchOnMount: false,
  });
  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/dashboard/agents/${agentDbId}/sync-balance`,
        { method: "POST" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Failed to synchronise wallet balance");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardKeys.wallet(agentDbId ?? 0),
      });
    },
  });
  const refresh = useCallback(async () => {
    if (agentDbId == null) return;
    await syncMutation.mutateAsync();
  }, [agentDbId, syncMutation]);
  const refreshAfterSetup = useCallback(async () => {
    if (agentDbId == null) return;
    await queryClient.invalidateQueries({
      queryKey: dashboardKeys.walletSummary(agentDbId),
    });
  }, [agentDbId, queryClient]);
  const error = query.error?.message ?? syncMutation.error?.message ?? null;
  return {
    summary: query.data ?? null,
    loading: query.isPending || syncMutation.isPending,
    error,
    refresh,
    refreshAfterSetup,
  };
}