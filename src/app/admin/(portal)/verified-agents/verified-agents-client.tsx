"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  UserX,
} from "lucide-react";
import { format } from "date-fns";
import { showToast } from "@/components/ui/toast-simple";
import { useDebounce } from "@/hooks/use-debounce";
import { MetaplexBulkIndexForm } from "@/components/metaplex/metaplex-bulk-index-form";
import {
  fetchAdminVerifiedAgentDetail,
  fetchAdminVerifiedAgents,
} from "./verified-agents-api";
import { VerifiedAgentEditDialog } from "./verified-agent-edit-dialog";
import type {
  AdminVerifiedAgentListItem,
  AdminVerifiedAgentsFilter,
  AdminVerifiedAgentsListPayload,
} from "./verified-agents-types";
export function AdminVerifiedAgentsClient({
  initialQuery,
  initialData,
}: {
  readonly initialQuery: {
    filter: AdminVerifiedAgentsFilter;
    search: string;
    page: number;
  };
  readonly initialData: AdminVerifiedAgentsListPayload;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<AdminVerifiedAgentsFilter>(initialQuery.filter);
  const [searchInput, setSearchInput] = useState(initialQuery.search);
  const debouncedSearch = useDebounce(searchInput.trim(), 400);
  const [page, setPage] = useState(initialQuery.page);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [hardTarget, setHardTarget] = useState<AdminVerifiedAgentListItem | null>(null);
  const [hardConfirmName, setHardConfirmName] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importSetVerified, setImportSetVerified] = useState(false);
  const [importSetPremium, setImportSetPremium] = useState(false);
  const [metaplexAssetAddress, setMetaplexAssetAddress] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkWorking, setBulkWorking] = useState(false);
  const isInitialListQuery =
    filter === initialQuery.filter &&
    debouncedSearch === initialQuery.search &&
    page === initialQuery.page;
  const listQuery = useQuery({
    queryKey: ["admin-verified-agents", filter, debouncedSearch, page],
    queryFn: () => fetchAdminVerifiedAgents({ page, perPage: 25, filter, search: debouncedSearch }),
    initialData: isInitialListQuery ? initialData : undefined,
    staleTime: 60_000,
  });
  const detailQuery = useQuery({
    queryKey: ["admin-verified-agent", editingId],
    queryFn: () => fetchAdminVerifiedAgentDetail(editingId!),
    enabled: editingId != null,
  });
  const softDeactivate = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/verified-agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      showToast("Agent deactivated");
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Deactivate failed", "error");
    },
  });
  const hardDelete = useMutation({
    mutationFn: async ({ id, confirmName }: { id: number; confirmName: string }) => {
      const res = await fetch(`/api/admin/verified-agents/${id}?hard=1`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      setHardTarget(null);
      setHardConfirmName("");
      showToast("Custom listing deleted");
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Delete failed", "error");
    },
  });
  const syncFromChain = useMutation({
    mutationFn: async (internalId: number) => {
      const res = await fetch(`/api/admin/verified-agents/${internalId}/sync-from-registry`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Sync failed");
    },
    onSuccess: (_void, internalId) => {
      queryClient.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      queryClient.invalidateQueries({ queryKey: ["admin-verified-agent", internalId] });
      showToast("Synced from chain");
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Sync failed", "error");
    },
  });
  const tweetVerified = useMutation({
    mutationFn: async (internalId: number) => {
      const res = await fetch(`/api/admin/verified-agents/${internalId}/tweet-verified`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
        tweetId?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Tweet failed");
      if (!data.url) throw new Error("Invalid response");
      return { url: data.url, tweetId: data.tweetId ?? "" };
    },
    onSuccess: (out) => {
      window.alert(`Posted to X: ${out.url}`);
    },
    onError: (e) => {
      window.alert(e instanceof Error ? e.message : "Tweet failed");
    },
  });
  const indexMetaplexAgent = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/metaplex/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetAddress: metaplexAssetAddress.trim() }),
      });
      let data = {} as {
        error?: string;
        accepted?: boolean;
        jobId?: string | null;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        data = { error: `Bad response (${res.status})` };
      }
      if (!res.ok) {
        throw new Error(data.error || `Index failed (${res.status})`);
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      setMetaplexAssetAddress("");
      showToast(data.jobId ? "Metaplex agent indexing queued" : "Metaplex indexing already queued");
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Metaplex index failed", "error");
    },
  });
  const importFromUrl = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/verified-agents/import-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: importUrl.trim(),
          ...(importSetVerified ? { isVerified: true } : {}),
          ...(importSetPremium ? { isPremiumVerified: true } : {}),
        }),
      });
      let data = {} as { error?: string; agent?: AdminVerifiedAgentListItem };
      try {
        data = (await res.json()) as { error?: string; agent?: AdminVerifiedAgentListItem };
      } catch {
        data = { error: `Bad response (${res.status})` };
      }
      if (!res.ok) {
        throw new Error(data.error || `Import failed (${res.status})`);
      }
      if (!data.agent) throw new Error("Invalid response");
      return data.agent;
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      setImportUrl("");
      setImportSetVerified(false);
      setImportSetPremium(false);
      setEditingId(agent.id);
      showToast(`Imported “${agent.name}”. Edit dialog opened.`);
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Import failed", "error");
    },
  });
  const agents = listQuery.data?.agents ?? [];
  const totalPages = listQuery.data?.totalPages ?? 1;
  async function runBulkWorkReady(
    patch: { workReadyStatus?: string; featuredWorkReady?: boolean },
    label: string,
  ) {
    if (selectedIds.length === 0) {
      showToast("Select agents first", "error");
      return;
    }
    setBulkWorking(true);
    try {
      const res = await fetch("/api/admin/verified-agents/bulk-work-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIds: selectedIds, ...patch }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; updated?: number };
      if (!res.ok) throw new Error(data.error ?? "Bulk update failed");
      showToast(`${label}: ${data.updated ?? selectedIds.length} agent(s)`);
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ["admin-verified-agents"] });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Bulk update failed", "error");
    } finally {
      setBulkWorking(false);
    }
  }
  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? agents.map((a) => a.id) : []);
  };
  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
    );
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Verified agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search, edit flags and copy, deactivate listings, or hard-delete custom-listed rows only.
            Verified or premium rows include a <strong className="text-foreground font-medium">Tweet</strong>{" "}
            action to post the gold card + announcement to X.
          </p>
        </div>
        <Button asChild variant="default" className="shrink-0">
          <Link href="/admin/custom-listings">Create / review custom listing</Link>
        </Button>
      </div>
      <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
        <p className="text-sm font-medium">Import from profile URL</p>
        <p className="text-xs text-muted-foreground">
          Paste the Agent&apos;s complete current profile URL. It must include the chain ID, on-chain Agent ID,
          and current name-derived slug. Obsolete or incomplete URLs are rejected.{" "}
          <strong className="text-foreground/90">Solana SAP listings use chain id 900001.</strong>{" "}
          Existing records can be refreshed with          <strong>Sync from chain</strong> on a row (or in edit) after listing changes — for Solana SAP this refreshes via
          OOBE + SAP fields, not ERC-8004 JSON.
        </p>
        <p className="text-[11px] text-muted-foreground border-l-2 border-amber-500/40 pl-2">
          First import may take up to <strong className="text-foreground/90 font-medium">~2 minutes</strong>: EVM paths
          read registry + registration JSON (incl. IPFS); SAP/Solana fetches OOBE Explorer + Synapse RPC. Errors surface
          missing env, OOBE mismatches, or unreachable metadata.
        </p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:flex-wrap">
          <div className="flex-1 min-w-[min(100%,240px)] space-y-2">
            <Label htmlFor="import-url" className="sr-only">
              Profile URL
            </Label>
            <Input
              id="import-url"
              placeholder="https://…/agents/8453/123/current-agent-name"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              disabled={importFromUrl.isPending}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="import-verified"
                checked={importSetVerified}
                onCheckedChange={(c: boolean) => setImportSetVerified(c === true)}
                disabled={importFromUrl.isPending}
              />
              <Label htmlFor="import-verified" className="text-sm font-normal cursor-pointer">
                Verified
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="import-premium"
                checked={importSetPremium}
                onCheckedChange={(c: boolean) => setImportSetPremium(c === true)}
                disabled={importFromUrl.isPending}
              />
              <Label htmlFor="import-premium" className="text-sm font-normal cursor-pointer">
                Premium verified
              </Label>
            </div>
            <Button
              type="button"
              onClick={() => importFromUrl.mutate()}
              disabled={importFromUrl.isPending || !importUrl.trim()}
            >
              {importFromUrl.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                "Import"
              )}
            </Button>
          </div>
        </div>
        {importFromUrl.isError && (
          <p className="text-sm text-destructive">{(importFromUrl.error as Error).message}</p>
        )}
      </div>
      <div
        id="metaplex-index"
        className="rounded-lg border border-violet-500/25 bg-violet-950/10 p-4 space-y-3 scroll-mt-20"
      >
        <p className="text-sm font-medium">Index Metaplex agent</p>
        <p className="text-xs text-muted-foreground">
          Paste an MPL Core asset address with an AgentIdentity plugin. Standard Solana RPC
          verifies the identity and Core account; Helius or another DAS provider is optional enrichment.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-[min(100%,240px)] space-y-2">
            <Label htmlFor="metaplex-asset" className="sr-only">
              Metaplex Core asset address
            </Label>
            <Input
              id="metaplex-asset"
              placeholder="Core asset address (base58)"
              value={metaplexAssetAddress}
              onChange={(e) => setMetaplexAssetAddress(e.target.value)}
              disabled={indexMetaplexAgent.isPending}
            />
          </div>
          <Button
            type="button"
            onClick={() => indexMetaplexAgent.mutate()}
            disabled={indexMetaplexAgent.isPending || !metaplexAssetAddress.trim()}
          >
            {indexMetaplexAgent.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              "Index Metaplex Agent"
            )}
          </Button>
        </div>
        {indexMetaplexAgent.isError ? (
          <p className="text-sm text-destructive">{(indexMetaplexAgent.error as Error).message}</p>
        ) : null}
      </div>
      <MetaplexBulkIndexForm id="metaplex-bulk-index" />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex gap-2 flex-wrap">
          {(["all", "verified", "unverified"] as const).map((tab) => (
            <Button
              key={tab}
              variant={filter === tab ? "secondary" : "outline"}
              size="sm"
              onClick={() => { setFilter(tab); setPage(1); setSelectedIds([]); }}
            >
              {tab === "all" ? "All" : tab === "verified" ? "Verified" : "Unverified"}
            </Button>
          ))}
        </div>
        <Input
          placeholder="Search name, description, owner, token…"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
            setSelectedIds([]);
          }}
          className="sm:max-w-md"
        />
        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
            <span>{selectedIds.length} selected</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkWorking}
              onClick={() => void runBulkWorkReady({ workReadyStatus: "approved" }, "Work-ready")}
            >
              Mark Work Ready
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkWorking}
              onClick={() => void runBulkWorkReady({ featuredWorkReady: true }, "Featured on Jobs")}
            >
              Feature on Jobs
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
              Clear
            </Button>
          </div>
        ) : null}
      </div>
      <div className="rounded-md border overflow-x-auto">
        {listQuery.isLoading ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="size-8 animate-spin" />
          </div>
        ) : listQuery.isError ? (
          <p className="p-6 text-destructive text-sm">Failed to load agents.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={agents.length > 0 && selectedIds.length === agents.length}
                    onCheckedChange={(v: boolean) => toggleSelectAll(v === true)}
                    aria-label="Select all on page"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Chain</TableHead>
                <TableHead className="whitespace-nowrap">On-chain id</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="whitespace-nowrap">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No agents match.
                  </TableCell>
                </TableRow>
              ) : (
                agents.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.includes(a.id)}
                        onCheckedChange={(v: boolean) => toggleSelect(a.id, v === true)}
                        aria-label={`Select ${a.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium max-w-[200px]">
                      <span className="line-clamp-2">{a.name}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{a.chain.shortName}</TableCell>
                    <TableCell>{a.agentId}</TableCell>
                    <TableCell className="text-xs space-y-0.5">
                      <div>{a.isVerified ? "✓ Verified" : "—"}</div>
                      <div>{a.isPremiumVerified ? "✓ Premium" : "—"}</div>
                      <div>{a.isActive ? "Active" : "Inactive"}</div>
                      {a.isCustomListed && <div className="text-amber-600">Custom</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {format(new Date(a.createdAt), "yyyy-MM-dd")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="icon" asChild title="Public profile">
                          <a
                            href={a.profilePath}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={
                            a.agentId < 0
                              ? "Cannot sync custom listing from chain"
                              : "Refresh from chain (identity registry)"
                          }
                          disabled={
                            a.agentId < 0 ||
                            (syncFromChain.isPending && syncFromChain.variables === a.id)
                          }
                          onClick={() => syncFromChain.mutate(a.id)}
                        >
                          {syncFromChain.isPending && syncFromChain.variables === a.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <RefreshCw className="size-4" aria-hidden />
                          )}
                        </Button>
                        {(a.isVerified || a.isPremiumVerified) && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 shrink-0 gap-1.5 px-2.5 text-xs font-medium"
                            title="Post verified announcement to X (@agentranking)"
                            disabled={
                              tweetVerified.isPending && tweetVerified.variables === a.id
                            }
                            onClick={() => {
                              if (
                                !confirm(
                                  `Post verified announcement to @agentranking on X for "${a.name}"?`
                                )
                              )
                                return;
                              tweetVerified.mutate(a.id);
                            }}
                          >
                            {tweetVerified.isPending && tweetVerified.variables === a.id ? (
                              <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
                            ) : (
                              <Send className="size-3.5 shrink-0" aria-hidden />
                            )}
                            Tweet
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit"
                          onClick={() => setEditingId(a.id)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Deactivate"
                          disabled={softDeactivate.isPending || !a.isActive}
                          onClick={() => {
                            if (!confirm(`Deactivate "${a.name}"?`)) return;
                            softDeactivate.mutate(a.id);
                          }}
                        >
                          <UserX className="size-4" />
                        </Button>
                        {a.isCustomListed && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Hard delete (custom only)"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              setHardTarget(a);
                              setHardConfirmName("");
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
      <Dialog open={editingId != null} onOpenChange={(o: boolean) => !o && setEditingId(null)}>
        <DialogContent className="max-w-2xl w-[calc(100vw-1.5rem)] sm:w-full max-h-[min(92vh,900px)] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit agent</DialogTitle>
            <DialogDescription className="sr-only">
              Edit verified agent listing fields, services, and metadata.
            </DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {detailQuery.isError && (
            <p className="text-sm text-destructive">Could not load agent details.</p>
          )}
          {detailQuery.data?.agent && (
            <VerifiedAgentEditDialog
              key={detailQuery.data.agent.id}
              agent={detailQuery.data.agent}
              extras={{
                computedAgentRankScore: detailQuery.data.computedAgentRankScore,
                scoringLayerBreakdown: detailQuery.data.scoringLayerBreakdown,
                socialPresence: detailQuery.data.socialPresence,
              }}
              onClose={() => setEditingId(null)}
              onSaved={() => setEditingId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={hardTarget != null}
        onOpenChange={(o: boolean) => {
          if (!o) {
            setHardTarget(null);
            setHardConfirmName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hard delete custom listing</DialogTitle>
            <DialogDescription>
              Permanently removes this agent and related rows. Type the agent name exactly to confirm.
            </DialogDescription>
          </DialogHeader>
          {hardTarget && (
            <div className="grid gap-2 py-2">
              <Label htmlFor="hard-confirm">Agent name</Label>
              <Input
                id="hard-confirm"
                value={hardConfirmName}
                onChange={(e) => setHardConfirmName(e.target.value)}
                placeholder={hardTarget.name}
              />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setHardTarget(null);
                setHardConfirmName("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                !hardTarget ||
                hardConfirmName.trim() !== hardTarget.name.trim() ||
                hardDelete.isPending
              }
              onClick={() => {
                if (!hardTarget) return;
                hardDelete.mutate({
                  id: hardTarget.id,
                  confirmName: hardConfirmName.trim(),
                });
              }}
            >
              {hardDelete.isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete forever"}
            </Button>
          </DialogFooter>
          {hardDelete.isError && (
            <p className="text-sm text-destructive">{(hardDelete.error as Error).message}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
