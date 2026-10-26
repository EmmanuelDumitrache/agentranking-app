"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SapVerifiedBadge } from "@/components/agents/sap-verified-badge";
import {
  normalizeSapLeaderboardMode,
  type LeaderboardMode,
  type SapLeaderboardEntry,
} from "@/lib/sap-ecosystem-shared";
import { Loader2 } from "lucide-react";
import { SapShareUrlButton } from "@/components/sap/sap-share-url-button";
import { publicKeys } from "@/lib/query-keys/public";
const MODES: { id: LeaderboardMode; label: string }[] = [
  { id: "reputation", label: "Reputation" },
  { id: "volume", label: "Volume" },
  { id: "capabilities", label: "Capabilities" },
  { id: "protocols", label: "Protocols" },
  { id: "age", label: "Age" },
];
function metricCell(e: SapLeaderboardEntry, mode: LeaderboardMode): string {
  switch (mode) {
    case "reputation":
      return e.reputation != null ? String(e.reputation) : "—";
    case "volume":
      if (e.volumeUsd != null && e.volumeUsd > 0) return `$${Math.round(e.volumeUsd).toLocaleString()}`;
      if (e.txCountNumeric != null) return `${Math.round(e.txCountNumeric)} txs`;
      return "—";
    case "capabilities":
      return String(e.capabilityCount);
    case "protocols":
      return String(e.protocolCount);
    case "age":
      return e.sapRegisteredAt
        ? new Date(e.sapRegisteredAt).toISOString().slice(0, 10)
        : "—";
    default:
      return "—";
  }
}
export function SapLeaderboardClient({
  initialMode,
  initialEntries,
}: {
  readonly initialMode: LeaderboardMode;
  readonly initialEntries: SapLeaderboardEntry[];
}) {
  const [mode, setMode] = useState<LeaderboardMode>(initialMode);
  const leaderboardQuery = useQuery({
    queryKey: publicKeys.sapLeaderboard(mode),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/sap/leaderboard?mode=${encodeURIComponent(mode)}`, { signal });
      const payload = (await response.json().catch(() => ({}))) as {
        entries?: SapLeaderboardEntry[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || response.statusText);
      return payload.entries ?? [];
    },
    initialData: mode === initialMode ? initialEntries : undefined,
    refetchOnMount: false,
  });
  const entries = leaderboardQuery.data ?? [];
  const { isLoading: loading, error } = leaderboardQuery;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={mode} onValueChange={(value: string) => setMode(normalizeSapLeaderboardMode(value))} className="w-full">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
            {MODES.map((m) => (
              <TabsTrigger
                key={m.id}
                value={m.id}
                className="text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-200"
              >
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <SapShareUrlButton />
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading leaderboard…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SAP agents in the index yet.</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden md:grid md:grid-cols-[48px_1fr_120px_1fr] gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>#</span>
            <span>Agent</span>
            <span>Metric</span>
            <span>Capabilities</span>
          </div>
          {entries.map((e) => (
            <Card
              key={`${e.chainId}-${e.agentId}`}
              className="border-border/80 bg-card/50 p-3 md:grid md:grid-cols-[48px_1fr_120px_1fr] md:items-center md:gap-2"
            >
              <div className="mb-2 font-mono text-sm text-muted-foreground md:mb-0">{e.rank}</div>
              <div className="min-w-0 space-y-1">
                <Link
                  href={e.profilePath}
                  className="font-medium text-foreground hover:text-emerald-400 truncate block"
                >
                  {e.name}
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <SapVerifiedBadge sapAgentPda={e.sapAgentPda} compact />
                  <span className="text-[10px] text-muted-foreground">
                    #{e.agentId} · {e.chainId}
                  </span>
                </div>
              </div>
              <div className="mt-2 font-mono text-sm tabular-nums text-emerald-200 md:mt-0">
                {metricCell(e, mode)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1 md:mt-0">
                {e.capabilityTags.length === 0 ? (
                  <span className="text-[10px] text-muted-foreground">—</span>
                ) : (
                  e.capabilityTags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[9px] px-1.5 py-0">
                      {t.length > 20 ? `${t.slice(0, 19)}…` : t}
                    </Badge>
                  ))
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}