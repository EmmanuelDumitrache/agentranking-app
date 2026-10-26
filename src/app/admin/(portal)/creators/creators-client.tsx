"use client";
import { useCallback, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import { useDebounce } from "@/hooks/use-debounce";
import Link from "next/link";
import { format } from "date-fns";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Coins,
  Loader2,
  RefreshCw,
  Search,
  UserCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminTable } from "@/app/admin/(portal)/ar-token/admin-ui";
import { cn } from "@/lib/utils";
import type {
  AdminCreatorsResponse as CreatorsResponse,
} from "@/lib/admin/identity/types";
import { adminCreatorsResourceKey, type AdminCreatorsQuery } from "@/lib/admin/identity/query";
const PROVIDER_FILTERS = [
  { id: "all", label: "All sign-in" },
  { id: "google", label: "Google" },
  { id: "credentials", label: "Email" },
  { id: "wallet", label: "Wallet" },
] as const;
function ProviderBadges({ providers }: { readonly providers: string[] }) {
  if (providers.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {providers.map((p) => (
        <span
          key={p}
          className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {p === "google" ? "Google" : p === "credentials" ? "Email" : p}
        </span>
      ))}
    </div>
  );
}
export function AdminCreatorsClient({
  initialData,
  initialQuery,
}: {
  readonly initialData: CreatorsResponse;
  readonly initialQuery: AdminCreatorsQuery;
}) {
  const [page, setPage] = useState(initialQuery.page);
  const [search, setSearch] = useState(initialQuery.search);
  const debouncedSearch = useDebounce(search, 350);
  const [provider, setProvider] = useState(initialQuery.provider);
  const loadCreators = useCallback(async (signal: AbortSignal): Promise<CreatorsResponse> => {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(initialQuery.perPage),
      search: debouncedSearch,
      provider,
    });
    const response = await fetch(`/api/admin/creators?${params}`, {
      credentials: "include",
      signal,
    });
    if (!response.ok) throw new Error("Failed to load creators");
    return (await response.json()) as CreatorsResponse;
  }, [debouncedSearch, initialQuery.perPage, page, provider]);
  const resourceKey = adminCreatorsResourceKey({
    page,
    perPage: initialQuery.perPage,
    provider,
    search: debouncedSearch,
  });
  const initialResourceKey = adminCreatorsResourceKey(initialQuery);
  const queryClient = useQueryClient();
  const creatorsQuery = useQuery({
    queryKey: adminKeys.creators({ page, perPage: initialQuery.perPage, query: debouncedSearch || undefined, status: provider }),
    queryFn: ({ signal }) => loadCreators(signal),
    initialData: resourceKey === initialResourceKey ? initialData : undefined,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  });
  const data = creatorsQuery.data;
  const loading = creatorsQuery.isPending;
  const error = creatorsQuery.error?.message ?? "";
  const refreshCreators = () => queryClient.invalidateQueries({ queryKey: adminKeys.creators({ query: debouncedSearch || undefined }) });
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Creators</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live dashboard accounts — Google sign-in, agents, and token launches.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refreshCreators}>
          <RefreshCw className={cn("mr-1.5 size-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search email, name, wallet…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setProvider(f.id);
                setPage(1);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                provider === f.id
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" />
          Loading creators…
        </div>
      ) : (
        <>
          <AdminTable
            headers={[
              "Creator",
              "Sign-in",
              "Agents",
              "Tokens",
              "Credits",
              "Last login",
              "Joined",
              "",
            ]}
          >
            {(data?.creators ?? []).map((row) => (
              <tr key={row.id} className="border-b border-border/60 hover:bg-muted/20">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserCircle2 className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{row.displayName ?? "Unnamed"}</p>
                      <p className="text-xs text-muted-foreground truncate">{row.email ?? "—"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <ProviderBadges providers={row.authProviders} />
                </td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-1 text-sm tabular-nums">
                    <Bot className="size-3.5 text-muted-foreground" />
                    {row.agentCount}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-1 text-sm tabular-nums">
                    <Coins className="size-3.5 text-muted-foreground" />
                    {row.tokenizedCount}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">
                  {row.platformCredits + row.llmCredits}
                  <span className="block text-[10px]">
                    P{row.platformCredits} · L{row.llmCredits}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {row.lastLoginAt ? format(new Date(row.lastLoginAt), "MMM d, yyyy") : "—"}
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(row.createdAt), "MMM d, yyyy")}
                </td>
                <td className="px-3 py-3 text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/creators/${row.id}`}>Open</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </AdminTable>
          {data && data.creators.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">No creators match your filters.</p>
          ) : null}
          {data && data.totalPages > 1 ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {data.page} of {data.totalPages} · {data.total} creators
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
