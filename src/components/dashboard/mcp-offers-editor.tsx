"use client";
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Download, ExternalLink, ChevronDown, Check } from "lucide-react";
import { showToast } from "@/components/ui/toast-simple";
import { cn } from "@/lib/utils";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import {
  mcpOfferCategorySlug,
  mcpOfferMentionsX402,
  mcpOfferMethodPathSnippet,
} from "@/lib/mcp-offer-display";
type DashboardService = { id?: number; name: string; endpoint: string };
export type McpOfferRow = {
  id: number;
  title: string;
  summary: string;
  priceLabel: string;
  ctaUrl: string;
  linkedServiceId: number | null;
  sortOrder: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  linkedService: { id: number; name: string; endpoint: string } | null;
};
type Props = {
  readonly agentDbId: number;
  readonly profilePath: string;
  readonly services: DashboardService[];
  readonly apiKind?: "dashboard" | "admin";
  readonly onOffersMutated?: () => void;
  readonly initialOffers?: McpOfferRow[];
};
async function fetchMcpOffers(apiBase: string, signal?: AbortSignal): Promise<McpOfferRow[]> {
  const res = await fetch(`${apiBase}/mcp-offers`, { signal });
  const data = (await res.json()) as {
    offers?: McpOfferRow[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Failed to load");
  return data.offers ?? [];
}
export function DashboardMcpOffersEditor({
  agentDbId,
  profilePath,
  services,
  apiKind = "dashboard",
  onOffersMutated,
  initialOffers,
}: Props) {
  const apiBase =
    apiKind === "admin"
      ? `/api/admin/verified-agents/${agentDbId}`
      : `/api/dashboard/agents/${agentDbId}`;
  const queryClient = useQueryClient();
  const mcpOffersQueryKey = useMemo(
    () => [...dashboardKeys.agent(agentDbId), "mcp-offers", apiKind] as const,
    [agentDbId, apiKind],
  );
  const [busyId, setBusyId] = useState<number | "import" | "add" | "publish-all" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const offersQuery = useQuery({
    queryKey: mcpOffersQueryKey,
    queryFn: async ({ signal }) => fetchMcpOffers(apiBase, signal),
    initialData: initialOffers?.length ? initialOffers : undefined,
  });
  const offers = offersQuery.data ?? [];
  const loading = offersQuery.isPending && offers.length === 0;
  const mcpServices = services.filter((s) => s.name.trim().toUpperCase() === "MCP" && s.id != null);
  const load = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: mcpOffersQueryKey });
    setMsg(null);
  }, [queryClient, mcpOffersQueryKey]);
  const updateLocal = useCallback((id: number, patch: Partial<McpOfferRow>) => {
    queryClient.setQueryData<McpOfferRow[]>(mcpOffersQueryKey, (prev) =>
      prev?.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    );
  }, [queryClient, mcpOffersQueryKey]);
  async function addDraft() {
    setBusyId("add");
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/mcp-offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "New x402 capability",
          summary: "",
          priceLabel: "",
          ctaUrl: "",
          isPublished: false,
        }),
      });
      const data = (await res.json()) as { offer?: McpOfferRow; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add");
      await load();
      const newId = data.offer?.id ?? null;
      if (newId != null) setExpandedId(newId);
      onOffersMutated?.();
      showToast("Capability added — edit below, then publish when ready.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Failed to add";
      setMsg(m);
      showToast(m, "error");
    } finally {
      setBusyId(null);
    }
  }
  async function importFromServices() {
    setBusyId("import");
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/mcp-offers/import-from-services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { imported?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      const n = data.imported ?? 0;
      setMsg(n ? `Imported ${n} capability offer(s); published on the public profile.` : "No new MCP services to import.");
      await load();
      onOffersMutated?.();
      showToast(n ? `Imported ${n} capability offer(s) — published on the public profile.` : "No new MCP rows to import.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Import failed";
      setMsg(m);
      showToast(m, "error");
    } finally {
      setBusyId(null);
    }
  }
  async function saveOffer(row: McpOfferRow, opts?: { publish?: boolean }) {
    setBusyId(row.id);
    setMsg(null);
    try {
      const isPublished =
        apiKind === "admin" ? true : opts?.publish === true ? true : row.isPublished;
      const res = await fetch(`${apiBase}/mcp-offers/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: row.title,
          summary: row.summary,
          priceLabel: row.priceLabel,
          ctaUrl: row.ctaUrl,
          sortOrder: row.sortOrder,
          // Admin saves are authoritative for the live profile; owner dashboard uses explicit Publish.
          isPublished,
          linkedServiceId: row.linkedServiceId,
        }),
      });
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      await load();
      onOffersMutated?.();
      showToast(
        apiKind === "admin"
          ? "Capability saved — published on the public profile."
          : opts?.publish
            ? "Saved and published — visible on your agent profile."
            : "Capability saved",
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : "Save failed";
      setMsg(m);
      showToast(m, "error");
    } finally {
      setBusyId(null);
    }
  }
  async function publishOffer(id: number) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/mcp-offers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublished: true }),
      });
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) throw new Error(data.error ?? "Publish failed");
      updateLocal(id, { isPublished: true });
      await load();
      onOffersMutated?.();
      showToast("Published — visible on the live agent profile.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Publish failed";
      setMsg(m);
      showToast(m, "error");
    } finally {
      setBusyId(null);
    }
  }
  async function publishAllDrafts() {
    const drafts = offers.filter((o) => !o.isPublished);
    if (drafts.length === 0) return;
    setBusyId("publish-all");
    setMsg(null);
    try {
      for (const o of drafts) {
        const res = await fetch(`${apiBase}/mcp-offers/${o.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPublished: true }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Failed on “${o.title}”`);
      }
      await load();
      onOffersMutated?.();
      showToast(`Published ${drafts.length} capability offer(s) on the live profile.`);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Bulk publish failed";
      setMsg(m);
      showToast(m, "error");
    } finally {
      setBusyId(null);
    }
  }
  async function deleteOffer(id: number, titleHint?: string) {
    const label = titleHint?.trim() || "this capability";
    if (!confirm(`Remove ${label}? This cannot be undone.`)) return;
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch(`${apiBase}/mcp-offers/${id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      if (expandedId === id) setExpandedId(null);
      await load();
      onOffersMutated?.();
      showToast("Capability removed");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Delete failed";
      setMsg(m);
      showToast(m, "error");
    } finally {
      setBusyId(null);
    }
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
        <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden />
        Loading capabilities…
      </div>
    );
  }
  return (
    <div className="space-y-4 pt-4 border-t border-border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label className="text-sm font-medium">Published capabilities</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Connected MCP tools are already available to agent chat. Importing a capability here publishes selected metadata to the agent profile/marketplace and is not required for chat use.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
            Add agent skills, APIs, MCP servers, endpoints, and services that can appear in x402 Market.
            The current release supports discovery, documentation, and copy-call flows; direct x402 payment execution is planned.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mcpServices.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5 rounded-lg"
              disabled={busyId !== null}
              onClick={() => void importFromServices()}
            >
              {busyId === "import" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden />
              )}
              Import from MCP services
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs gap-1.5 rounded-lg"
            disabled={busyId !== null}
            onClick={() => void addDraft()}
          >
            {busyId === "add" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
            ) : (
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            Add capability
          </Button>
          {offers.some((o) => !o.isPublished) && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 text-xs gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
              disabled={busyId !== null}
              onClick={() => void publishAllDrafts()}
            >
              {busyId === "publish-all" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              Publish all drafts
            </Button>
          )}
        </div>
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      {offers.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            {offers.length} capabilit{offers.length === 1 ? "y" : "ies"} · click a row to expand
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] px-2"
            onClick={() => setExpandedId(null)}
          >
            Collapse all
          </Button>
        </div>
      )}
      {offers.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">No published capabilities yet. Connected MCP tools can still be used by agent chat; add one here only when you want to publish it to the profile/marketplace.</p>
      )}
      <div className="space-y-2.5">
        {offers.map((o) => {
          const open = expandedId === o.id;
          const linkedEp = o.linkedService?.endpoint ?? null;
          const pathSnip = mcpOfferMethodPathSnippet(o.ctaUrl, linkedEp);
          const category = mcpOfferCategorySlug(o.summary, o.title);
          const x402 = mcpOfferMentionsX402(o.ctaUrl, linkedEp);
          const busy = busyId === o.id;
          return (
            <div
              key={o.id}
              className={cn(
                "rounded-xl border border-zinc-800/85 bg-gradient-to-b from-zinc-950/70 to-zinc-950/35 ring-1 ring-white/[0.04]",
                open && "ring-primary/25 border-primary/30",
              )}
            >
              <div className="flex items-stretch gap-1 p-1.5 sm:p-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
                  onClick={() => setExpandedId(open ? null : o.id)}
                  aria-expanded={open}
                >
                  <ChevronDown
                    className={cn(
                      "mt-0.5 size-4 shrink-0 text-zinc-500 transition-transform duration-200",
                      open && "rotate-180",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-semibold text-zinc-100">
                        {o.title.trim() || "Untitled capability"}
                      </span>
                      {o.priceLabel ? (
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-400/95">
                          {o.priceLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={o.isPublished ? "default" : "secondary"}
                        className={cn(
                          "h-5 rounded-md px-1.5 text-[10px] font-medium",
                          o.isPublished
                            ? "bg-emerald-600/90 text-white hover:bg-emerald-600/90"
                            : "bg-zinc-800/90 text-zinc-300",
                        )}
                      >
                        {o.isPublished ? "Published" : "Draft"}
                      </Badge>
                      {category ? (
                        <Badge
                          variant="secondary"
                          className="h-5 rounded-md border-0 bg-zinc-800/80 px-1.5 text-[10px] text-zinc-400"
                        >
                          {category}
                        </Badge>
                      ) : null}
                      {x402 ? (
                        <Badge className="h-5 rounded-md border border-sky-500/30 bg-sky-500/15 px-1.5 text-[10px] text-sky-200">
                          x402
                        </Badge>
                      ) : null}
                      {pathSnip ? (
                        <Badge
                          variant="outline"
                          className="h-5 max-w-[min(100%,220px)] truncate rounded-md border-zinc-700/80 bg-zinc-900/50 px-1.5 font-mono text-[10px] font-normal text-zinc-400"
                          title={pathSnip}
                        >
                          {pathSnip}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 flex-col items-stretch justify-start gap-1 sm:flex-col">
                  {!o.isPublished && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-9 min-w-[4.5rem] px-2 text-[10px] font-semibold text-emerald-100 border border-emerald-500/40 bg-emerald-600/20 hover:bg-emerald-600/30"
                      title="Show on the public agent profile and marketplace surfaces"
                      disabled={busyId !== null}
                      onClick={() => void publishOffer(o.id)}
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin mx-auto" aria-hidden />
                      ) : (
                        <>
                          <Check className="size-3.5 sm:mr-1 inline" aria-hidden />
                          <span className="hidden sm:inline">Publish</span>
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-red-400/90 hover:bg-red-500/10 hover:text-red-300"
                    title="Remove capability"
                    disabled={busyId !== null}
                    onClick={() => void deleteOffer(o.id, o.title)}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" />}
                  </Button>
                </div>
              </div>
              {open && (
                <div className="space-y-3 border-t border-zinc-800/80 px-3 pb-3 pt-3 sm:px-4">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Title</Label>
                      <Input
                        value={o.title}
                        onChange={(e) => updateLocal(o.id, { title: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Price (free text)</Label>
                      <Input
                        value={o.priceLabel}
                        onChange={(e) => updateLocal(o.id, { priceLabel: e.target.value })}
                        placeholder="e.g. $0.08, Free"
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Summary / description</Label>
                    <textarea
                      value={o.summary}
                      onChange={(e) => updateLocal(o.id, { summary: e.target.value })}
                      className="w-full min-h-[72px] rounded-md border border-border bg-background text-xs px-2.5 py-2"
                      maxLength={500}
                      placeholder="Short line shown on the public card (like Xona resource copy)."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      CTA URL or route (https://… or POST /image/…)
                    </Label>
                    <Input
                      value={o.ctaUrl}
                      onChange={(e) => updateLocal(o.id, { ctaUrl: e.target.value })}
                      placeholder="https://… or POST /resource/path"
                      className="h-9 text-xs font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-end">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Linked service</Label>
                      <select
                        className="w-full h-9 rounded-md border border-border bg-background text-xs px-2"
                        value={o.linkedServiceId ?? ""}
                        onChange={(e) =>
                          updateLocal(o.id, {
                            linkedServiceId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                      >
                        <option value="">— None —</option>
                        {services
                          .filter((s) => s.id != null)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}: {s.endpoint.slice(0, 48)}
                              {s.endpoint.length > 48 ? "…" : ""}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Sort order</Label>
                      <Input
                        type="number"
                        value={o.sortOrder}
                        onChange={(e) => updateLocal(o.id, { sortOrder: Number(e.target.value) || 0 })}
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {o.isPublished ? (
                      <>
                        This capability is <strong className="text-emerald-400/90">live</strong> on your public
                        agent profile and can be surfaced in x402 Market.
                      </>
                    ) : (
                      <>
                        <strong className="text-foreground">Draft</strong> — not shown publicly until you click{" "}
                        <strong className="text-foreground">Publish capability</strong> (saves your edits and goes live).
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2 border-t border-zinc-800/60 pt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-9 gap-2 rounded-lg text-xs"
                      disabled={busyId !== null}
                      onClick={() => void saveOffer(o)}
                    >
                      {busyId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden /> : null}
                      Save changes
                    </Button>
                    {!o.isPublished && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 gap-2 rounded-lg text-xs bg-emerald-600 text-white hover:bg-emerald-600/90"
                        disabled={busyId !== null}
                        onClick={() => void saveOffer(o, { publish: true })}
                      >
                        {busyId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden /> : null}
                        Publish capability
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-lg border-red-500/35 text-xs text-red-400 hover:bg-red-500/10"
                      disabled={busyId !== null}
                      onClick={() => void deleteOffer(o.id, o.title)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                      Remove capability
                    </Button>
                    {o.isPublished && (
                      <Button asChild type="button" size="sm" variant="outline" className="h-9 rounded-lg text-xs">
                        <a
                          href={`${profilePath}#capabilities`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          Public capability page
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
