"use client";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  emptyArTokenMetrics,
  type ArPayoutBatchView,
  type ArTokenMetricsView,
  type ArTokenPerkConfigView,
} from "@/lib/ar-token-metrics";
import { getSolanaWalletProvider } from "@/lib/ar-token-ledger";
import { AdminTable, Field } from "./admin-ui";
import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import { useSourceDraft } from "@/hooks/use-source-draft";
function exportBatch(batch: ArPayoutBatchView) {
  const blob = new Blob([JSON.stringify(batch.recipients, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${batch.title.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}-${batch.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
export function AdminPayoutsTab({ initialMetrics }: { readonly initialMetrics: ArTokenMetricsView }) {
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
  const [perks, setPerks] = useSourceDraft<ArTokenPerkConfigView[]>(
    JSON.stringify(metricsSource.perks),
    metricsSource.perks ?? [],
  );
  const [saving, setSaving] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [payoutWalletForm, setPayoutWalletForm] = useState({
    label: "Rewards wallet",
    wallet: "",
    asset: "SOL",
    purpose: "rewards",
  });
  const initialPerkSlug = metricsSource.perks[0]?.slug ?? "";
  const [payoutBatchForm, setPayoutBatchForm] = useSourceDraft(initialPerkSlug, {
    title: "Draft holder reward batch",
    perkSlug: initialPerkSlug,
    asset: "AR",
    amountMode: "fixed",
    amountValue: "0",
    adminNotes: "",
  });
  async function postAction(action: string, body: Record<string, unknown>, okMessage: string) {
    setSaving(action);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, ...body }),
      });
      const data = (await res.json()) as ArTokenMetricsView & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      setMetrics(data);
      setPerks(data.perks ?? []);
      setFeedback(okMessage);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSaving("");
    }
  }
  async function connectPayoutWallet() {
    const provider = getSolanaWalletProvider();
    if (!provider) {
      setFeedback("No Solana wallet provider found in this browser.");
      return;
    }
    try {
      const res = await provider.connect();
      setPayoutWalletForm((form) => ({ ...form, wallet: res.publicKey.toBase58() }));
      setFeedback("Wallet connected. Review and save it as a payout wallet.");
    } catch {
      setFeedback("Wallet connection cancelled.");
    }
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading payouts…
      </div>
    );
  }
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Payout prep</h2>
        <p className="text-sm text-muted-foreground">
          Create exportable recipient batches. No private keys or in-app transfers are stored in this MVP.
        </p>
      </div>
      {feedback && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{feedback}</div>
      )}
      <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
        <h3 className="font-semibold">Treasury / rewards wallet</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Label" value={payoutWalletForm.label} onChange={(v) => setPayoutWalletForm((f) => ({ ...f, label: v }))} />
          <Field label="Wallet" value={payoutWalletForm.wallet} onChange={(v) => setPayoutWalletForm((f) => ({ ...f, wallet: v }))} />
          <Field label="Asset" value={payoutWalletForm.asset} onChange={(v) => setPayoutWalletForm((f) => ({ ...f, asset: v }))} />
          <Field label="Purpose" value={payoutWalletForm.purpose} onChange={(v) => setPayoutWalletForm((f) => ({ ...f, purpose: v }))} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void connectPayoutWallet()}>
            Connect wallet
          </Button>
          <Button
            onClick={() => postAction("save_payout_wallet", payoutWalletForm, "Payout wallet saved.")}
            disabled={saving === "save_payout_wallet"}
          >
            Save payout wallet
          </Button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
        <h3 className="font-semibold">Draft payout batch</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Title" value={payoutBatchForm.title} onChange={(v) => setPayoutBatchForm((f) => ({ ...f, title: v }))} />
          <div className="space-y-1.5">
            <Label>Perk filter</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={payoutBatchForm.perkSlug}
              onChange={(e) => setPayoutBatchForm((f) => ({ ...f, perkSlug: e.target.value }))}
            >
              {perks.map((perk) => (
                <option key={perk.slug} value={perk.slug}>
                  {perk.title}
                </option>
              ))}
            </select>
          </div>
          <Field label="Amount per wallet" value={payoutBatchForm.amountValue} onChange={(v) => setPayoutBatchForm((f) => ({ ...f, amountValue: v }))} />
        </div>
        <Button
          onClick={() => postAction("create_payout_batch", payoutBatchForm, "Draft payout batch created.")}
          disabled={saving === "create_payout_batch"}
        >
          Create draft batch
        </Button>
      </div>
      <AdminTable headers={["Batch", "Asset", "Recipients", "Total", "Export"]}>
        {metrics.payout.batches.map((batch) => (
          <tr key={batch.id} className="border-b border-border/50">
            <td className="py-2">
              {batch.title}
              <p className="text-xs text-muted-foreground">{batch.status}</p>
            </td>
            <td className="py-2">{batch.asset}</td>
            <td className="py-2">{batch.recipientCount}</td>
            <td className="py-2">{batch.totalAmount}</td>
            <td className="py-2">
              <Button size="sm" variant="outline" onClick={() => exportBatch(batch)}>
                <Download className="mr-1 size-3" />
                JSON
              </Button>
            </td>
          </tr>
        ))}
      </AdminTable>
    </section>
  );
}
