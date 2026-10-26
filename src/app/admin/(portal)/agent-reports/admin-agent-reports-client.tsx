"use client";
import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { adminKeys } from "@/lib/query-keys/admin";
export type AdminAgentReportRow = {
  id: string;
  chainId: number;
  onChainAgentId: number;
  pageUrl: string;
  category: string;
  details: string;
  status: string;
  adminNotes: string;
  createdAt: string;
  agent: { id: number; name: string; chainId: number; agentId: number; profilePath: string } | null;
};
export type AdminAgentReportsInitialData = {
  reports: AdminAgentReportRow[];
  total: number;
};

export function AdminAgentReportsClient({
  initialData,
  initialPage,
  initialStatus,
}: {
  readonly initialData: AdminAgentReportsInitialData;
  readonly initialPage: number;
  readonly initialStatus: "all" | "open" | "reviewed" | "dismissed";
}) {
  const [page, setPage] = useState(initialPage);
  const perPage = 25;
  const [status, setStatus] = useState<"all" | "open" | "reviewed" | "dismissed">(initialStatus);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [patching, setPatching] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading: loading, error } = useQuery({
    queryKey: adminKeys.agentReports({ page, status, perPage }),
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (status !== "all") query.set("status", status);
      const response = await fetch(`/api/admin/agent-reports?${query}`, { signal });
      const payload = (await response.json()) as {
        reports?: AdminAgentReportRow[];
        total?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? `Failed (${response.status})`);
      return { reports: payload.reports ?? [], total: payload.total ?? 0 };
    },
    initialData: page === initialPage && status === initialStatus ? initialData : undefined,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  });
  const reports = data?.reports ?? [];
  const total = data?.total ?? 0;
  const patchMutation = useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { status?: string; adminNotes?: string };
    }) => {
      const res = await fetch(`/api/admin/agent-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Update failed");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.agentReports() });
    },
    onError: (e) => {
      setMutationError(e instanceof Error ? e.message : "Update failed");
    },
  });
  function patchReport(id: string, body: { status?: string; adminNotes?: string }) {
    setPatching(id);
    patchMutation.mutate(
      { id, body },
      {
        onSettled: () => setPatching(null),
      },
    );
  }
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return (
    <div className="container max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Agent reports</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Public submissions from agent detail pages. Links open the live listing.
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        {(["open", "all", "reviewed", "dismissed"] as const).map((s) => (
          <Button
            key={s}
            variant={status === s ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setPage(1);
              setStatus(s);
            }}
          >
            {s === "all" ? "All" : s}
          </Button>
        ))}
      </div>
      {(mutationError ?? error?.message) && (
        <p className="text-sm text-red-400 mb-4">{mutationError ?? error?.message}</p>
      )}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : reports.length === 0 ? (
        <p className="text-muted-foreground">No reports for this filter.</p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => {
            const profilePath = r.agent?.profilePath ?? null;
            return (
              <div key={r.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">
                      {r.agent?.name ?? "Unknown agent"}{" "}
                      <span className="text-muted-foreground font-normal">
                        · {r.category} · {r.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(r.createdAt).toLocaleString()} · chain {r.chainId} · agent #{r.onChainAgentId}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={profilePath ?? r.pageUrl} target="_blank" rel="noreferrer" className="gap-1">
                        <ExternalLink className="h-3 w-3" /> Listing
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={patching === r.id || r.status === "reviewed"}
                      onClick={() =>
                        void patchReport(r.id, {
                          status: "reviewed",
                          adminNotes: notesDraft[r.id] ?? r.adminNotes,
                        })
                      }
                    >
                      Mark reviewed
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={patching === r.id || r.status === "dismissed"}
                      onClick={() => void patchReport(r.id, { status: "dismissed" })}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
                {r.pageUrl ? (
                  <p className="text-[11px] text-muted-foreground truncate mt-1" title={r.pageUrl}>
                    URL: {r.pageUrl}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="text-xs text-primary mt-2 hover:underline"
                  onClick={() => setExpanded((x) => (x === r.id ? null : r.id))}
                >
                  {expanded === r.id ? "Hide details" : "Show details"}
                </button>
                {expanded === r.id && (
                  <div className="mt-2 space-y-2">
                    <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-2 border border-border max-h-48 overflow-y-auto">
                      {r.details}
                    </pre>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Admin notes</label>
                      <Textarea
                        className="mt-1 min-h-[72px]"
                        value={notesDraft[r.id] ?? r.adminNotes}
                        onChange={(e) => setNotesDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                        placeholder="Internal notes (saved with Mark reviewed)"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-6">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
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
    </div>
  );
}
