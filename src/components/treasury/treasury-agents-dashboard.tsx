"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { treasuryKeys } from "@/lib/query-keys/treasury";
import {
  useTreasuryAgentTransactions,
  useTreasuryWalletAgents,
} from "@/components/treasury/treasury-query-hooks";

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function TreasuryAgentsDashboard() {
  const queryClient = useQueryClient();
  const { data: agentsData } = useTreasuryWalletAgents();
  const agents = agentsData?.agents ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  const { data: transactionsData } = useTreasuryAgentTransactions(selected, 5);
  const summary = transactionsData?.summary ?? null;
  const [amount, setAmount] = useState("5");
  const [merchant, setMerchant] = useState("api.example.com");
  const [category, setCategory] = useState("api_credits");
  const [reason, setReason] = useState("Agent API top-up");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function spend() {
    if (selected == null) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/treasury/agents/${selected}/spend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountCents: Math.round(Number(amount) * 100),
          merchant,
          category,
          reason,
        }),
      });
      const body = await res.json();
      if (res.status === 403 && body.rejected) {
        setError((body.reasons as string[] | undefined)?.join("; ") ?? "Spend rejected");
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Spend failed");
      setMessage(`Spend settled: ${formatUsd(body.transaction?.amountCents ?? 0)}`);
      await queryClient.invalidateQueries({
        queryKey: treasuryKeys.agentTransactions(selected, 5),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spend failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      {error ? <div className="ui-card-alert ui-card-alert--error">{error}</div> : null}
      {message ? <div className="ui-card-alert ui-card-alert--success">{message}</div> : null}

      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-medium">Your agents</h2>
        </div>
        <div className="ui-settings-panel-body space-y-3">
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agents linked to this account yet. Create an agent in the dashboard first.
            </p>
          ) : (
            <ul className="space-y-2">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(agent.id)}
                    className={cn(
                      "ui-card-select-row",
                      selected === agent.id && "ui-card-select-row--active",
                    )}
                  >
                    <span>{agent.name}</span>
                    <span className="text-xs text-muted-foreground">#{agent.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {summary && selected != null ? (
            <p className="text-sm text-muted-foreground">
              Spent {formatUsd(summary.totalSpentCents)} across {summary.spendCount} transactions
            </p>
          ) : null}
        </div>
      </section>

      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-medium">Simulate agent spend</h2>
        </div>
        <div className="ui-settings-panel-body space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-xs">
              <span className="font-medium uppercase tracking-wide text-muted-foreground">
                Amount (USD)
              </span>
              <input
                className="ui-card-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-xs">
              <span className="font-medium uppercase tracking-wide text-muted-foreground">
                Category
              </span>
              <input
                className="ui-card-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-xs sm:col-span-2">
              <span className="font-medium uppercase tracking-wide text-muted-foreground">
                Merchant
              </span>
              <input
                className="ui-card-input"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-xs sm:col-span-2">
              <span className="font-medium uppercase tracking-wide text-muted-foreground">
                Reason
              </span>
              <input
                className="ui-card-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || selected == null}
            onClick={() => void spend()}
          >
            {busy ? "Submitting…" : "Request spend"}
          </Button>
        </div>
      </section>
    </div>
  );
}
