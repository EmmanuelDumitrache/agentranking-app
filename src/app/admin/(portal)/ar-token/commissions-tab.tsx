"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle, XCircle, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { adminKeys } from "@/lib/query-keys/admin";
export interface AdminCommissionDto {
  id: string;
  code: string;
  referrerWallet: string;
  referredWallet: string;
  referredEmail: string;
  orderNumber: string;
  productLabel: string;
  productType: string;
  orderUsd: number;
  commissionPct: number;
  commissionUsd: number;
  status: string;
  paidAt: string | null;
  adminNote: string;
  createdAt: string;
}
export interface AdminCommissionTotalsDto {
  pendingUsd: number;
  approvedUsd: number;
  paidUsd: number;
}
type StatusFilter = "all" | "pending" | "approved" | "paid" | "rejected";
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  approved: "bg-blue-500/10 text-blue-400 border-blue-500/25",
  paid: "bg-green-500/10 text-green-400 border-green-500/25",
  rejected: "bg-red-500/10 text-red-400 border-red-500/25",
};
function StatusBadge({ status }: Readonly<{ status: string }>) {
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border", STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-border")}>
      {status}
    </span>
  );
}
export function AdminCommissionsTab({ initialData }: {
  readonly initialData: { commissions: AdminCommissionDto[]; totals: AdminCommissionTotalsDto };
}) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [updating, setUpdating] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const commissionsQuery = useQuery({
    queryKey: adminKeys.arTokenCommissions(filter),
    queryFn: async ({ signal }) => {
      const response = await fetch(
        filter === "all"
          ? "/api/admin/ar-token/commissions"
          : `/api/admin/ar-token/commissions?status=${encodeURIComponent(filter)}`,
        { credentials: "include", signal },
      );
      const data = (await response.json()) as { commissions?: AdminCommissionDto[]; totals?: AdminCommissionTotalsDto; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load commissions");
      return {
        commissions: data.commissions ?? [],
        totals: data.totals ?? { pendingUsd: 0, approvedUsd: 0, paidUsd: 0 },
      };
    },
    initialData: filter === "all" ? initialData : undefined,
    refetchOnMount: false,
  });
  const commissions = commissionsQuery.data?.commissions ?? [];
  const totals = commissionsQuery.data?.totals ?? { pendingUsd: 0, approvedUsd: 0, paidUsd: 0 };
  const loading = commissionsQuery.isPending;
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.arTokenCommissions() });
  async function updateStatus(id: string, status: string) {
    setUpdating(id);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token/commissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, status, adminNote: noteInputs[id] ?? "" }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setFeedback(`Commission ${id.slice(0, 8)}… marked as ${status}.`);
        refresh();
      } else {
        setFeedback(data.error ?? "Update failed");
      }
    } catch {
      setFeedback("Update failed");
    } finally {
      setUpdating(null);
    }
  }
  const FILTERS: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "all" },
    { label: "Pending", value: "pending" },
    { label: "Approved", value: "approved" },
    { label: "Paid", value: "paid" },
    { label: "Rejected", value: "rejected" },
  ];
  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Referral Commissions</h2>
        <p className="text-sm text-muted-foreground">
          Who referred who, what product they converted on, and how much they&apos;re owed. Mark approved commissions as paid after you transfer $AR to their wallet.
        </p>
      </div>
      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Pending", usd: totals.pendingUsd, style: "text-amber-400" },
          { label: "Approved", usd: totals.approvedUsd, style: "text-blue-400" },
          { label: "All-time paid", usd: totals.paidUsd, style: "text-green-400" },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-border bg-muted/20 px-4 py-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{t.label}</p>
            <p className={cn("text-xl font-bold", t.style)}>${t.usd.toFixed(2)}</p>
          </div>
        ))}
      </div>
      {feedback && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{feedback}</div>
      )}
      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold border transition-colors",
              filter === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="size-4 animate-spin" />
          Loading commissions…
        </div>
      )}
      {!loading && commissions.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">No commissions found.</p>
      )}
      {!loading && commissions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                {["Date", "Code", "Referrer wallet", "Referred", "Product", "Order $", "Commission $", "Status", "Note", "Actions"].map((h) => (
                  <th key={h} className="py-2.5 px-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20 align-top">
                  <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs text-amber-400">/r/{c.code}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground max-w-[140px] truncate" title={c.referrerWallet}>
                    {c.referrerWallet.slice(0, 10)}…{c.referrerWallet.slice(-6)}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground max-w-[140px] truncate"
                    title={c.referredEmail || c.referredWallet}
                  >
                    {(() => {
                      if (c.referredEmail) return c.referredEmail.replace(/(.{3}).+(@.+)/, "$1…$2");
                      if (c.referredWallet) return `${c.referredWallet.slice(0, 6)}…${c.referredWallet.slice(-4)}`;
                      return "—";
                    })()}
                  </td>
                  <td className="py-2.5 px-3 text-xs font-medium">{c.productLabel}</td>
                  <td className="py-2.5 px-3 text-xs">${c.orderUsd.toFixed(2)}</td>
                  <td className="py-2.5 px-3 text-xs font-semibold text-amber-400">
                    ${c.commissionUsd.toFixed(2)}
                    <span className="text-muted-foreground font-normal ml-1">({Math.round(c.commissionPct * 100)}%)</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <StatusBadge status={c.status} />
                    {c.paidAt && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(c.paidAt).toLocaleDateString()}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <input
                      type="text"
                      placeholder="Admin note…"
                      value={noteInputs[c.id] ?? c.adminNote}
                      onChange={(e) => setNoteInputs((n) => ({ ...n, [c.id]: e.target.value }))}
                      className="w-28 rounded border border-border bg-background px-2 py-1 text-[10px]"
                    />
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-col gap-1">
                      {c.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 text-blue-400 border-blue-500/25 hover:bg-blue-500/5"
                          disabled={updating === c.id}
                          onClick={() => void updateStatus(c.id, "approved")}
                        >
                          {updating === c.id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle className="size-3 mr-1" />}
                          Approve
                        </Button>
                      )}
                      {c.status === "approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 text-green-400 border-green-500/25 hover:bg-green-500/5"
                          disabled={updating === c.id}
                          onClick={() => void updateStatus(c.id, "paid")}
                        >
                          {updating === c.id ? <Loader2 className="size-3 animate-spin" /> : <DollarSign className="size-3 mr-1" />}
                          Mark paid
                        </Button>
                      )}
                      {(c.status === "pending" || c.status === "approved") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 text-red-400 border-red-500/25 hover:bg-red-500/5"
                          disabled={updating === c.id}
                          onClick={() => void updateStatus(c.id, "rejected")}
                        >
                          {updating === c.id ? <Loader2 className="size-3 animate-spin" /> : <XCircle className="size-3 mr-1" />}
                          Reject
                        </Button>
                      )}
                      {(c.status === "paid" || c.status === "rejected") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2"
                          disabled={updating === c.id}
                          onClick={() => void updateStatus(c.id, "pending")}
                        >
                          Reopen
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
