"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  VirtualPaymentCard,
  type VirtualPaymentCardDetails,
} from "@/components/treasury/virtual-payment-card";

type CardResponse = {
  configured: boolean;
  message?: string;
  error?: string;
  card: {
    pan: string;
    cvv: string;
    expiry: string;
    last4?: string;
    cardholderName: string;
    amountDollars: number;
    expiresAt: string;
    status: string;
  } | null;
  activeRequest?: {
    id: string;
    last4: string | null;
    canReveal: boolean;
  } | null;
  readiness?: {
    spendReady: boolean;
    identityRequired: boolean;
    identityUrl: string | null;
    messages: string[];
    limits: { remainingDollars: number } | null;
  };
};

export function AgentCardDashboardPanel() {
  const [data, setData] = useState<CardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("50");
  const [credentials, setCredentials] = useState<VirtualPaymentCardDetails | null>(
    null,
  );

  const loadCard = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch("/api/dashboard/agentcard/card", { signal });
    const body = (await res.json()) as CardResponse;
    if (!res.ok) throw new Error(body.error ?? "Failed to load card");
    setData(body);
    if (body.card) {
      setCredentials({
        pan: body.card.pan,
        cvv: body.card.cvv,
        expiry: body.card.expiry,
        last4: body.card.last4,
        cardholderName: body.card.cardholderName,
        amountDollars: body.card.amountDollars,
      });
    }
    return body;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void loadCard(controller.signal)
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : "Failed to load");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    });
    return () => controller.abort();
  }, [loadCard]);

  async function issueCard() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/agentcard/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountDollars: Number(amount) }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.identityUrl) {
          throw new Error(`${body.error} Complete KYC first.`);
        }
        throw new Error(body.error ?? "Issue failed");
      }
      setCredentials({
        pan: body.card.pan,
        cvv: body.card.cvv,
        expiry: body.card.expiry,
        last4: body.card.last4,
        cardholderName: body.card.cardholderName,
        amountDollars: body.amountDollars,
      });
      await loadCard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Issue failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[260px] items-center justify-center">
        <VirtualPaymentCard details={null} loading />
      </div>
    );
  }

  const configured = data?.configured ?? false;
  const readiness = data?.readiness;

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-md border border-red-300/40 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex justify-center py-2">
        <VirtualPaymentCard
          details={credentials}
          maskedLast4={data?.activeRequest?.last4}
          loading={busy}
        />
      </div>

      {!configured ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Waiting for AgentCard login</p>
          <p className="mt-1 text-xs">
            Platform AgentCard is not connected yet. An operator needs to run{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              agentcard signup
            </code>
            , then{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">pnpm agentcard:wire</code>{" "}
            and restart the server. Once wired, every agent on this account can use Tier 1 spend
            tools.
          </p>
        </div>
      ) : (
        <>
          {readiness?.identityUrl ? (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                <a
                  href={readiness.identityUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Complete KYC
                  <ExternalLink className="ml-1 size-3" />
                </a>
              </Button>
            </div>
          ) : null}

          {!credentials && readiness?.messages?.length ? (
            <ul className="space-y-1 text-center text-xs text-muted-foreground">
              {readiness.messages.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-end justify-center gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Amount (USD)</span>
              <input
                type="number"
                min={1}
                max={150}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="block w-28 rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <Button
              type="button"
              disabled={busy || !readiness?.spendReady}
              onClick={() => void issueCard()}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  Issuing…
                </>
              ) : (
                "Issue card"
              )}
            </Button>
          </div>

          {readiness?.limits ? (
            <p className="text-center text-[11px] text-muted-foreground">
              ${readiness.limits.remainingDollars.toFixed(2)} daily remaining · max $150/card
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
