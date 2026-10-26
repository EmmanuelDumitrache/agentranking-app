"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import type {
  AdminVerificationRequestsResponse as ListResponse,
} from "@/lib/admin/identity/types";
import {
  adminVerificationRequestsResourceKey,
  type AdminVerificationRequestsQuery,
} from "@/lib/admin/identity/query";
export function AdminVerificationRequestsClient({
  initialData,
  initialQuery,
}: {
  readonly initialData: ListResponse;
  readonly initialQuery: AdminVerificationRequestsQuery;
}) {
  const [filter, setFilter] = useState<"open" | "all">(
    initialQuery.status === "all" ? "all" : "open",
  );
  const [page, setPage] = useState(initialQuery.page);
  const [actingId, setActingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const fetchList = useCallback(async (signal: AbortSignal) => {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(initialQuery.perPage),
    });
    params.set("status", filter === "open" ? "submitted,in_review" : "all");
    const response = await fetch(`/api/admin/verification-requests?${params}`, { signal });
    const payload = (await response.json()) as ListResponse;
    if (!response.ok) throw new Error(payload.error ?? `Failed (${response.status})`);
    return payload;
  }, [filter, initialQuery.perPage, page]);
  const currentStatus = filter === "open" ? "submitted,in_review" : "all";
  const resourceKey = adminVerificationRequestsResourceKey({
    page,
    perPage: initialQuery.perPage,
    status: currentStatus,
  });
  const initialResourceKey = adminVerificationRequestsResourceKey(initialQuery);
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: adminKeys.verificationRequests({ page, perPage: initialQuery.perPage, status: currentStatus }),
    queryFn: ({ signal }) => fetchList(signal),
    initialData: resourceKey === initialResourceKey ? initialData : undefined,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  });
  const data = listQuery.data;
  const loading = listQuery.isPending;
  const error = listQuery.error;
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.verificationRequests() });
  async function patchAction(id: string, action: string) {
    setActingId(id);
    try {
      const res = await fetch(`/api/admin/verification-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reviewerNote: notes[id]?.trim() ?? "",
          ...(action === "approve" ? { paymentStatus: "manual" } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? "Action failed");
        return;
      }
      refresh();
    } finally {
      setActingId(null);
    }
  }
  return (
    <div className="space-y-6 p-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Verification requests</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manual review queue — approve sets verified badge and premium flags.
        </p>
      </div>
      <div className="flex gap-2">
        {(["open", "all"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
          >
            {f === "open" ? "Open" : "All"}
          </Button>
        ))}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : !data?.requests.length ? (
        <p className="text-sm text-muted-foreground">No requests in this view.</p>
      ) : (
        <div className="space-y-4">
          {data.requests.map((row) => (
            <article
              key={row.id}
              className="rounded-xl border border-border bg-card p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{row.agentName}</h2>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {row.xHandle} · {row.walletAddress.slice(0, 10)}…
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Status: {row.verificationStatus} · payment: {row.paymentStatus}
                    {row.agentIsPremiumVerified ? " · already premium" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Submitted {new Date(row.submittedAt).toLocaleString()}
                  </p>
                </div>
                <Link
                  href={row.profilePath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Profile
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              </div>
              {row.proofNotes ? (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap border-t border-border/50 pt-3">
                  {row.proofNotes}
                </p>
              ) : null}
              <Textarea
                placeholder="Reviewer note (optional)"
                value={notes[row.id] ?? row.reviewerNote ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                rows={2}
                className="text-sm"
              />
              <div className="flex flex-wrap gap-2">
                {row.verificationStatus === "submitted" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actingId === row.id}
                    onClick={() => void patchAction(row.id, "mark_in_review")}
                  >
                    Mark in review
                  </Button>
                ) : null}
                {row.verificationStatus !== "verified" && row.verificationStatus !== "rejected" ? (
                  <>
                    <Button
                      size="sm"
                      disabled={actingId === row.id}
                      onClick={() => void patchAction(row.id, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={actingId === row.id}
                      onClick={() => void patchAction(row.id, "reject")}
                    >
                      Reject
                    </Button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
          {data.totalPages > 1 ? (
            <div className="flex items-center gap-2 justify-center pt-4">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {data.totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}