"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyArTokenMetrics, type ArTokenMetricsView } from "@/lib/ar-token-metrics";
import { AdminTable, Field } from "./admin-ui";
import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import { useSourceDraft } from "@/hooks/use-source-draft";
function referralBonusLabel(code: Readonly<{ bonusEligible: boolean; paidVerifiedAgentBoost: boolean }>): string {
  if (code.bonusEligible) return "Eligible";
  if (code.paidVerifiedAgentBoost) return "Boosted";
  return "—";
}
export function AdminReferralsTab({ initialMetrics }: { readonly initialMetrics: ArTokenMetricsView }) {
  const metricsQuery = useQuery({
    queryKey: adminKeys.arToken(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/admin/ar-token", { credentials: "include", signal });
      const payload = (await response.json()) as ArTokenMetricsView & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load");
      return payload;
    },
    initialData: initialMetrics,
    refetchOnMount: false,
  });
  const { data: loadedMetrics, isLoading: loading } = metricsQuery;
  const metricsSource = loadedMetrics ?? emptyArTokenMetrics();
  const [metrics, setMetrics] = useSourceDraft(JSON.stringify(metricsSource), metricsSource);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    ownerWallet: "",
    amount: "1",
    reason: "Manual referral adjustment",
    adminNote: "",
  });
  async function saveAdjustment() {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "adjust_referral", ...form }),
      });
      const data = (await res.json()) as ArTokenMetricsView & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      setMetrics(data);
      setFeedback("Referral adjustment saved.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSaving(false);
    }
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading referrals…
      </div>
    );
  }
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Referrals</h2>
        <p className="text-sm text-muted-foreground">
          Manual adjustments and anti-spam reviewed referral counts. Five qualified referrals unlock a small bonus flag.
        </p>
      </div>
      {feedback && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{feedback}</div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Referral code" value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} />
        <Field label="Owner wallet" value={form.ownerWallet} onChange={(v) => setForm((f) => ({ ...f, ownerWallet: v }))} />
        <Field label="Adjustment amount" value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
        <Field label="Reason" value={form.reason} onChange={(v) => setForm((f) => ({ ...f, reason: v }))} />
      </div>
      <Button onClick={() => void saveAdjustment()} disabled={saving}>
        Save referral adjustment
      </Button>
      <AdminTable headers={["Code", "Owner", "Qualified", "Pending", "Bonus"]}>
        {metrics.referrals.codes.map((code) => (
          <tr key={code.id} className="border-b border-border/50">
            <td className="py-2 font-mono text-xs">/r/{code.code}</td>
            <td className="py-2 font-mono text-xs">{code.ownerWallet}</td>
            <td className="py-2">{code.qualifiedCount + code.manualAdjust}</td>
            <td className="py-2">{code.pendingCount}</td>
            <td className="py-2">{referralBonusLabel(code)}</td>
          </tr>
        ))}
      </AdminTable>
    </section>
  );
}
