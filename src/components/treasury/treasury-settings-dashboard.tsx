"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { treasuryKeys } from "@/lib/query-keys/treasury";
import {
  useTreasuryPolicies,
  type TreasuryPolicy,
} from "@/components/treasury/treasury-query-hooks";

export function TreasurySettingsDashboard() {
  const queryClient = useQueryClient();
  const { data, error } = useTreasuryPolicies();
  const policy = data?.policy ?? null;
  const [form, setForm] = useState<TreasuryPolicy | null>(null);
  const [allowed, setAllowed] = useState("");
  const [blocked, setBlocked] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queryErrorMessage = error
    ? error instanceof Error
      ? error.message
      : "Failed to load policy"
    : null;
  const displayError = queryErrorMessage ?? errorMessage;

  useEffect(() => {
    if (policy && !form) {
      const initialPolicy = policy;
      queueMicrotask(() => {
        setForm(initialPolicy);
        setAllowed(initialPolicy.allowedCategories.join(", "));
        setBlocked(initialPolicy.blockedCategories.join(", "));
      });
    }
  }, [policy, form]);

  const saveMutation = useMutation({
    mutationFn: async (draft: TreasuryPolicy) => {
      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dailyLimitCents: draft.dailyLimitCents,
          weeklyLimitCents: draft.weeklyLimitCents,
          monthlyLimitCents: draft.monthlyLimitCents,
          allowManualUsage: draft.allowManualUsage,
          allowAgentUsage: draft.allowAgentUsage,
          allowedCategories: allowed
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          blockedCategories: blocked
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      return body as { policy: TreasuryPolicy };
    },
    onSuccess: (body) => {
      queryClient.setQueryData<{ policy: TreasuryPolicy }>(
        treasuryKeys.policies(),
        { policy: body.policy },
      );
      setForm(body.policy);
      setMessage("Policy saved");
      setErrorMessage(null);
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : "Save failed");
    },
  });

  function save() {
    if (!form) return;
    setMessage(null);
    saveMutation.mutate(form);
  }

  if (!policy || !form) {
    return (
      <div className="ui-dashboard-overview mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 text-sm text-muted-foreground">
        {displayError ?? "Loading policy…"}
      </div>
    );
  }

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      {displayError ? <div className="ui-card-alert ui-card-alert--error">{displayError}</div> : null}
      {message ? <div className="ui-card-alert ui-card-alert--success">{message}</div> : null}

      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-medium">Spending policies</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Limits and category rules for card usage across your workspace.
          </p>
        </div>
        <div className="ui-settings-panel-body space-y-4">
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Daily limit (cents)
            </span>
            <input
              type="number"
              className="ui-card-input"
              value={form.dailyLimitCents}
              onChange={(e) =>
                setForm({ ...form, dailyLimitCents: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Weekly limit (cents)
            </span>
            <input
              type="number"
              className="ui-card-input"
              value={form.weeklyLimitCents}
              onChange={(e) =>
                setForm({ ...form, weeklyLimitCents: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Monthly limit (cents)
            </span>
            <input
              type="number"
              className="ui-card-input"
              value={form.monthlyLimitCents}
              onChange={(e) =>
                setForm({ ...form, monthlyLimitCents: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Allowed categories (comma-separated; empty = all)
            </span>
            <input
              className="ui-card-input"
              value={allowed}
              onChange={(e) => setAllowed(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Blocked categories (comma-separated)
            </span>
            <input
              className="ui-card-input"
              value={blocked}
              onChange={(e) => setBlocked(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={form.allowManualUsage}
              onCheckedChange={(checked) =>
                setForm({ ...form, allowManualUsage: checked === true })
              }
            />
            Allow manual card usage
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={form.allowAgentUsage}
              onCheckedChange={(checked) =>
                setForm({ ...form, allowAgentUsage: checked === true })
              }
            />
            Allow agent spending
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saveMutation.isPending}
            onClick={() => save()}
          >
            {saveMutation.isPending ? "Saving…" : "Save policy"}
          </Button>
        </div>
      </section>
    </div>
  );
}
