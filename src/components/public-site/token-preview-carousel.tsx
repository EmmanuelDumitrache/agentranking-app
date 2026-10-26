"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { useRouter } from "next/navigation";
import type { TokenDiscoveryCardModel } from "@/lib/agent-launch/launch-index-data.server";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import { PublicTokenCard } from "@/components/public-site/token-card";
import type { ArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-types";
import { useArLiveFeedEvent } from "@/hooks/use-ar-live-feed-event";
import { cn } from "@/lib/utils";
const FLASH_MS = 900;
export type TokenPreviewSortKey = "last_trade" | "new" | "market_cap";
const SORT_OPTIONS: readonly { readonly key: TokenPreviewSortKey; readonly label: string }[] = [
  { key: "last_trade", label: "Last Trade" },
  { key: "new", label: "New" },
  { key: "market_cap", label: "Highest MC" },
];
type Props = {
  readonly tokens: readonly TokenDiscoveryCardModel[];
};
function marketCap(model: TokenDiscoveryCardModel): number {
  return model.market?.marketCapUsd ?? model.market?.fdvUsd ?? 0;
}
function lastTradeScore(model: TokenDiscoveryCardModel): number {
  const updated = model.market?.rawUpdatedAt
    ? Date.parse(model.market.rawUpdatedAt)
    : Number.NaN;
  if (Number.isFinite(updated)) return updated;
  const txns =
    (model.market?.txns24hBuys ?? 0) +
    (model.market?.txns24hSells ?? 0) +
    (model.launch?.buyCount ?? 0) +
    (model.launch?.sellCount ?? 0);
  if (txns > 0) return txns;
  return Date.parse(model.createdAt) || 0;
}
function sortTokens(
  tokens: readonly TokenDiscoveryCardModel[],
  sort: TokenPreviewSortKey,
): TokenDiscoveryCardModel[] {
  const next = [...tokens];
  switch (sort) {
    case "last_trade":
      next.sort((a, b) => lastTradeScore(b) - lastTradeScore(a));
      break;
    case "new":
      next.sort(
        (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
      );
      break;
    case "market_cap":
      next.sort((a, b) => marketCap(b) - marketCap(a));
      break;
    default: {
      const _exhaustive: never = sort;
      return _exhaustive;
    }
  }
  return next;
}
function tokenMatchesFeedEvent(
  model: TokenDiscoveryCardModel,
  event: ArLiveFeedEvent,
): boolean {
  if (event.href && model.detailHref === event.href) return true;
  const href = event.href.toLowerCase();
  if (model.chain === "solana") {
    const mint = model.launch?.launch.mint?.toLowerCase();
    if (mint && href.includes(mint)) return true;
  }
  if (model.chain === "robinhood") {
    const address = model.rh?.tokenAddress?.toLowerCase();
    if (address && href.includes(address)) return true;
  }
  const symbol = event.symbol?.replace(/^\$/, "").toLowerCase();
  if (symbol && model.tokenSymbol?.toLowerCase() === symbol) return true;
  return false;
}
function bumpTokenToFront(
  tokens: readonly TokenDiscoveryCardModel[],
  tokenId: string,
): TokenDiscoveryCardModel[] {
  const index = tokens.findIndex((token) => token.id === tokenId);
  if (index < 0) return [...tokens];
  if (index === 0) return [...tokens];
  const next = [...tokens];
  const [item] = next.splice(index, 1);
  if (!item) return [...tokens];
  next.unshift(item);
  return next;
}
export function TokenPreviewCarousel({ tokens: initialTokens }: Props) {
  const router = useRouter();
  const [sort, setSort] = useState<TokenPreviewSortKey>("last_trade");
  const sourceKey = `${sort}:${initialTokens
    .map((token) => `${token.id}:${token.createdAt}:${token.market?.rawUpdatedAt ?? ""}`)
    .join("|")}`;
  const [tokens, setTokens] = useSourceDraft(sourceKey, sortTokens(initialTokens, sort));
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToken = useCallback((tokenId: string) => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    // Only one bump flash at a time — replace any in-progress flash.
    setFlashId(tokenId);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      setFlashId((current) => (current === tokenId ? null : current));
    }, FLASH_MS);
  }, []);
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);
  const handleFeedEvent = useCallback(
    (event: ArLiveFeedEvent) => {
      const currentSort = sort;
      const tradeEvent = event.kind === "buy" || event.kind === "sell";
      const launchEvent = event.kind === "token_launch";
      if (launchEvent) router.refresh();
      setTokens((previous) => {
        const match = previous.find((token) => tokenMatchesFeedEvent(token, event));
        if (!match) return previous;
        if (currentSort === "last_trade" && tradeEvent) {
          flashToken(match.id);
          return bumpTokenToFront(previous, match.id);
        }
        if (currentSort === "new" && launchEvent) {
          flashToken(match.id);
          return bumpTokenToFront(previous, match.id);
        }
        if (currentSort === "market_cap" && (tradeEvent || launchEvent)) {
          flashToken(match.id);
          return sortTokens(previous, "market_cap");
        }
        return previous;
      });
    },
    [flashToken, router, setTokens, sort],
  );
  useArLiveFeedEvent(["buy", "sell", "token_launch"] as const, handleFeedEvent);
  const onSortChange = (nextSort: TokenPreviewSortKey) => {
    setSort(nextSort);
    setTokens(sortTokens(initialTokens, nextSort));
  };
  return (
    <section id="tokens" className="border-t border-border/50 py-10 sm:py-12">
      <div className="ui-page-stack">
        <div className="min-w-0 max-w-2xl">
          <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.14em] uppercase">
            Launched by agents
          </p>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Trending tokens now
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            AgentRanking launchpad tokens linked to native agent identities, creator wallets, and
            public discovery.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {SORT_OPTIONS.map((option) => {
              const active = sort === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onSortChange(option.key)}
                  aria-pressed={active}
                  className={cn(
                    "ui-btn ui-btn-sm whitespace-nowrap",
                    active ? "ui-btn-primary" : "ui-btn-secondary",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
            <Link
              href={publicSiteRoutes.tokens}
              className="ui-btn ui-btn-secondary ui-btn-sm whitespace-nowrap"
            >
              View all
            </Link>
          </div>
        </div>
        {tokens.length === 0 ? (
          <div className="ui-panel ui-panel--stack mt-6 border-dashed py-10 text-center">
            <p className="text-muted-foreground text-sm">No public token launches yet.</p>
            <Link href={publicSiteRoutes.launchToken} className="ui-btn ui-btn-secondary ui-btn-sm mt-4">
              Launch the first token
            </Link>
          </div>
        ) : (
          <div className="token-preview-strip mt-5 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]">
            <div className="flex min-w-0 items-stretch gap-3">
              {tokens.map((model) => (
                <div
                  key={model.id}
                  className={cn(
                    "token-preview-strip__item w-[min(260px,78vw)] shrink-0 [scroll-snap-align:start] sm:w-[min(280px,42vw)] lg:w-[min(300px,24rem)]",
                    flashId === model.id && "token-preview-strip__item--flash",
                  )}
                >
                  <PublicTokenCard model={model} compact />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
