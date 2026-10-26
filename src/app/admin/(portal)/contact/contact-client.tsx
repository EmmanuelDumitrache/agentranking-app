"use client";
import { useState, useCallback } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import { Mail, CheckCircle, Clock, Tag, Send, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  AdminContactResponse as ResponseData,
  AdminInquiryReplyDto as InquiryReply,
} from "@/lib/admin/identity/types";
import { adminContactResourceKey, type AdminContactQuery } from "@/lib/admin/identity/query";
function replyBannerText(n: { emailSent: boolean; emailError?: string }): string {
  if (n.emailSent) return "Reply saved and email sent to the customer.";
  if (n.emailError) return `Reply saved. Email could not be sent: ${n.emailError}`;
  return "Reply saved. Email could not be sent.";
}
export function AdminContactClient({
  initialData,
  initialQuery,
}: {
  readonly initialData: ResponseData;
  readonly initialQuery: AdminContactQuery;
}) {
  const [page, setPage] = useState(initialQuery.page);
  const [filter, setFilter] = useState<"all" | "open" | "resolved" | "dashboard">(
    initialQuery.dashboardOnly ? "dashboard" : initialQuery.status,
  );
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyNotice, setReplyNotice] = useState<{ inquiryId: number; emailSent: boolean; emailError?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const loadInquiries = useCallback(async (signal: AbortSignal): Promise<ResponseData> => {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(initialQuery.perPage),
    });
    if (filter === "dashboard") params.set("dashboardOnly", "true");
    else if (filter === "open" || filter === "resolved") params.set("status", filter);
    const response = await fetch(`/api/admin/contact-inquiries?${params}`, { signal });
    const json = (await response.json()) as ResponseData & { error?: string };
    if (!response.ok) throw new Error(json.error ?? `Could not load inquiries (${response.status}).`);
    if (!Array.isArray(json.inquiries)) throw new Error("Server returned an invalid response.");
    return json;
  }, [filter, initialQuery.perPage, page]);
  const currentQuery = {
    page,
    perPage: initialQuery.perPage,
    status: filter === "dashboard" ? "all" as const : filter,
    dashboardOnly: filter === "dashboard",
  };
  const resourceKey = adminContactResourceKey(currentQuery);
  const initialResourceKey = adminContactResourceKey(initialQuery);
  const queryClient = useQueryClient();
  const inquiriesQuery = useQuery({
    queryKey: adminKeys.contactInquiries(),
    queryFn: ({ signal }) => loadInquiries(signal),
    initialData: resourceKey === initialResourceKey ? initialData : undefined,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  });
  const data = inquiriesQuery.data;
  const loading = inquiriesQuery.isPending;
  const fetchError = inquiriesQuery.error?.message ?? null;
  const setInquiryData = (updater: ResponseData | ((current: ResponseData | undefined) => ResponseData | undefined)) =>
    queryClient.setQueryData<ResponseData>(
      adminKeys.contactInquiries(),
      (current) =>
        typeof updater === "function"
          ? (updater as (c: ResponseData | undefined) => ResponseData | undefined)(current)
          : updater,
    );
  async function resolve(id: number) {
    setResolvingId(id);
    try {
      await fetch(`/api/admin/contact-inquiries/${id}/resolve`, { method: "POST" });
      setInquiryData((prev) =>
        prev
          ? {
              ...prev,
              inquiries: prev.inquiries.map((i) => (i.id === id ? { ...i, status: "resolved" } : i)),
            }
          : prev
      );
    } finally {
      setResolvingId(null);
    }
  }
  async function sendReply(inquiryId: number) {
    const text = (replyDrafts[inquiryId] ?? "").trim();
    if (!text) return;
    setReplyingId(inquiryId);
    setReplyNotice(null);
    try {
      const res = await fetch(`/api/admin/contact-inquiries/${inquiryId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        reply?: InquiryReply;
        emailSent?: boolean;
        emailError?: string;
        error?: string;
      };
      if (!res.ok || !json.reply) {
        setReplyNotice({
          inquiryId,
          emailSent: false,
          emailError: json.error ?? "Failed to send reply.",
        });
        return;
      }
      setInquiryData((prev) =>
        prev
          ? {
              ...prev,
              inquiries: prev.inquiries.map((i) =>
                i.id === inquiryId ? { ...i, replies: [...(i.replies ?? []), json.reply!] } : i
              ),
            }
          : prev
      );
      setReplyDrafts((d) => ({ ...d, [inquiryId]: "" }));
      setReplyNotice({
        inquiryId,
        emailSent: Boolean(json.emailSent),
        emailError: json.emailSent ? undefined : json.emailError,
      });
    } finally {
      setReplyingId(null);
    }
  }
  async function markAdminRead(inquiryId: number) {
    try {
      await fetch(`/api/admin/contact-inquiries/${inquiryId}/read`, { method: "PATCH" });
      setInquiryData((prev) =>
        prev
          ? {
              ...prev,
              inquiries: prev.inquiries.map((i) =>
                i.id === inquiryId
                  ? { ...i, replies: (i.replies ?? []).map((r) => ({ ...r, readByAdmin: true })) }
                  : i
              ),
            }
          : prev
      );
    } catch {
      // non-blocking
    }
  }
  async function deleteInquiry(id: number) {
    setDeletingId(id);
    setConfirmDeleteId(null);
    try {
      await fetch(`/api/admin/contact-inquiries/${id}`, { method: "DELETE" });
      setInquiryData((prev) =>
        prev
          ? {
              ...prev,
              inquiries: prev.inquiries.filter((i) => i.id !== id),
              total: prev.total - 1,
            }
          : prev
      );
      if (expanded === id) setExpanded(null);
    } finally {
      setDeletingId(null);
    }
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Mail className="size-6" />
          Contact &amp; Support
        </h1>
        <span className="text-sm text-muted-foreground">{data?.total ?? 0} total</span>
      </div>
      {fetchError && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {fetchError}
        </div>
      )}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["all", "open", "resolved", "dashboard"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className="rounded-full capitalize text-xs"
          >
            {f === "dashboard" ? "Dashboard Tickets" : f}
          </Button>
        ))}
      </div>
      {loading && <div className="text-muted-foreground text-sm">Loading…</div>}
      {!loading && data?.inquiries?.length === 0 && (
        <p className="text-muted-foreground text-sm">No inquiries found.</p>
      )}
      {!loading && (data?.inquiries?.length ?? 0) > 0 && data && (
        <div className="space-y-2">
          {data.inquiries.map((inquiry) => {
            const isOpen = !inquiry.status || inquiry.status === "open";
            const isDashboard = Boolean(inquiry.userId);
            const isExpanded = expanded === inquiry.id;
            const replies = inquiry.replies ?? [];
            const replyCount = replies.length;
            const hasUnreadFromUser = replies.some((r) => r.authorRole === "user" && r.readByAdmin === false);
            return (
              <div
                key={inquiry.id}
                className={cn(
                  "rounded-lg border p-4 space-y-3 transition-colors",
                  isOpen ? "border-border bg-card" : "border-border/50 bg-muted/20 opacity-70"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{inquiry.subject || "(no subject)"}</span>
                      {isDashboard && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded">
                          <Tag className="h-2.5 w-2.5" /> DASHBOARD
                        </span>
                      )}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border",
                          isOpen
                            ? "bg-amber-400/10 text-amber-400 border-amber-400/20"
                            : "bg-green-400/10 text-green-400 border-green-400/20"
                        )}
                      >
                        {isOpen ? <Clock className="h-2.5 w-2.5" /> : <CheckCircle className="h-2.5 w-2.5" />}
                        {isOpen ? "Open" : "Resolved"}
                      </span>
                      {replyCount > 0 && (
                        <span className={cn(
                          "text-[10px] font-medium border rounded px-1.5 py-0.5",
                          hasUnreadFromUser
                            ? "text-amber-400 border-amber-400/30 bg-amber-400/10"
                            : "text-muted-foreground border-border"
                        )}>
                          {hasUnreadFromUser ? "Customer replied" : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
                        </span>
                      )}
                      {hasUnreadFromUser && (
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{inquiry.name}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <a href={`mailto:${inquiry.email}`} className="text-xs text-primary hover:underline">
                        {inquiry.email}
                      </a>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(inquiry.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isOpen && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 rounded-full"
                        disabled={resolvingId === inquiry.id}
                        onClick={() => resolve(inquiry.id)}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Resolve
                      </Button>
                    )}
                    {confirmDeleteId === inquiry.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="text-xs h-7 rounded-full"
                          disabled={deletingId === inquiry.id}
                          onClick={() => deleteInquiry(inquiry.id)}
                        >
                          {deletingId === inquiry.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Confirm"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7 rounded-full"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-7 rounded-full text-muted-foreground hover:text-destructive"
                        disabled={deletingId === inquiry.id}
                        onClick={() => setConfirmDeleteId(inquiry.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7 rounded-full"
                      onClick={() => {
                        const opening = expanded !== inquiry.id;
                        setExpanded(opening ? inquiry.id : null);
                        if (opening) void markAdminRead(inquiry.id);
                      }}
                    >
                      {isExpanded ? "Less" : "More"}
                    </Button>
                  </div>
                </div>
                <p
                  className={cn(
                    "text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap",
                    !isExpanded && "line-clamp-2"
                  )}
                >
                  {inquiry.message}
                </p>
                {isExpanded && (
                  <div className="space-y-3 pt-1 border-t border-border/60">
                    {replies.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Thread
                        </p>
                        {replies.map((r) => (
                          <div
                            key={r.id}
                            className={cn(
                              "rounded-md border px-3 py-2 text-xs",
                              r.authorRole === "admin"
                                ? "border-primary/25 bg-primary/5 ml-0 mr-4"
                                : "border-border bg-muted/30 ml-4 mr-0"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-semibold text-foreground">
                                {r.authorRole === "admin" ? "Team" : "Customer"}
                              </span>
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {new Date(r.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">{r.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        Reply to customer
                      </p>
                      <Textarea
                        placeholder="Write a reply… It will be saved and emailed to the address on this ticket."
                        value={replyDrafts[inquiry.id] ?? ""}
                        onChange={(e) => setReplyDrafts((d) => ({ ...d, [inquiry.id]: e.target.value }))}
                        className="min-h-[100px] text-sm"
                        disabled={replyingId === inquiry.id}
                      />
                      {replyNotice?.inquiryId === inquiry.id && (
                        <p
                          className={cn(
                            "text-xs",
                            replyNotice.emailSent ? "text-green-400" : "text-amber-400"
                          )}
                        >
                          {replyBannerText(replyNotice)}
                        </p>
                      )}
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={
                          replyingId === inquiry.id ||
                          !(replyDrafts[inquiry.id] ?? "").trim()
                        }
                        onClick={() => sendReply(inquiry.id)}
                      >
                        {replyingId === inquiry.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Send reply
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {data && data.totalPages > 1 && (
        <div className="flex items-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {data.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
