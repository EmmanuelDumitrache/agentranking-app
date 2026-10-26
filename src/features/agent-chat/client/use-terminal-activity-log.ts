"use client";

import { useQuery } from "@tanstack/react-query";
import type { TerminalLogLineDto } from "@/lib/agent-trading/terminal-log-shared";
import { dashboardKeys } from "@/lib/query-keys/dashboard";

export function useTerminalActivityLog(agentDbId: number, enabled: boolean) {
  const query = useQuery({
    queryKey: dashboardKeys.terminalLog(agentDbId),
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/dashboard/agents/${agentDbId}/trade/terminal-log`,
        { cache: "no-store", signal },
      );
      if (!response.ok) {
        throw new Error(`Activity log unavailable (${response.status})`);
      }
      const data = (await response.json()) as { lines?: TerminalLogLineDto[] };
      return data.lines ?? [];
    },
    enabled,
    staleTime: 0,
    refetchInterval: enabled ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return {
    lines: query.data ?? [],
    loading: query.isPending,
    error: query.isError ? (query.error?.message ?? "Could not load activity log") : null,
    refresh: () => void query.refetch(),
  };
}