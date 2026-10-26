"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { publicKeys } from "@/lib/query-keys/public";
import Link from "next/link";
import { ChevronDown, ChevronUp, Plus, RefreshCw } from "lucide-react";
import type { AdminMetaplexHubState } from "@/lib/admin/operations/metaplex-types";
import { cn } from "@/lib/utils";
function StatusRow({ label, ok }: { readonly label: string; readonly ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono font-medium", ok ? "text-emerald-400" : "text-amber-400")}>
        {ok ? "yes" : "no"}
      </span>
    </div>
  );
}

export function MetaplexAdminHubActions({
  initialData,
}: {
  readonly initialData?: AdminMetaplexHubState;
} = {}) {
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const adminQuery = useQuery({
    queryKey: publicKeys.metaplexAdminHub(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/admin/metaplex/hub", {
        credentials: "include",
        signal,
      });
      if (response.status === 401) {
        return { isAdmin: false, opsStatus: null, debugStats: null };
      }
      if (!response.ok) throw new Error("Could not load Metaplex admin state");
      return (await response.json()) as AdminMetaplexHubState;
    },
    initialData: initialData ?? undefined,
    refetchOnMount: false,
  });
  const isAdmin = adminQuery.data?.isAdmin ?? false;
  const opsStatus = adminQuery.data?.opsStatus ?? null;
  const debugStats = adminQuery.data?.debugStats ?? null;
  const loading = adminQuery.isPending;
  if (loading || !isAdmin) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/verified-agents#metaplex-index"
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-950/30 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-950/50 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Index Agent
        </Link>
        <Link
          href="/admin/verified-agents#metaplex-bulk-index"
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-950/20 px-3 py-2 text-xs font-semibold text-violet-100/90 hover:bg-violet-950/40 transition-colors"
        >
          Bulk Index
        </Link>
      </div>
      {opsStatus ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 font-mono text-[11px] space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Metaplex ops (admin)
          </p>
          <StatusRow label="RPC configured" ok={opsStatus.rpcConfigured} />
          <StatusRow label="Optional Helius available" ok={opsStatus.heliusFallbackConfigured} />
          <div className="pt-1 border-t border-border/40 mt-1">
            <p className="text-muted-foreground mb-0.5">Last index error</p>
            {opsStatus.lastIndexError ? (
              <p className="text-amber-300/90 break-all leading-snug">
                <RefreshCw className="inline size-3 mr-1 -mt-px" aria-hidden />
                {opsStatus.lastIndexError.assetAddress}: {opsStatus.lastIndexError.message}
              </p>
            ) : (
              <p className="text-emerald-400/90">None</p>
            )}
          </div>
        </div>
      ) : null}
      {debugStats ? (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 font-mono text-[11px]">
          <button
            type="button"
            className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            onClick={() => setDiagnosticsOpen((v) => !v)}
          >
            Diagnostics
            {diagnosticsOpen ? (
              <ChevronUp className="size-3.5" aria-hidden />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden />
            )}
          </button>
          {diagnosticsOpen ? (
            <div className="mt-2 space-y-1">
              <p>listingRegistrySource=metaplex: {debugStats.counts.listingRegistrySourceMetaplex}</p>
              <p>metaplexAssetAddress set: {debugStats.counts.metaplexAssetAddressNotNull}</p>
              <p>metaplexVerified: {debugStats.counts.metaplexVerifiedTrue}</p>
              <p>bound token mint: {debugStats.counts.metaplexAgentTokenMintNotNull}</p>
              <p>active listing where: {debugStats.counts.activeListingMetaplexWhere}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
