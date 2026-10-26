"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PublicTokenCard } from "@/components/public-site/token-card";
import { OfficialTokenCard } from "@/components/public-site/official-token-card";
import {
  PublicSiteBrowseToolbar,
  type PublicSiteMetricKey,
  type PublicSiteTimeframeKey,
} from "@/components/public-site/public-site-browse-toolbar";
import { PublicSiteEmptyState, PublicSitePanel } from "@/components/public-site/public-site-ui";
import { TokensMarketShareButton } from "@/components/public-site/tokens-market-share-button";
import { useArLiveFeedRefresh } from "@/hooks/use-ar-live-feed-refresh";
import type { TokenDiscoveryCardModel } from "@/lib/agent-launch/launch-index-data.server";
import type { OfficialPublicToken } from "@/lib/public-site/official-tokens";
import type { TokenMarketSnapshot } from "@/lib/public-site/dexscreener";
import {
  compareByPublicSiteMetric,
  computeLaunchTokenSearchRelevance,
  matchesPublicSiteChainFilter,
  type LaunchTokenSearchFields,
  type PublicSiteSortable,
  withinPublicSiteTimeframe,
} from "@/lib/public-site/browse-filters";
import { getPublicAgentVerificationStatus } from "@/lib/public-site/agent-verification";
import { EthereumIcon } from "@/components/shared/ethereum-icon";
import type { TokensShareDayPoint } from "@/lib/public-site/tokens-share-card";
import { cn } from "@/lib/utils";
const PAGE_SIZE = 60;
const REFRESH_MS = 60_000;
type Props = {
  readonly cards: readonly TokenDiscoveryCardModel[];
  readonly officialTokens?: readonly OfficialPublicToken[];
  readonly officialMarkets?: Map<string, TokenMarketSnapshot>;
};
type TokenGridItem =
  | { readonly kind: "official"; readonly token: OfficialPublicToken }
  | { readonly kind: "launch"; readonly model: TokenDiscoveryCardModel };
