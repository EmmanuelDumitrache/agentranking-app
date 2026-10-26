"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownUp,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast-simple";
import type { DashboardTradePageData } from "@/lib/agent-trading/trade-page.server";
import { cn } from "@/lib/utils";

type Props = {
  readonly initialData: DashboardTradePageData;
};

type QuoteApiResponse = {
  ok?: boolean;
  error?: string;
  side: "buy" | "sell";
  tokenMint: string;
  token?: {
    symbol?: string;
    name?: string;
    decimals?: number;
  } | null;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: string;
  slippageBps: number;
  quote: Record<string, unknown>;
};

type QuotePreview = {
  side: "buy" | "sell";
  tokenMint: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: string;
  slippageBps: number;
  quote: Record<string, unknown>;
  tokenDecimals: number;
};

type SearchToken = {
  id: string;
  name: string;
  symbol: string;
  icon: string | null;
  decimals: number;
  usdPrice: number | null;
};

function formatSol(lamports: number | null): string {
  if (lamports == null) return "—";
  return (lamports / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatRawAmount(raw: string | null, decimals: number): string {
  if (!raw) return "—";
  const value = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function shortenMint(value: string, chars = 4): string {
  if (value.length <= chars * 2 + 1) return value;
  return `${value.slice(0, chars)}…${value.slice(-chars)}`;
}

const SELL_PRESETS = ["25", "50", "75", "100"] as const;

export function DashboardTradePage({ initialData }: Props) {
  const data = initialData;
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeMint = searchParams.get("mint")?.trim() ?? "";
  const routeSideParam = searchParams.get("side");
  const routeSide =
    routeSideParam === "buy" || routeSideParam === "sell" ? routeSideParam : null;
  const routeSelectionKey = `${routeMint}\u0000${routeSide ?? ""}`;
  const [side, setSide] = useState<"buy" | "sell">(() => routeSide ?? "buy");
  const [tokenMint, setTokenMint] = useState(
    () => routeMint || data.launchedToken?.mint || "",
  );
  const [observedRouteSelectionKey, setObservedRouteSelectionKey] =
    useState(routeSelectionKey);
  const [amount, setAmount] = useState("");
  const [amountKind, setAmountKind] = useState<"sol" | "token" | "percent">("sol");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchToken[]>([]);
  const [searching, setSearching] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [quote, setQuote] = useState<QuotePreview | null>(null);

  const agentDbId = data.agent.id;
  const launched = data.launchedToken;

  if (observedRouteSelectionKey !== routeSelectionKey) {
    setObservedRouteSelectionKey(routeSelectionKey);
    if (routeMint) setTokenMint(routeMint);
    if (routeSide) setSide(routeSide);
  }

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/dashboard/agents/${agentDbId}/trade/search?q=${encodeURIComponent(q)}`,
        );
        const json = (await res.json()) as { tokens?: SearchToken[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Search failed");
        setSearchResults(json.tokens ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [agentDbId, searchQuery]);

  const selectedDecimals = useMemo(() => {
    const fromSearch = searchResults.find((t) => t.id === tokenMint);
    if (fromSearch) return fromSearch.decimals;
    if (launched?.mint === tokenMint) return 6;
    return 6;
  }, [launched?.mint, searchResults, tokenMint]);

  const refreshPage = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleQuote = useCallback(async () => {
    setQuoting(true);
    setQuote(null);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/trade/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          side,
          tokenMint,
          amount,
          amountKind: side === "buy" ? "sol" : amountKind,
          slippageBps: data.config.defaultSlippageBps,
        }),
      });
      const json = (await res.json()) as QuoteApiResponse;
      if (!res.ok) throw new Error(json.error ?? "Quote failed");
      setQuote({
        side: json.side,
        tokenMint: json.tokenMint,
        tokenSymbol: json.token?.symbol ?? launched?.symbol ?? null,
        tokenName: json.token?.name ?? launched?.name ?? null,
        inputAmount: json.inputAmount,
        outputAmount: json.outputAmount,
        priceImpactPct: json.priceImpactPct,
        slippageBps: json.slippageBps,
        quote: json.quote as Record<string, unknown>,
        tokenDecimals: json.token?.decimals ?? selectedDecimals,
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Quote failed", "error");
    } finally {
      setQuoting(false);
    }
  }, [agentDbId, amount, amountKind, data.config.defaultSlippageBps, launched, selectedDecimals, side, tokenMint]);

  const handleSwap = useCallback(async () => {
    if (!quote) return;
    setSwapping(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/trade/swap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          side: quote.side,
          tokenMint: quote.tokenMint,
          quote: quote.quote,
          tokenSymbol: quote.tokenSymbol,
          tokenName: quote.tokenName,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        signature?: string;
        solscanUrl?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Swap failed");
      showToast("Trade submitted successfully", "success");
      setQuote(null);
      setAmount("");
      refreshPage();
      if (json.solscanUrl) {
        window.open(json.solscanUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Swap failed", "error");
    } finally {
      setSwapping(false);
    }
  }, [agentDbId, quote, refreshPage]);

  if (!data.agent.isCustodial) {
    return (
      <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
        <section className="ui-overview-panel rounded-xl p-5">
        <h1 className="text-xl font-semibold tracking-tight">Trade</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Trading requires a custodial agent wallet. Provision the agent wallet from the{" "}
          <Link href={`/dashboard/agents/${agentDbId}/wallet`} className="text-foreground underline underline-offset-4">
            Wallet
          </Link>{" "}
          page first.
        </p>
        </section>
      </div>
    );
  }

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <section className="ui-overview-summary overflow-hidden rounded-xl">
      <div className="ui-overview-identity flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar image={data.agent.image} name={data.agent.name} size="lg" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Trade</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.agent.name} · {formatSol(data.agent.solBalanceLamports)} SOL
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={refreshPage}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>
      <div className="ui-overview-metrics grid grid-cols-2">
        <div className="ui-overview-metric px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Wallet balance</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatSol(data.agent.solBalanceLamports)} SOL</p>
        </div>
        <div className="ui-overview-metric px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Execution</p>
          <p className="mt-0.5 text-sm font-semibold">Jupiter</p>
        </div>
      </div>
      </section>

      {launched ? (
        <section className="ui-overview-panel rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {launched.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={launched.imageUrl}
                  alt=""
                  className="h-12 w-12 rounded-full border border-border/60 object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground">
                  <TrendingUp className="h-5 w-5" />
                </div>
              )}
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider">My token</p>
                <p className="text-lg font-semibold">
                  {launched.symbol ?? "TOKEN"}
                  {launched.name ? ` · ${launched.name}` : ""}
                </p>
                <p className="text-muted-foreground font-mono text-xs">
                  {shortenMint(launched.mint, 6)}
                </p>
              </div>
            </div>
            <div className="space-y-1 text-right text-sm">
              <p>
                Balance:{" "}
                <span className="font-medium">
                  {formatRawAmount(launched.balanceRaw, 6)} {launched.symbol ?? "tokens"}
                </span>
              </p>
              {launched.usdPrice != null ? (
                <p className="text-muted-foreground">
                  ${launched.usdPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <a
                  href={launched.pumpFunUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Pump.fun <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href={launched.dexscreenerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Dexscreener <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setTokenMint(launched.mint);
                setSearchQuery("");
                setQuote(null);
              }}
            >
              Trade my token
            </Button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">Swap</h2>
          </div>
          <div className="space-y-4 px-5 py-4">
          <div className="flex rounded-full border border-border bg-muted/30 p-1">
            {(["buy", "sell"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant="ghost"
                onClick={() => {
                  setSide(value);
                  setQuote(null);
                  setAmountKind(value === "buy" ? "sol" : "percent");
                }}
                className={cn(
                  "flex-1 capitalize",
                  side === value
                    ? "rounded-full border border-white/8 bg-[#3f3f3f] text-[#f1f1f1] shadow-none hover:bg-[#474747] hover:text-[#f1f1f1]"
                    : "rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {value}
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="trade-token"
              className="text-muted-foreground text-xs font-medium uppercase tracking-wider"
            >
              Token
            </label>
            <div className="relative">
              <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <Input
                id="trade-token"
                value={searchQuery || tokenMint}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearchQuery(next);
                  setTokenMint(next);
                  if (next.trim().length < 2) {
                    setSearchResults([]);
                    setSearching(false);
                  }
                  setQuote(null);
                }}
                placeholder="Search symbol or paste mint address"
                className="pl-10 font-mono"
              />
            </div>
            {searching ? (
              <p className="text-muted-foreground text-xs">Searching…</p>
            ) : searchResults.length > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60">
                {searchResults.slice(0, 8).map((token) => (
                  <button
                    key={token.id}
                    type="button"
                    onClick={() => {
                      setTokenMint(token.id);
                      setSearchQuery(`${token.symbol} (${shortenMint(token.id)})`);
                      setSearchResults([]);
                      setQuote(null);
                    }}
                    className="hover:bg-muted/50 flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                  >
                    <span className="font-medium">{token.symbol}</span>
                    <span className="text-muted-foreground truncate">{token.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="trade-amount"
              className="text-muted-foreground text-xs font-medium uppercase tracking-wider"
            >
              {side === "buy" ? "Amount (SOL)" : "Amount"}
            </label>
            {side === "sell" ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {SELL_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setAmountKind("percent");
                      setAmount(preset);
                      setQuote(null);
                    }}
                    className={cn(
                      "px-3",
                      amount === preset && amountKind === "percent"
                        ? "rounded-full border border-white/8 bg-[#3f3f3f] text-[#f1f1f1] shadow-none hover:bg-[#474747] hover:text-[#f1f1f1]"
                        : "rounded-full bg-muted/50 text-muted-foreground",
                    )}
                  >
                    {preset}%
                  </Button>
                ))}
              </div>
            ) : null}
            <Input
              id="trade-amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (side === "sell" && amountKind === "percent") {
                  setAmountKind("token");
                }
                setQuote(null);
              }}
              placeholder={side === "buy" ? "0.1" : "Token amount"}
            />
          </div>

          <Button className="w-full" onClick={handleQuote} disabled={quoting || !tokenMint || !amount}>
            {quoting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowDownUp className="mr-2 h-4 w-4" />}
            Get quote
          </Button>
          </div>
        </section>

        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">Quote</h2>
          </div>
          <div className="px-5 py-4">
          {!quote ? (
            <p className="text-muted-foreground text-sm">
              Enter a token and amount, then fetch a Jupiter quote before confirming.
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="space-y-2 rounded-lg bg-muted/30 p-4">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">You pay</span>
                  <span className="font-medium">
                    {quote.side === "buy"
                      ? `${formatRawAmount(quote.inputAmount, 9)} SOL`
                      : `${formatRawAmount(quote.inputAmount, quote.tokenDecimals)} ${quote.tokenSymbol ?? "TOKEN"}`}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">You receive</span>
                  <span className="font-medium">
                    {quote.side === "buy"
                      ? `${formatRawAmount(quote.outputAmount, quote.tokenDecimals)} ${quote.tokenSymbol ?? "TOKEN"}`
                      : `${formatRawAmount(quote.outputAmount, 9)} SOL`}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Price impact</span>
                  <span>{Number(quote.priceImpactPct).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Slippage</span>
                  <span>{(quote.slippageBps / 100).toFixed(2)}%</span>
                </div>
              </div>
              <Button className="w-full" onClick={handleSwap} disabled={swapping}>
                {swapping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirm {quote.side}
              </Button>
            </div>
          )}
          </div>
        </section>
      </div>

      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-semibold">Recent trades</h2>
        </div>
        <div className="px-5 py-4">
        {data.recentTrades.length === 0 ? (
          <p className="text-muted-foreground text-sm">No trades yet.</p>
        ) : (
          <div className="ui-table-scroll">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="text-muted-foreground border-b border-border/60 text-xs uppercase tracking-wider">
                  <th className="pb-2 pr-4 font-medium">Side</th>
                  <th className="pb-2 pr-4 font-medium">Token</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">When</th>
                  <th className="pb-2 font-medium">Tx</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTrades.map((trade) => (
                  <tr key={trade.id} className="border-b border-border/40 last:border-0">
                    <td className="py-3 pr-4 capitalize">{trade.side}</td>
                    <td className="py-3 pr-4">{trade.tokenSymbol ?? shortenMint(trade.outputMint)}</td>
                    <td className="py-3 pr-4 capitalize">{trade.status}</td>
                    <td className="text-muted-foreground py-3 pr-4">
                      {new Date(trade.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3">
                      {trade.signature ? (
                        <a
                          href={`https://solscan.io/tx/${trade.signature}${
                            data.config.network === "devnet" ? "?cluster=devnet" : ""
                          }`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                        >
                          View <ExternalLink className="h-3 w-3" />
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
        )}
        </div>
      </section>
    </div>
  );
}
