"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, TrendingUp, X } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { RuntimeImage } from "@/components/shared/runtime-image";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast-simple";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import type { DashboardTradePerpsPageData } from "@/lib/agent-trading/perps-page.server";
import type { LavaraveOffer } from "@/lib/agent-trading/lavarave/offers";
import type { LavaravePosition } from "@/lib/agent-trading/lavarave/positions";
import { cn } from "@/lib/utils";

type Props = {
  initialData: DashboardTradePerpsPageData;
};

function formatSol(lamports: number | null): string {
  if (lamports == null) return "—";
  return (lamports / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export function DashboardTradePerpsPage({ initialData }: Props) {
  const queryClient = useQueryClient();
  const [offerQuery, setOfferQuery] = useState("");
  const [selectedOffer, setSelectedOffer] = useState<LavaraveOffer | null>(
    () => initialData.lavarave.offers[0] ?? null,
  );
  const [amountSol, setAmountSol] = useState("0.5");
  const [leverageX, setLeverageX] = useState("2");
  const [slippagePct, setSlippagePct] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const agentDbId = initialData.agent.id;

  const query = useQuery({
    queryKey: dashboardKeys.perps(agentDbId),
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/trade/perps/lavarage`,
        { signal },
      );
      const json = (await res.json()) as {
        offers?: LavaraveOffer[];
        positions?: LavaravePosition[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Refresh failed");
      return {
        offers: json.offers ?? [],
        positions: json.positions ?? [],
      };
    },
    initialData: {
      offers: initialData.lavarave.offers,
      positions: initialData.lavarave.positions,
    },
    refetchOnMount: false,
  });
  const data = {
    ...initialData,
    lavarave: {
      ...initialData.lavarave,
      ...(query.data ?? {}),
    },
  };

  const filteredOffers = useMemo(() => {
    const q = offerQuery.trim().toLowerCase();
    if (!q) return data.lavarave.offers;
    return data.lavarave.offers.filter(
      (offer) =>
        offer.symbol.toLowerCase().includes(q)
        || offer.mint.toLowerCase().includes(q)
        || (offer.name?.toLowerCase().includes(q) ?? false),
    );
  }, [data.lavarave.offers, offerQuery]);

  const maxLeverage = selectedOffer?.maxLeverage ?? 5;

  const actionMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/trade/perps/lavarage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = (await res.json()) as { error?: string; txid?: string };
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      return json;
    },
    onMutate: (payload) => setBusy(String(payload.action ?? "working")),
    onSuccess: (json) => {
      showToast(
        json.txid ? `Submitted: ${json.txid.slice(0, 8)}…` : "Success",
        "success",
      );
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.perps(agentDbId),
      });
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "Request failed", "error");
    },
    onSettled: () => setBusy(null),
  });

  if (!data.lavarave.enabled) {
    return (
      <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
        <section className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity flex items-start gap-3 px-4 py-3.5 sm:px-5">
          <AgentAvatar image={data.agent.image} name={data.agent.name} size="md" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Leverage</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Lavarage leveraged spot trading from the agent wallet.
            </p>
          </div>
        </div>
        </section>
        <div className="ui-overview-panel rounded-xl p-8 text-center text-sm text-muted-foreground">
          Add <code className="text-xs">LAVARAVE_X_API_KEY</code> to your environment to enable
          Lavarage offers and trading.
        </div>
      </div>
    );
  }

  if (!data.agent.isCustodial || !data.agent.walletPublicKey) {
    return (
      <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
        <section className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity flex items-start gap-3 px-4 py-3.5 sm:px-5">
          <AgentAvatar image={data.agent.image} name={data.agent.name} size="md" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Leverage</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Requires a custodial agent wallet to sign Lavarage transactions.
            </p>
          </div>
        </div>
        </section>
      </div>
    );
  }

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <section className="ui-overview-summary overflow-hidden rounded-xl">
      <div className="ui-overview-identity flex items-start gap-3 px-4 py-3.5 sm:px-5">
        <AgentAvatar image={data.agent.image} name={data.agent.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Leverage</h1>
            <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
              Lavarage
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Long tokens with borrowed SOL via Lavarage. Pay with SOL from the agent wallet.
          </p>
        </div>
      </div>

      <div className="ui-overview-metrics grid grid-cols-2">
        <div className="ui-overview-metric p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Wallet SOL</p>
          <p className="mt-1 text-2xl font-semibold">{formatSol(data.agent.solBalanceLamports)}</p>
        </div>
        <div className="ui-overview-metric p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open positions</p>
          <p className="mt-1 text-2xl font-semibold">{data.lavarave.positions.length}</p>
        </div>
      </div>
      </section>

      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
        <h2 className="text-sm font-semibold">Open long</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a supported pair, set collateral and leverage, then open a leveraged long.
        </p>

        </div>
        <div className="space-y-3 px-5 py-4">
          <input
            value={offerQuery}
            onChange={(e) => setOfferQuery(e.target.value)}
            placeholder="Search token symbol or mint"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />

          <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60">
            {filteredOffers.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No offers match your search.</p>
            ) : (
              filteredOffers.slice(0, 40).map((offer) => {
                const active = selectedOffer?.mint === offer.mint;
                return (
                  <button
                    key={offer.mint}
                    type="button"
                    onClick={() => setSelectedOffer(offer)}
                    className={cn(
                      "flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-sm last:border-0",
                      active && "bg-muted/70 text-foreground",
                    )}
                  >
                    {offer.icon ? (
                      <RuntimeImage src={offer.icon} alt="" className="size-5 rounded-full" aria-hidden />
                    ) : null}
                    <span className="font-medium">{offer.symbol}</span>
                    <span className="text-xs text-muted-foreground">max {offer.maxLeverage}x</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">SOL amount</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amountSol}
                onChange={(e) => setAmountSol(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Leverage (max {maxLeverage}x)</span>
              <input
                type="number"
                min="1"
                max={maxLeverage}
                step="0.5"
                value={leverageX}
                onChange={(e) => setLeverageX(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Slippage %</span>
              <input
                type="number"
                min="0.1"
                max="50"
                step="0.5"
                value={slippagePct}
                onChange={(e) => setSlippagePct(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <Button
            disabled={busy != null || !selectedOffer}
            onClick={() => {
              if (!selectedOffer) return;
              actionMutation.mutate({
                action: "open",
                symbol: selectedOffer.mint,
                amountSol: Number.parseFloat(amountSol),
                leverageX: Number.parseFloat(leverageX),
                slippagePct: Number.parseFloat(slippagePct),
              });
            }}
          >
            {busy === "open" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <TrendingUp className="mr-2 size-4" />}
            Long {selectedOffer?.symbol ?? "token"}
          </Button>
        </div>
      </section>

      {data.lavarave.positions.length > 0 ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">Open positions</h2>
          </div>
          <div className="space-y-2 px-5 py-4">
            {data.lavarave.positions.map((pos) => (
              <div
                key={pos.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{pos.symbol}</p>
                  <p className="text-xs text-muted-foreground">
                    {pos.leverage}x
                    {pos.positionSizeSol != null ? ` · ${pos.positionSizeSol.toFixed(3)} SOL` : ""}
                    {pos.entryPriceUsd != null ? ` · entry $${pos.entryPriceUsd.toFixed(6)}` : ""}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy != null}
                  onClick={() =>
                    actionMutation.mutate({ action: "sell", positionId: pos.id })
                  }
                >
                  {busy === "sell" ? (
                    <Loader2 className="mr-1 size-3 animate-spin" />
                  ) : (
                    <X className="mr-1 size-3" />
                  )}
                  Close
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data.agent.walletSolscanUrl ? (
        <Button variant="ghost" size="sm" asChild>
          <a href={data.agent.walletSolscanUrl} target="_blank" rel="noreferrer">
            View wallet
            <ExternalLink className="ml-1.5 size-3.5" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}
