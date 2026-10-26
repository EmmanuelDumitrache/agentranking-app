"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, Hash, Search, Sparkles, Users } from "lucide-react";
import { parseSapCapabilityId } from "@/lib/sap-ecosystem-shared";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SapShareUrlButton } from "@/components/sap/sap-share-url-button";
export type SapCapabilityIndexRow = {
  readonly capabilityId: string;
  readonly description: string;
  readonly agentCount: number;
  readonly avgPrice: number | null;
};
type SortMode = "popular" | "az";
export function SapCapabilitiesIndexClient({
  capabilities,
}: {
  readonly capabilities: SapCapabilityIndexRow[];
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("popular");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = capabilities;
    if (q) {
      rows = rows.filter((c) => {
        const parsed = parseSapCapabilityId(c.capabilityId);
        const hay = [
          c.capabilityId,
          parsed.displayName,
          parsed.namespace,
          c.description,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    const next = [...rows];
    if (sort === "az") {
      next.sort((a, b) => {
        const ta = parseSapCapabilityId(a.capabilityId).displayName.toLowerCase();
        const tb = parseSapCapabilityId(b.capabilityId).displayName.toLowerCase();
        return ta.localeCompare(tb) || a.capabilityId.localeCompare(b.capabilityId);
      });
    } else {
      next.sort((a, b) => b.agentCount - a.agentCount || a.capabilityId.localeCompare(b.capabilityId));
    }
    return next;
  }, [capabilities, query, sort]);
  return (
    <div className="mx-auto min-h-[70vh] max-w-3xl px-4 py-8 md:max-w-4xl md:px-6 md:py-12">
      <header className="mb-8 space-y-6 md:mb-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <Link
              href="/sap"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-emerald-500"
            >
              <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
              SAP ecosystem
            </Link>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-600/90 dark:text-emerald-400/90">
              Synapse Agent Protocol
            </p>
            <h1 className="text-balance text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              Find agents by capability
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              Each item is something SAP-verified agents can do on-chain — like creative tools, payments, or AI
              workflows. Pick a capability to see ranked agents, reputation, and pricing hints.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1">
                <Sparkles className="h-3 w-3 text-emerald-500" aria-hidden />
                {capabilities.length} capabilit{capabilities.length === 1 ? "y" : "ies"}
              </span>
            </div>
          </div>
          <SapShareUrlButton />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search capabilities…"
              className="h-11 rounded-xl border-border/70 bg-background pl-9 shadow-sm"
              aria-label="Search capabilities"
            />
          </div>
          <div
            className="flex shrink-0 gap-1 rounded-lg border border-border/60 bg-muted/25 p-1"
            role="group"
            aria-label="Sort capabilities"
          >
            <button
              type="button"
              onClick={() => setSort("popular")}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                sort === "popular"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Most agents
            </button>
            <button
              type="button"
              onClick={() => setSort("az")}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                sort === "az"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              A–Z
            </button>
          </div>
        </div>
        {capabilities.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            No capabilities indexed yet. Check back after the SAP indexer has synced agents.
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            No capabilities match &ldquo;{query}&rdquo;. Try a shorter search or clear the box.
          </p>
        ) : null}
      </header>
      {filtered.length > 0 ? (
        <ul className="space-y-3">
          {filtered.map((c) => {
            const href = `/sap/capabilities/${encodeURIComponent(c.capabilityId)}`;
            const parsed = parseSapCapabilityId(c.capabilityId);
            return (
              <li key={c.capabilityId}>
                <Link
                  href={href}
                  className="group flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/40 px-4 py-4 shadow-sm transition-colors hover:border-emerald-500/35 hover:bg-card/70 md:flex-row md:items-center md:justify-between md:gap-4 md:px-5 md:py-4"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold leading-snug text-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                        {parsed.displayName}
                      </h2>
                      {parsed.namespace ? (
                        <Badge variant="secondary" className="text-[10px] font-medium capitalize">
                          {parsed.namespace}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{c.description}</p>
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/90">
                      <Hash className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                      <code className="truncate font-mono">{c.capabilityId}</code>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-row items-center gap-3 md:flex-col md:items-end md:gap-2">
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                        <Users className="h-3.5 w-3.5" aria-hidden />
                        {c.agentCount} agent{c.agentCount === 1 ? "" : "s"}
                      </span>
                      {c.avgPrice != null ? (
                        <Badge variant="outline" className="text-[10px] font-normal text-violet-700 dark:text-violet-300">
                          Avg min price ~{c.avgPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Pricing varies</span>
                      )}
                    </div>
                    <span className="text-xs font-medium text-emerald-600 group-hover:underline dark:text-emerald-400">
                      View directory →
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      <footer className="mt-10 rounded-xl border border-border/50 bg-muted/15 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground/80">For builders:</strong> Data comes from indexed SAP agent
        snapshots. “Avg min price” averages each agent’s lowest parseable tier (on-chain units) — use it to compare
        agents within the same capability, not across different tokens or networks.
      </footer>
    </div>
  );
}