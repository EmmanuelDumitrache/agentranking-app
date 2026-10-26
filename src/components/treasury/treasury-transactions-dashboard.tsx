"use client";

import { useState } from "react";
import { useTreasuryTransactions } from "@/components/treasury/treasury-query-hooks";

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function TreasuryTransactionsDashboard() {
  const [merchant, setMerchant] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const { data, error } = useTreasuryTransactions({ merchant, status, category });
  const items = data?.items ?? [];
  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : "Failed to load"
    : null;

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-medium">Filter transactions</h2>
        </div>
        <div className="ui-settings-panel-body grid gap-3 sm:grid-cols-3">
          <input
            placeholder="Merchant"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            className="ui-card-input"
          />
          <input
            placeholder="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="ui-card-input"
          />
          <input
            placeholder="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="ui-card-input"
          />
        </div>
      </section>

      {errorMessage ? <div className="ui-card-alert ui-card-alert--error">{errorMessage}</div> : null}

      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-medium">Activity</h2>
        </div>
        <ul className="divide-y divide-border/60">
          {items.length === 0 ? (
            <li className="ui-settings-panel-body text-sm text-muted-foreground">
              No matching transactions.
            </li>
          ) : (
            items.map((tx) => (
              <li
                key={tx.id}
                className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {tx.type} · {tx.status}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[tx.merchant, tx.category, tx.agent?.name].filter(Boolean).join(" · ") ||
                      new Date(tx.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className="shrink-0 tabular-nums">{formatUsd(tx.amountCents)}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
