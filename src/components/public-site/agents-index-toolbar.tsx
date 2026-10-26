"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AGENTRANKING_NATIVE_CHAIN_ID } from "@/lib/chain-constants";
import { buildAgentsIndexHref } from "@/lib/ranking/agents-index-href";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 280;
const countFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

type ChainOption = {
  readonly chainId: number;
  readonly name: string;
  readonly shortName: string;
  readonly agentCount: number;
};

type Props = {
  readonly query: string;
  readonly chainId: number | null;
  readonly verifiedOnly: boolean;
  readonly x402Only: boolean;
  readonly mppOnly: boolean;
  readonly chains: readonly ChainOption[];
};

function FilterIsland({
  children,
  className,
  "aria-label": ariaLabel,
  scroll,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly "aria-label": string;
  readonly scroll?: boolean;
}) {
  return (
    <fieldset
      className={cn(
        "ui-public-site-filter-island m-0 min-w-0 p-1",
        scroll
          ? "no-scrollbar max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
          : "inline-flex shrink-0",
        className,
      )}
      aria-label={ariaLabel}
    >
      <div className={cn("flex items-center gap-0.5", scroll && "w-max")}>{children}</div>
    </fieldset>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  title,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={active}
      aria-label={title}
    >
      {children}
    </button>
  );
}

export function AgentsIndexToolbar({
  query,
  chainId,
  verifiedOnly,
  x402Only,
  mppOnly,
  chains,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draftQuery, setDraftQuery] = useState(query);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  function navigate(next: {
    readonly query: string;
    readonly chainId: number | null;
    readonly verifiedOnly: boolean;
    readonly x402Only: boolean;
    readonly mppOnly: boolean;
  }) {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (
      next.query === query &&
      next.chainId === chainId &&
      next.verifiedOnly === verifiedOnly &&
      next.x402Only === x402Only &&
      next.mppOnly === mppOnly
    ) {
      return;
    }
    startTransition(() => {
      router.push(buildAgentsIndexHref(next), { scroll: false });
    });
  }

  function onSearchChange(value: string) {
    setDraftQuery(value);
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const nextQuery = value.trim();
      if (nextQuery === query) return;
      navigate({
        query: nextQuery,
        chainId,
        verifiedOnly,
        x402Only,
        mppOnly,
      });
    }, SEARCH_DEBOUNCE_MS);
  }

  const filtersActive =
    Boolean(query) || chainId != null || verifiedOnly || x402Only || mppOnly;
  const orderedChains = [...chains].sort((left, right) => {
    if (left.chainId === AGENTRANKING_NATIVE_CHAIN_ID) return -1;
    if (right.chainId === AGENTRANKING_NATIVE_CHAIN_ID) return 1;
    return right.agentCount - left.agentCount || left.shortName.localeCompare(right.shortName);
  });

  return (
    <div className={cn("space-y-3", isPending && "opacity-70")}>
      <div className="relative min-w-0">
        <svg
          viewBox="0 0 24 24"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3-3" />
        </svg>
        <input
          type="search"
          value={draftQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search agents"
          maxLength={80}
          autoComplete="off"
          aria-label="Search agents"
          className="h-10 w-full rounded-lg border border-border/60 bg-[var(--app-inset)] pl-9 pr-9 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-border"
        />
        {draftQuery ? (
          <button
            type="button"
            onClick={() => {
              setDraftQuery("");
              navigate({ query: "", chainId, verifiedOnly, x402Only, mppOnly });
            }}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 text-xs"
            aria-label="Clear search"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <FilterIsland aria-label="Chain" scroll>
          <FilterChip
            active={chainId == null}
            onClick={() =>
              navigate({ query: draftQuery.trim(), chainId: null, verifiedOnly, x402Only, mppOnly })
            }
          >
            All
          </FilterChip>
          {orderedChains.map((chain) => (
            <FilterChip
              key={chain.chainId}
              active={chainId === chain.chainId}
              title={chain.name}
              onClick={() =>
                navigate({
                  query: draftQuery.trim(),
                  chainId: chainId === chain.chainId ? null : chain.chainId,
                  verifiedOnly,
                  x402Only,
                  mppOnly,
                })
              }
            >
              {chain.shortName}
              <span className={cn("tabular-nums", activeTone(chainId === chain.chainId))}>
                {countFormatter.format(chain.agentCount)}
              </span>
            </FilterChip>
          ))}
        </FilterIsland>

        <FilterIsland aria-label="Signals">
          <FilterChip
            active={verifiedOnly}
            onClick={() =>
              navigate({
                query: draftQuery.trim(),
                chainId,
                verifiedOnly: !verifiedOnly,
                x402Only,
                mppOnly,
              })
            }
          >
            Verified
          </FilterChip>
          <FilterChip
            active={x402Only}
            onClick={() =>
              navigate({
                query: draftQuery.trim(),
                chainId,
                verifiedOnly,
                x402Only: !x402Only,
                mppOnly,
              })
            }
          >
            x402
          </FilterChip>
          <FilterChip
            active={mppOnly}
            onClick={() =>
              navigate({
                query: draftQuery.trim(),
                chainId,
                verifiedOnly,
                x402Only,
                mppOnly: !mppOnly,
              })
            }
          >
            MPP
          </FilterChip>
        </FilterIsland>

        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setDraftQuery("");
              navigate({ query: "", chainId: null, verifiedOnly: false, x402Only: false, mppOnly: false });
            }}
            className="text-muted-foreground hover:text-foreground h-8 shrink-0 px-1 text-xs"
          >
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}

function activeTone(active: boolean): string {
  return active ? "opacity-70" : "opacity-50";
}
