"use client";
import { useQuery } from "@tanstack/react-query";
import type { DirectoryEcosystemStats } from "@/lib/agent-directory/types";
const ECOSYSTEM_STATS_STALE_MS = 60_000;
export function useEcosystemStats(initialData?: DirectoryEcosystemStats) {
  return useQuery<DirectoryEcosystemStats>({
    queryKey: ["directory-ecosystem-stats"],
    queryFn: async () => {
      const r = await fetch("/api/v1/stats");
      if (!r.ok) throw new Error("stats");
      const json = (await r.json()) as { data: DirectoryEcosystemStats };
      return json.data;
    },
    initialData,
    staleTime: ECOSYSTEM_STATS_STALE_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: !initialData,
  });
}