type TokenBrowseRow = {
  readonly item: TokenGridItem;
  readonly sortable: PublicSiteSortable;
  readonly relevance: number;
  readonly createdAt: string | null;
  readonly isOfficial: boolean;
};
function isLaunchTokenVerified(model: TokenDiscoveryCardModel): boolean {
  if (model.chain === "robinhood") return Boolean(model.sourceVerified);
  if (!model.linkedAgent) return false;
  return getPublicAgentVerificationStatus(model.linkedAgent).isVerified;
}
function discoveryToSortable(model: TokenDiscoveryCardModel): PublicSiteSortable {
  const market = model.market;
  const solLaunch = model.launch;
  return {
    createdAt: model.createdAt,
    volume24hUsd: market?.volume24hUsd ?? 0,
    marketCapUsd: market?.marketCapUsd ?? 0,
    fdvUsd: market?.fdvUsd ?? 0,
    hotScore:
      (market?.volume24hUsd ?? 0) +
      (solLaunch?.buyCount ?? 0) +
      (solLaunch?.sellCount ?? 0) +
      (market?.txns24hBuys ?? 0) +
      (market?.txns24hSells ?? 0),
    solEarnedLamports: solLaunch?.launch.totalFeesDistributedLamports ?? null,
    isVerified: isLaunchTokenVerified(model),
    chain: model.chain,
  };
}
function officialToSortable(
  market: TokenMarketSnapshot | null,
): PublicSiteSortable {
  return {
    createdAt: null,
    volume24hUsd: market?.volume24hUsd ?? 0,
    marketCapUsd: market?.marketCapUsd ?? 0,
    fdvUsd: market?.fdvUsd ?? 0,
    hotScore:
      (market?.volume24hUsd ?? 0) +
      (market?.txns24hBuys ?? 0) +
      (market?.txns24hSells ?? 0),
    solEarnedLamports: null,
    isVerified: true,
    chain: "official",
  };
}
function discoverySearchFields(model: TokenDiscoveryCardModel): LaunchTokenSearchFields {
  return {
    displayName: model.tokenName ?? model.tokenSymbol ?? "",
    tokenSymbol: model.tokenSymbol,
    tokenName: model.tokenName,
    mint:
      model.chain === "robinhood"
        ? model.rh?.tokenAddress ?? null
        : model.launch?.launch.mint ?? null,
    agentName: model.linkedAgent?.name ?? null,
  };
}
function officialSearchFields(token: OfficialPublicToken): LaunchTokenSearchFields {
  return {
    displayName: token.name,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    mint: token.mint,
    agentName: null,
  };
}
function buildBrowseRows(
  cards: readonly TokenDiscoveryCardModel[],
  officialTokens: readonly OfficialPublicToken[] | undefined,
  officialMarkets: Map<string, TokenMarketSnapshot> | undefined,
  rawQuery: string,
): TokenBrowseRow[] {
  const q = rawQuery.trim();
  const rows: TokenBrowseRow[] = [];
  for (const token of officialTokens ?? []) {
    const searchFields = officialSearchFields(token);
    rows.push({
      item: { kind: "official", token },
      sortable: officialToSortable(officialMarkets?.get(token.mint) ?? null),
      relevance: q ? computeLaunchTokenSearchRelevance(searchFields, q) : 0,
      createdAt: null,
      isOfficial: true,
    });
  }
  for (const model of cards) {
    const searchFields = discoverySearchFields(model);
    rows.push({
      item: { kind: "launch", model },
      sortable: discoveryToSortable(model),
      relevance: q ? computeLaunchTokenSearchRelevance(searchFields, q) : 0,
      createdAt: model.createdAt,
      isOfficial: false,
    });
  }
  return rows;
}
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function buildLaunchDaySeries(
  cards: readonly TokenDiscoveryCardModel[],
  days: number,
): TokensShareDayPoint[] {
  const now = new Date();
  const series: TokensShareDayPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = dayKey(d);
    series.push({
      key,
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      solana: 0,
      evm: 0,
    });
  }
  const index = new Map(series.map((row, i) => [row.key, i]));
  for (const card of cards) {
    const created = new Date(card.createdAt);
    if (!Number.isFinite(created.getTime())) continue;
    const i = index.get(dayKey(created));
    if (i == null) continue;
    const row = series[i]!;
    if (card.chain === "robinhood") {
      series[i] = { ...row, evm: row.evm + 1 };
    } else {
      series[i] = { ...row, solana: row.solana + 1 };
    }
  }
  return series;
}
function DayBars({
  series,
  selectedKey,
  onSelect,
}: {
  readonly series: readonly TokensShareDayPoint[];
  readonly selectedKey: string;
  readonly onSelect: (key: string) => void;
}) {
  const max = Math.max(1, ...series.map((d) => d.solana + d.evm));
  return (
    <div className="mt-2 flex h-10 items-stretch gap-1" role="group" aria-label="Launches by day">
      {series.map((day) => {
        const selected = day.key === selectedKey;
        const total = day.solana + day.evm;
        const heightPct = Math.max(total > 0 ? 18 : 8, (total / max) * 100);
        return (
          <button
            key={day.key}
            type="button"
            onClick={() => onSelect(day.key)}
            className="group flex min-w-0 flex-1 flex-col items-center justify-end outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-pressed={selected}
            aria-label={`${day.label}: ${total} launch${total === 1 ? "" : "es"}`}
            title={`${day.label} · ${total}`}
          >
            <span
              className={cn(
                "w-full max-w-[14px] rounded-sm transition-colors",
                selected
                  ? "bg-foreground"
                  : "bg-muted-foreground/35 group-hover:bg-muted-foreground/55",
              )}
              style={{ height: `${heightPct}%`, minHeight: 4 }}
            />
          </button>
        );
      })}
    </div>
  );
}
function StatValue({ children }: { readonly children: ReactNode }) {
  return (
    <p className="mt-1.5 bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-[1.75rem] font-semibold leading-none tracking-tight text-transparent tabular-nums sm:text-[2rem]">
      {children}
    </p>
  );
}
function TokensMarketStats({
  cards,
  officialCount,
}: {
  readonly cards: readonly TokenDiscoveryCardModel[];
  readonly officialCount: number;
}) {
  const series = useMemo(() => buildLaunchDaySeries(cards, 7), [cards]);
  const todayKey = series[series.length - 1]?.key ?? "";
  const [selection, setSelection] = useState<{ todayKey: string; dayKey: string } | null>(null);
  const selectedDay = selection?.todayKey === todayKey ? selection.dayKey : todayKey;
  const selected = series.find((d) => d.key === selectedDay) ?? series[series.length - 1];
  const selectedCount = (selected?.solana ?? 0) + (selected?.evm ?? 0);
  const selectedLabel =
    selected?.key === todayKey ? "Today" : (selected?.label ?? "Today");
  const solana = cards.filter((c) => c.chain === "solana").length + officialCount;
  const evm = cards.filter((c) => c.chain === "robinhood").length;
  const total = solana + evm;
  return (
    <PublicSitePanel className="gap-0 overflow-hidden p-0">
      <div className="grid grid-cols-2 gap-px bg-border/40 sm:grid-cols-4">
        <div className="bg-background/80 px-3 py-3.5 sm:px-4">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">Total</p>
          <StatValue>{total}</StatValue>
        </div>
        <div className="bg-background/80 px-3 py-3.5 sm:px-4">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
            {selectedLabel}
          </p>
          <StatValue>{selectedCount}</StatValue>
          <DayBars series={series} selectedKey={selected?.key ?? todayKey} onSelect={(dayKey) => setSelection({ todayKey, dayKey })} />
        </div>
        <div className="bg-background/80 px-3 py-3.5 sm:px-4">
          <p className="text-muted-foreground flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide">
            <RuntimeImage
              src="/branding/solana/solanaLogoMark.svg"
              alt=""
              className="h-3 w-3"
              aria-hidden
            />
            Solana
          </p>
          <StatValue>{solana}</StatValue>
        </div>
        <div className="bg-background/80 px-3 py-3.5 sm:px-4">
          <p className="text-muted-foreground flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide">
            <EthereumIcon className="h-3 w-3" />
            EVM
          </p>
          <StatValue>{evm}</StatValue>
        </div>
      </div>
    </PublicSitePanel>
  );
}
export function PublicTokensIndex({ cards, officialTokens, officialMarkets }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [timeframe, setTimeframe] = useState<PublicSiteTimeframeKey>("24h");
  const [metric, setMetric] = useState<PublicSiteMetricKey>("volume");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useArLiveFeedRefresh({ kinds: ["token_launch"] });
  useEffect(() => {
    const id = window.setInterval(() => {
      router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [router]);
  const filteredItems = useMemo(() => {
    const q = query.trim();
    const rows = buildBrowseRows(cards, officialTokens, officialMarkets, q).filter(
      ({ createdAt, isOfficial, relevance, sortable }) => {
        if (q && relevance === 0) return false;
        if (!matchesPublicSiteChainFilter(sortable.chain, metric)) return false;
        if (isOfficial) return true;
        return withinPublicSiteTimeframe(createdAt, timeframe);
      },
    );
    rows.sort((a, b) => {
      if (q && a.relevance !== b.relevance) {
        return b.relevance - a.relevance;
      }
      return compareByPublicSiteMetric(a.sortable, b.sortable, metric);
    });
    return rows.map(({ item }) => item);
  }, [cards, metric, officialMarkets, officialTokens, query, timeframe]);
  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount],
  );
  const remaining = Math.max(0, filteredItems.length - visibleItems.length);
  const resetVisible = () => setVisibleCount(PAGE_SIZE);
  const shareInput = useMemo(() => {
    const series = buildLaunchDaySeries(cards, 7);
    const solana = cards.filter((c) => c.chain === "solana").length + (officialTokens?.length ?? 0);
    const evm = cards.filter((c) => c.chain === "robinhood").length;
    return {
      total: solana + evm,
      solana,
      evm,
      series,
    };
  }, [cards, officialTokens]);
  return (
    <div className="ui-page-stack space-y-4">
      <TokensMarketStats cards={cards} officialCount={officialTokens?.length ?? 0} />
      <PublicSiteBrowseToolbar
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          resetVisible();
        }}
        timeframe={timeframe}
        onTimeframeChange={(value) => {
          setTimeframe(value);
          resetVisible();
        }}
        metric={metric}
        onMetricChange={(value) => {
          setMetric(value);
          resetVisible();
        }}
        searchPlaceholder="Search ticker, name, mint or agent…"
        searchAriaLabel="Search tokens"
        trailingActions={<TokensMarketShareButton shareInput={shareInput} />}
      />
      <div className="flex items-center justify-end px-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground tabular-nums">
          {visibleItems.length} of {filteredItems.length} tokens
        </p>
      </div>
      {filteredItems.length === 0 ? (
        <PublicSiteEmptyState message="No tokens match your filters." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((item) =>
              item.kind === "official" ? (
                <OfficialTokenCard
                  key={item.token.mint}
                  token={item.token}
                  market={officialMarkets?.get(item.token.mint) ?? null}
                />
              ) : (
                <PublicTokenCard key={item.model.id} model={item.model} />
              ),
            )}
          </div>
          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={remaining === 0}
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="ui-btn ui-btn-secondary ui-btn-sm ui-btn-fit transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              aria-disabled={remaining === 0}
            >
              View more ({remaining})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
