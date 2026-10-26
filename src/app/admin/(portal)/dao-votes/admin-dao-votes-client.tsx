"use client";
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import { useSourceDraft } from "@/hooks/use-source-draft";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { showToast } from "@/components/ui/toast-simple";
import { Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { DaoVotesAddAgent } from "./dao-votes-add-agent";
import { isAbortLike, timeoutSignal } from "@/lib/timing/abort";
export type AdminDaoVotesRow = {
  id: number;
  rank: number;
  name: string;
  image: string;
  chainId: number;
  chainName: string;
  powerScore: number;
  daoVotes: number;
  activeBoosts?: number;
  adminPowerAdjust: number;
  agentId: number;
  profilePath: string;
};
const ROWS_PAGE = 200;
const LIST_LIMIT = 500;
function listFetchTimeoutMs(): number {
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost")) {
      return 120_000;
    }
  }
  return 55_000;
}
const PATCH_TIMEOUT_MS = 120_000;
type Scope = "board" | "all";
export function AdminDaoVotesClient({ initialAgents }: { readonly initialAgents: AdminDaoVotesRow[] }) {
  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [scope, setScope] = useState<Scope>("board");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [clearingBoard, setClearingBoard] = useState(false);
  const [bulkTarget, setBulkTarget] = useState("");
  const normalizedSearch = searchApplied.trim();
  const loadList = useCallback(async (signal: AbortSignal): Promise<AdminDaoVotesRow[]> => {
    const params = new URLSearchParams();
    if (normalizedSearch) params.set("search", normalizedSearch);
    if (scope === "all") params.set("scope", "all");
    params.set("limit", String(LIST_LIMIT));
    const response = await fetch(`/api/admin/dao-votes?${params}`, {
      signal: AbortSignal.any([signal, timeoutSignal(listFetchTimeoutMs())]),
    });
    const data = (await response.json()) as {
      agents?: AdminDaoVotesRow[];
      error?: string;
      details?: string;
    };
    if (!response.ok) {
      const hint = data.details ? `${data.error ?? "Error"}: ${data.details}` : data.error;
      throw new Error(hint || "Failed to load agents");
    }
    return data.agents ?? [];
  }, [scope, normalizedSearch]);
  const listKey = `dao-votes:${scope}:${normalizedSearch}`;
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: adminKeys.daoVotes({ query: normalizedSearch, scope }),
    queryFn: ({ signal }) => loadList(signal),
    initialData: listKey === "dao-votes:board:" ? initialAgents : undefined,
    refetchOnMount: false,
  });
  const agents = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const loading = listQuery.isPending;
  const refreshList = () => queryClient.invalidateQueries({ queryKey: adminKeys.daoVotes({ query: normalizedSearch, scope }) });
  const listSourceKey = [
    scope,
    searchApplied,
    ...agents.map((agent) => `${agent.id}:${agent.daoVotes}:${agent.powerScore}`),
  ].join("|");
  const initialDrafts = Object.fromEntries(
    agents.map((agent) => [agent.id, String(Math.round(agent.daoVotes ?? agent.powerScore))]),
  ) as Record<number, string>;
  const [draftTargetPower, setDraftTargetPower] = useSourceDraft(listSourceKey, initialDrafts);
  const [visibleRowCount, setVisibleRowCount] = useSourceDraft(listSourceKey, ROWS_PAGE);
  const [selectedIds, setSelectedIds] = useSourceDraft(listSourceKey, new Set<number>());
  const visibleAgents = useMemo(
    () => agents.slice(0, visibleRowCount),
    [agents, visibleRowCount],
  );
  function applySearch() {
    setSearchApplied(searchInput);
  }
  function currentDaoVotes(a: AdminDaoVotesRow): number {
    return Math.round(a.daoVotes ?? a.powerScore);
  }
  function toggleSelect(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleSelectAllOnPage(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const a of visibleAgents) {
        if (checked) next.add(a.id);
        else next.delete(a.id);
      }
      return next;
    });
  }
  const allOnPageSelected =
    visibleAgents.length > 0 && visibleAgents.every((a) => selectedIds.has(a.id));
  async function saveRow(internalId: number, target?: number) {
    const agent = agents.find((a) => a.id === internalId);
    const raw =
      target !== undefined
        ? String(target)
        : draftTargetPower[internalId];
    const n = Number.parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      showToast("Target reputation score must be a non-negative integer", "error");
      return;
    }
    setSavingId(internalId);
    try {
      const res = await fetch(`/api/admin/dao-votes/${internalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPowerScore: n }),
        signal: timeoutSignal(PATCH_TIMEOUT_MS),
      });
      const data = (await res.json()) as { agent?: AdminDaoVotesRow; error?: string };
      if (!res.ok) {
        const msg =
          res.status === 422 && n === 0
            ? data.error ||
              "Cannot remove — agent has active boosts/perks; set a lower score instead."
            : data.error || "Could not update reputation score";
        showToast(msg, "error");
        return;
      }
      const label = agent?.name ?? "Agent";
      if (n === 0) {
        showToast(`Removed ${label} from reputation board`, "success");
      } else {
        showToast(`Reputation score set to ${n} for ${label}`, "success");
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(internalId);
        return next;
      });
      refreshList();
    } catch (e) {
      if (isAbortLike(e)) {
        showToast("Save timed out — ranks may still be updating.", "error");
      } else {
        showToast("Save failed", "error");
      }
    } finally {
      setSavingId(null);
    }
  }
  async function clearEntireBoard() {
    const ok = window.confirm(
      "Clear the entire reputation board?\n\n" +
        "This will:\n" +
        "• Set adminPowerAdjust to 0 for all agents\n" +
        "• Recompute every agent's reputation score from paid boosts + holder perks only\n" +
        "• Remove ~130k stale listings with no real reputation signals\n\n" +
        "Agents with active paid boosts or holder perks stay on the board.\n\n" +
        "This can take several minutes. Continue?",
    );
    if (!ok) return;
    setClearingBoard(true);
    try {
      const res = await fetch("/api/admin/dao-votes/clear-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "CLEAR_DAO_BOARD" }),
        credentials: "include",
        signal: timeoutSignal(300_000),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        agentsOnBoardBefore?: number;
        agentsOnBoardAfter?: number;
        error?: string;
      };
      if (!res.ok) {
        showToast(data.error || "Clear board failed", "error");
        return;
      }
      showToast(
        data.message ||
          `Board cleared: ${data.agentsOnBoardBefore} → ${data.agentsOnBoardAfter} agents`,
        "success",
      );
      setSelectedIds(new Set());
      refreshList();
    } catch (e) {
      if (isAbortLike(e)) {
        showToast("Clear board timed out — check server logs; DB may still be updating.", "error");
      } else {
        showToast("Clear board failed", "error");
      }
    } finally {
      setClearingBoard(false);
    }
  }
  async function bulkAction(action: "setTarget" | "remove") {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    let targetPowerScore = 0;
    if (action === "setTarget") {
      const n = Number.parseInt(String(bulkTarget).trim(), 10);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        showToast("Target reputation score must be a non-negative integer", "error");
        return;
      }
      targetPowerScore = n;
    }
    setBulkSaving(true);
    try {
      const res = await fetch("/api/admin/dao-votes/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action, targetPowerScore }),
        signal: timeoutSignal(PATCH_TIMEOUT_MS),
      });
      const data = (await res.json()) as {
        updated?: AdminDaoVotesRow[];
        failed?: { id: number; error: string }[];
        error?: string;
      };
      if (!res.ok) {
        showToast(data.error || "Bulk update failed", "error");
        return;
      }
      const updated = data.updated ?? [];
      const failed = data.failed ?? [];
      if (failed.length === 0) {
        if (action === "remove") {
          showToast(`Removed ${updated.length} agent(s) from reputation board`, "success");
        } else {
          showToast(`Updated ${updated.length} agent(s)`, "success");
        }
      } else {
        const first = failed[0]?.error ?? "Unknown error";
        showToast(
          `Updated ${updated.length}; ${failed.length} failed — ${first}`,
          updated.length > 0 ? "info" : "error",
        );
      }
      setSelectedIds(new Set());
      refreshList();
    } catch (e) {
      if (isAbortLike(e)) {
        showToast("Bulk update timed out", "error");
      } else {
        showToast("Bulk update failed", "error");
      }
    } finally {
      setBulkSaving(false);
    }
  }
  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reputation controls</h1>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm">
            Manage agents on the public{" "}
            <Link href="/powerboost" className="text-primary underline-offset-2 hover:underline">
              reputation board
            </Link>
            . Default view shows agents with reputation score &gt; 0. Row checkboxes only select
            the current page (up to {ROWS_PAGE} visible). To reset the whole board from stale
            scores, use <strong className="text-foreground">Clear entire board</strong> (DB
            recompute).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-2">
            <Input
              placeholder="Search by name…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              className="w-[200px]"
            />
            <Button type="button" variant="secondary" size="sm" onClick={applySearch}>
              <Search className="mr-1 size-4" />
              Search
            </Button>
          </div>
          <div className="flex rounded-md border border-border p-0.5 text-sm">
            <Button
              type="button"
              size="sm"
              variant={scope === "board" ? "secondary" : "ghost"}
              className="h-7 px-2"
              onClick={() => setScope("board")}
            >
              On reputation board
            </Button>
            <Button
              type="button"
              size="sm"
              variant={scope === "all" ? "secondary" : "ghost"}
              className="h-7 px-2"
              onClick={() => setScope("all")}
            >
              All agents
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={refreshList}
            disabled={loading}
          >
            {listQuery.error ? (
        <p className="text-sm text-destructive">{listQuery.error.message}</p>
      ) : null}
      {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
          <DaoVotesAddAgent onApplied={async () => { refreshList(); }} />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={loading || clearingBoard || bulkSaving}
            onClick={clearEntireBoard}
          >
            {clearingBoard ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
            Clear entire board
          </Button>
        </div>
      </div>
      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium">
            {selectedIds.size} selected on this page (not all {agents.length} loaded)
          </span>
          <Input
            className="h-8 w-28"
            type="text"
            inputMode="numeric"
            placeholder="Target score"
            value={bulkTarget}
            onChange={(e) => setBulkTarget(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={bulkSaving}
            onClick={() => bulkAction("setTarget")}
          >
            {bulkSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            Apply to selected
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={bulkSaving}
            onClick={() => bulkAction("remove")}
          >
            <Trash2 className="mr-1 size-4" />
            Remove selected from board
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}
      {loading && agents.length === 0 ? (
        <div className="text-muted-foreground py-8">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={(v: boolean) => toggleSelectAllOnPage(v === true)}
                    aria-label="Select all on page"
                  />
                </TableHead>
                <TableHead className="w-14">Rank</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="w-28">Chain</TableHead>
                <TableHead className="w-24 text-right">Current</TableHead>
                <TableHead className="w-36">Target</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleAgents.map((a) => {
                const current = currentDaoVotes(a);
                const draft = draftTargetPower[a.id] ?? String(current);
                const unchanged = draft === String(current);
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(a.id)}
                        onCheckedChange={(v: boolean) => toggleSelect(a.id, v === true)}
                        aria-label={`Select ${a.name}`}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {a.rank}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <AgentAvatar
                          image={a.image}
                          name={a.name}
                          size="sm"
                          className="size-8 shrink-0 rounded-full"
                        />
                        <Link
                          href={a.profilePath}
                          className="truncate font-medium hover:text-primary hover:underline"
                        >
                          {a.name}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {a.chainName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{current}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-full max-w-[7rem]"
                        type="text"
                        inputMode="numeric"
                        value={draft}
                        onChange={(e) =>
                          setDraftTargetPower((prev) => ({ ...prev, [a.id]: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={savingId === a.id || bulkSaving || unchanged}
                          onClick={() => saveRow(a.id)}
                        >
                          {savingId === a.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={savingId === a.id || bulkSaving || current === 0}
                          onClick={() => saveRow(a.id, 0)}
                          title="Remove from board"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {agents.length > visibleRowCount && (
            <div className="border-t border-border bg-muted/30 px-4 py-3 text-center">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setVisibleRowCount((c) => Math.min(c + ROWS_PAGE, agents.length))
                }
              >
                Show more ({agents.length - visibleRowCount} remaining)
              </Button>
            </div>
          )}
          {agents.length === 0 && !loading && (
            <div className="text-muted-foreground py-12 text-center">No agents match.</div>
          )}
        </div>
      )}
    </div>
  );
}
