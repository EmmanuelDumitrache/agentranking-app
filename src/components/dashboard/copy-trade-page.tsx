"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Pause, Pencil, Play, Plus, Search, Trash2, Trophy, Users } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast-simple";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { CopyTradeLeaderboardCard } from "@/components/dashboard/copy-trade-leaderboard-card";
import {
  CopyTradeSetupDialog,
  type CopyTradeSetupDraft,
} from "@/components/dashboard/copy-trade-setup-dialog";
import type {
  CopyTradeConfigRow,
  DashboardCopyTradePageData,
} from "@/lib/agent-trading/copy-trade-page.server";
import type { CopyLeaderboardTrader } from "@/lib/agent-trading/copy-trade/types";
import { PERPSO_LEADERBOARD_PAGE_SIZE } from "@/lib/agent-trading/perpso/urls";
import type { AgentTradeRow } from "@/lib/agent-trading/trade-page.server";
import { cn } from "@/lib/utils";

type Props = {
  initialData: DashboardCopyTradePageData;
};

type TabId = "leaderboard" | "subscriptions" | "history";

const COPY_TRADE_TABS: Array<{
  id: TabId;
  label: string;
  icon: typeof Trophy;
}> = [
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "subscriptions", label: "Subscriptions", icon: Users },
  { id: "history", label: "Trade history", icon: History },
];

