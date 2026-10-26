"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  Copy,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import { showToast } from "@/components/ui/toast-simple";
import { Button } from "@/components/ui/button";
import type { X402MarketListing } from "@/lib/x402-market/types";
import {
  searchX402MarketAction,
  type X402MarketSearchActionResult,
} from "@/lib/x402-market/search-action";
type SearchStatus = "idle" | "loading" | "results" | "empty" | "error";
function statusLabel(status: SearchStatus, submittedQuery: string): string {
  if (status === "loading") return `Searching for “${submittedQuery}”…`;
  if (submittedQuery) return `Results for “${submittedQuery}”`;
  return "Search to discover x402 services";
}
const PLACEHOLDER = "image generation, ETH price, weather";
async function copyPayPrompt(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Pay prompt copied");
  } catch {
    showToast("Copy failed", "error");
  }
}
function ListingCard({ listing }: { readonly listing: X402MarketListing }) {
  const host = (() => {
    try {
      return new URL(listing.openHref).hostname.replace(/^www\./, "");
    } catch {
      return listing.owner;
    }
  })();
  return (
    <article className="ui-overview-panel flex flex-col rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">{listing.title}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{host}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-semibold text-foreground tabular-nums">
          {listing.price.replace(" / call", "")}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
        {listing.summary}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-border bg-[#272727] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {listing.sourceLabel}
        </span>
        {listing.tags.slice(0, 3).map((tag) => (
          <span
            key={`${listing.id}-${tag}`}
            className="rounded-full border border-border bg-[#272727] px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="flex-1 rounded-full"
          onClick={() => void copyPayPrompt(listing.payPrompt)}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy pay prompt
        </Button>
        <Button size="sm" variant="outline" className="rounded-full" asChild>
          <Link href={listing.openHref} target="_blank" rel="noopener noreferrer">
            Open
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </article>
  );
}
function ListingSkeleton() {
  return (
    <div className="ui-overview-panel rounded-xl p-4 animate-pulse">
      <div className="h-4 w-2/3 rounded bg-muted" />
      <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
      <div className="mt-4 h-10 w-full rounded bg-muted" />
      <div className="mt-4 h-8 w-full rounded bg-muted" />
    </div>
  );
}
export function X402MarketClient({
  initialQuery,
  initialListings,
  initialMeta,
  initialError,
}: {
  readonly initialQuery: string;
  readonly initialListings: X402MarketListing[];
  readonly initialMeta: X402MarketSearchActionResult["meta"] | null;
  readonly initialError: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [listings, setListings] = useState<X402MarketListing[]>(initialListings);
  const [total, setTotal] = useState(initialMeta?.total ?? 0);
  const [status, setStatus] = useState<SearchStatus>(
    initialError
      ? "error"
      : initialQuery
        ? initialListings.length > 0
          ? "results"
          : "empty"
        : "idle",
  );
  const [error, setError] = useState(initialError);
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      showToast("Enter a search term to browse services", "info");
      return;
    }
    setSubmittedQuery(trimmed);
    const params = new URLSearchParams({ q: trimmed });
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setStatus("loading");
    setError("");
    void (async () => {
      const result = await searchX402MarketAction(trimmed);
      if (result.error) {
        setStatus("error");
        setError(result.error);
        setListings([]);
        setTotal(0);
        return;
      }
      setListings(result.data);
      setTotal(result.meta.total);
      if (result.data.length === 0) {
        setStatus("empty");
        setError("");
        return;
      }
      setStatus("results");
      setError("");
    })();
  };
  const handleClear = () => {
    setQuery("");
    setSubmittedQuery("");
    setListings([]);
    setTotal(0);
    setStatus("idle");
    setError("");
    router.replace(pathname, { scroll: false });
  };
  const showIdleState = status === "idle";
  const showLoading = status === "loading";
  const showResults = status === "results" || status === "empty" || status === "error";
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <section className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity flex items-start gap-3 px-4 py-3.5 sm:px-5">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
            <Store className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">x402 Market</h1>
              <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Pay per call
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Search paid APIs your agent can call with its wallet. Copy pay prompts and open
                services instantly.
            </p>
          </div>
        </div>
        <div className="ui-overview-panel-header px-4 py-3.5 sm:px-5">
          <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={PLACEHOLDER}
                disabled={showLoading}
                className="h-10 w-full rounded-full border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground/50 disabled:opacity-60"
              />
            </label>
            <div className="flex gap-2">
              {submittedQuery ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={handleClear}
                  disabled={showLoading}
                >
                  <X className="h-4 w-4" />
                  Clear
                </Button>
              ) : null}
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="min-w-[7.5rem] rounded-full"
                disabled={showLoading || !query.trim()}
              >
                {showLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {showLoading ? "Searching…" : "Search"}
              </Button>
            </div>
          </form>
        </div>
      </section>
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>{statusLabel(status, submittedQuery)}</span>
        {status === "results" ? <span>{total} listings</span> : null}
      </div>
      {error ? (
        <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </div>
      ) : null}
      {showIdleState ? (
        <div className="mt-8 rounded-xl border border-border bg-[#212121] px-4 py-6 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">Search the x402 directory</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try weather, ETH price, or image generation to find pay-per-call APIs.
          </p>
        </div>
      ) : null}
      {showLoading ? (
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <ListingSkeleton key={`sk-${i}`} />
          ))}
        </section>
      ) : null}
      {showResults && listings.length > 0 ? (
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </section>
      ) : null}
      {status === "empty" ? (
        <div className="mt-8 rounded-xl border border-border bg-[#212121] px-4 py-6 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">No matching services</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try broader terms like weather, ETH price, or image generation.
          </p>
        </div>
      ) : null}
    </div>
  );
}