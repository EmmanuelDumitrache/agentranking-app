"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArCardPanel } from "@/components/treasury/ar-card-panel";
import { treasuryKeys } from "@/lib/query-keys/treasury";
import { useTreasuryCards } from "@/components/treasury/treasury-query-hooks";

export function TreasuryCardDashboard() {
  const queryClient = useQueryClient();
  const { data, error } = useTreasuryCards();
  const hasCard = Boolean(data?.card);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const cardAction = useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(path, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed");
    },
    onMutate: () => setBusy(true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: treasuryKeys.cards(),
      });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Request failed");
    },
    onSettled: () => setBusy(false),
  });

  const errorMessage =
    actionError ??
    (error ? (error instanceof Error ? error.message : "Failed to load card") : null);

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      {errorMessage ? (
        <div className="ui-card-alert ui-card-alert--error">{errorMessage}</div>
      ) : null}

      <ArCardPanel className="px-0 py-0" />

      {hasCard ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header flex items-center justify-between gap-3 px-5 py-4">
            <h2 className="text-sm font-medium">Quick controls</h2>
            <Link
              href="/dashboard/card"
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Overview
            </Link>
          </div>
          <div className="ui-settings-panel-body">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => cardAction.mutate("/api/cards/freeze")}
              >
                Freeze card
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => cardAction.mutate("/api/cards/unfreeze")}
              >
                Unfreeze card
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}