function shortenWallet(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function TradeHistoryTable({ trades }: { trades: readonly AgentTradeRow[] }) {
  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-[#212121] px-4 py-6 text-center text-sm text-muted-foreground">
        No executed trades yet. Once the copy-trade worker is running, mirrored swaps show here.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <table className="w-full text-sm">
        <thead className="border-b border-border/60 bg-[#212121] text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Time</th>
            <th className="px-4 py-3 font-medium">Side</th>
            <th className="px-4 py-3 font-medium">Token</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Tx</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id} className="border-b border-border/40 last:border-0">
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(trade.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "font-medium capitalize",
                    trade.side === "buy" ? "text-emerald-600" : "text-amber-600",
                  )}
                >
                  {trade.side}
                </span>
              </td>
              <td className="px-4 py-3">{trade.tokenSymbol ?? trade.tokenName ?? "—"}</td>
              <td className="px-4 py-3 capitalize">{trade.status}</td>
              <td className="px-4 py-3">
                {trade.signature ? (
                  <a
                    href={`https://solscan.io/tx/${trade.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {trade.signature.slice(0, 8)}…
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardCopyTradePage({ initialData }: Props) {
  const [tab, setTab] = useState<TabId>("leaderboard");
  const [searchWallet, setSearchWallet] = useState("");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTrader, setSelectedTrader] = useState<CopyLeaderboardTrader | null>(null);
  const [editingConfig, setEditingConfig] = useState<CopyTradeConfigRow | null>(null);
  const [saving, setSaving] = useState(false);
  const agentDbId = initialData.agent.id;
  const queryClient = useQueryClient();
  const isSearchMode = Boolean(searchWallet.trim());
  const search = searchWallet.trim();

  const configsQuery = useQuery({
    queryKey: dashboardKeys.copyTrade(agentDbId),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/trade/copy`, { signal });
      const json = (await res.json().catch(() => ({}))) as {
        configs?: CopyTradeConfigRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      return json.configs ?? [];
    },
    initialData: initialData.configs,
    enabled: tab === "subscriptions",
    refetchInterval: tab === "subscriptions" ? 15_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const configs = configsQuery.data ?? initialData.configs;

  const leaderboardQuery = useInfiniteQuery({
    queryKey: dashboardKeys.copyTradeLeaderboard(agentDbId, {
      venue: "spot",
      wallet: search,
      limit: PERPSO_LEADERBOARD_PAGE_SIZE,
    }),
    initialPageParam: 0,
    initialData: isSearchMode
      ? undefined
      : {
          pages: [
            {
              traders: initialData.leaderboard,
              hasMore:
                initialData.leaderboard.length >= PERPSO_LEADERBOARD_PAGE_SIZE,
            },
          ],
          pageParams: [0],
        },
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        venue: "spot",
        limit: String(PERPSO_LEADERBOARD_PAGE_SIZE),
        offset: String(pageParam),
      });
      if (search) params.set("wallet", search);
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/trade/copy/leaderboard?${params.toString()}`,
        { signal },
      );
      const json = (await res.json()) as {
        traders?: CopyLeaderboardTrader[];
        trader?: CopyLeaderboardTrader;
        hasMore?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to load leaderboard");
      return json;
    },
    enabled: tab === "leaderboard",
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.trader || !lastPage.hasMore) return undefined;
      return pages.reduce((count, p) => count + (p.traders?.length ?? 0), 0);
    },
  });
  const traders =
    leaderboardQuery.data?.pages.flatMap((p) =>
      p.trader ? [p.trader] : (p.traders ?? []),
    ) ?? [];
  const loadingLeaderboard = leaderboardQuery.isPending;
  const loadingMore = leaderboardQuery.isFetchingNextPage;
  const hasMore = leaderboardQuery.hasNextPage;
  const fetchNextLeaderboardPage = leaderboardQuery.fetchNextPage;
  const loadLeaderboard = (_append = false) => void leaderboardQuery.refetch();
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || isSearchMode) return;
    void fetchNextLeaderboardPage();
  }, [fetchNextLeaderboardPage, hasMore, isSearchMode, loadingMore]);
  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: dashboardKeys.copyTrade(agentDbId),
      }),
    [agentDbId, queryClient],
  );

  useEffect(() => {
    if (tab !== "leaderboard" || isSearchMode || !hasMore || loadingMore || loadingLeaderboard) {
      return;
    }
    const node = loadMoreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isSearchMode, loadMore, loadingLeaderboard, loadingMore, tab, traders.length]);

  const openCopyDialog = useCallback((trader: CopyLeaderboardTrader | null) => {
    setEditingConfig(null);
    setSelectedTrader(trader);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((config: CopyTradeConfigRow) => {
    setSelectedTrader(null);
    setEditingConfig(config);
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setSelectedTrader(null);
      setEditingConfig(null);
    }
  }, []);

  const saveConfig = useCallback(
    async (draft: CopyTradeSetupDraft) => {
      setSaving(true);
      const payload = {
        targetWallet: draft.targetWallet.trim(),
        label: draft.label.trim() || null,
        buyPercent: draft.buyPercent,
        sizingMode: draft.sizingMode,
        portfolioAllocationPct: draft.portfolioAllocationPct,
        maxPositionUsd: draft.maxPositionUsd,
        loopCadenceSec: draft.loopCadenceSec,
        llmModelKey: draft.llmModelKey,
        llmBudgetUsd: draft.llmBudgetUsd,
      };
      try {
        const res = editingConfig
          ? await fetch(`/api/dashboard/agents/${agentDbId}/trade/copy/${editingConfig.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/dashboard/agents/${agentDbId}/trade/copy`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, venue: "spot" }),
            });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(json.error ?? `${editingConfig ? "Update" : "Create"} failed (${res.status})`);
        }
        showToast(
          editingConfig ? "Copy trade updated" : "Copy trade subscription created",
          "success",
        );
        closeDialog(false);
        setTab("subscriptions");
        await refresh();
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : editingConfig ? "Update failed" : "Create failed",
          "error",
        );
      } finally {
        setSaving(false);
      }
    },
    [agentDbId, closeDialog, editingConfig, refresh],
  );

  const toggleStatus = useCallback(
    async (config: CopyTradeConfigRow) => {
      const next = config.status === "active" ? "paused" : "active";
      try {
        const res = await fetch(`/api/dashboard/agents/${agentDbId}/trade/copy/${config.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Update failed");
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Update failed", "error");
      }
    },
    [agentDbId, refresh],
  );

  const removeConfig = useCallback(
    async (configId: string) => {
      try {
        const res = await fetch(`/api/dashboard/agents/${agentDbId}/trade/copy/${configId}`, {
          method: "DELETE",
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Delete failed");
        showToast("Removed copy trade", "success");
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Delete failed", "error");
      }
    },
    [agentDbId, refresh],
  );

  const activeCount = configs.filter((c) => c.status === "active").length;

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 overflow-x-hidden px-4 py-6 sm:px-6 min-w-0">
      <section className="ui-overview-summary overflow-hidden rounded-xl">
      <div className="ui-overview-identity flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar image={initialData.agent.image} name={initialData.agent.name} size="md" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Copy Trade</h1>
            <p className="mt-1 text-sm text-muted-foreground">Mirror spot strategies from tracked traders.</p>
          </div>
        </div>
        <span className="rounded-full border border-border bg-[#272727] px-2.5 py-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{activeCount}</span> active
        </span>
      </div>
      <div className="ui-overview-metrics grid grid-cols-2">
        <div className="ui-overview-metric px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Subscriptions</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{configs.length}</p>
        </div>
        <div className="ui-overview-metric px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Active</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{activeCount}</p>
        </div>
      </div>
      </section>

      <div className="ui-tabs-scroll rounded-full border border-border bg-muted/30 p-1" role="tablist" aria-label="Copy trade sections">
        {COPY_TRADE_TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <Button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 justify-center gap-2 rounded-full px-4"
              onClick={() => setTab(id)}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </Button>
          );
        })}
      </div>

      {tab === "leaderboard" ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">Trader leaderboard</h2>
          </div>
          <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={searchWallet}
                onChange={(e) => setSearchWallet(e.target.value)}
                placeholder="Search wallet address"
                className="w-full bg-background text-sm outline-none"
              />
            </div>
            <Button size="sm" variant="secondary" onClick={() => void loadLeaderboard(false)}>
              Search
            </Button>
          </div>

          {loadingLeaderboard ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : traders.length === 0 ? (
            <div className="rounded-xl border border-border bg-[#212121] px-4 py-6 text-center text-sm text-muted-foreground">
              No SOL-focused traders found. Search a wallet address on perp.so.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {traders.map((trader) => (
                  <CopyTradeLeaderboardCard
                    key={`${trader.venue}-${trader.wallet}`}
                    trader={trader}
                    onCopy={openCopyDialog}
                  />
                ))}
              </div>

              {!isSearchMode && hasMore ? (
                <div ref={loadMoreRef} className="flex justify-center py-6">
                  {loadingMore ? (
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  ) : (
                    <Button variant="outline" size="sm" onClick={loadMore}>
                      Load more
                    </Button>
                  )}
                </div>
              ) : null}
            </>
          )}
          </div>
        </section>
      ) : tab === "history" ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">Trade history</h2>
          </div>
          <div className="px-5 py-4">
            <TradeHistoryTable trades={initialData.trades} />
          </div>
        </section>
      ) : (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header flex items-center justify-between gap-3 px-5 py-4">
            <h2 className="text-sm font-semibold">Subscriptions</h2>
            <Button variant="outline" size="sm" onClick={() => openCopyDialog(null)}>
              <Plus className="mr-2 size-4" />
              Add subscription
            </Button>
          </div>
          <div className="px-5 py-4">
          {configs.length === 0 ? (
            <div className="rounded-xl border border-border bg-[#212121] px-4 py-6 text-center text-sm text-muted-foreground">
              No copy-trade subscriptions yet.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {configs.map((config) => (
                <div
                  key={config.id}
                  className="ui-overview-metric rounded-xl p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{config.label ?? "Trader"}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {shortenWallet(config.targetWallet)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                        config.status === "active"
                          ? "border border-border bg-muted/70 text-foreground"
                          : "border border-border bg-[#272727] text-muted-foreground",
                      )}
                    >
                      {config.status}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
                    <div>
                      <dt>Allocation</dt>
                      <dd className="font-medium text-foreground">
                        {config.portfolioAllocationPct}%
                      </dd>
                    </div>
                    <div>
                      <dt>Buy size</dt>
                      <dd className="font-medium text-foreground">{config.buyPercent}%</dd>
                    </div>
                    <div>
                      <dt>Max pos</dt>
                      <dd className="font-medium text-foreground">
                        {config.maxPositionUsd != null ? `$${config.maxPositionUsd}` : "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      Mirrors{" "}
                      <span className="font-medium text-foreground">{config.mirrorCount}</span>
                    </span>
                    <span className="truncate">
                      {config.lastMirroredAt
                        ? `Last ${new Date(config.lastMirroredAt).toLocaleString()}`
                        : "Waiting for leader trade"}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3"
                      onClick={() => openEditDialog(config)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3"
                      onClick={() => toggleStatus(config)}
                    >
                      {config.status === "active" ? (
                        <>
                          <Pause className="size-3.5" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="size-3.5" />
                          Resume
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeConfig(config.id)}
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </section>
      )}

      <CopyTradeSetupDialog
        open={dialogOpen}
        onOpenChange={closeDialog}
        trader={selectedTrader}
        editingConfig={editingConfig}
        initialData={initialData}
        saving={saving}
        onSubmit={saveConfig}
      />
    </div>
  );
}
