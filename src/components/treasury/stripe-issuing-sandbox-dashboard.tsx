"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AgentOption = { id: number; name: string };

type IssuingState = {
  card: {
    id: string;
    lastFour: string;
    brand: string;
    status: string;
    riskTier: string;
    dailyLimitCents: number;
    stripeCardId: string;
    authorizations: Array<{
      id: string;
      amountCents: number;
      approved: boolean;
      declineReason: string | null;
      merchantName: string | null;
      createdAt: string;
    }>;
  } | null;
  risk: {
    eligible: boolean;
    maxDailyLimitUsd: number;
    riskTier: string | null;
    riskScore: number | null;
    reasons: string[];
  };
};

export function StripeIssuingSandboxDashboard() {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState("");
  const [state, setState] = useState<IssuingState | null>(null);
  const [purchaseCents, setPurchaseCents] = useState("2500");
  const [topUpCents, setTopUpCents] = useState("10000");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/wallet/agents")
      .then((r) => r.json())
      .then((data: { agents?: AgentOption[] }) => {
        const list = data.agents ?? [];
        setAgents(list);
        if (list[0]) setAgentId(String(list[0].id));
      })
      .catch(() => setAgents([]));
  }, []);

  const loadState = useCallback(async (id: string, signal?: AbortSignal) => {
    if (!id) return;
    const res = await fetch(`/api/stripe/issuing/agents/${id}`, { signal });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load state");
      setState(null);
      return;
    }
    setState(data as IssuingState);
  }, []);

  useEffect(() => {
    if (!agentId) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadState(agentId, controller.signal).catch((err) => {
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : "Failed to load state");
          }
        });
      }
    });
    return () => controller.abort();
  }, [agentId, loadState]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const selectedAgent = agents.find((a) => String(a.id) === agentId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stripe Issuing Sandbox</h1>
        <p className="text-sm text-muted-foreground">
          Test-mode fiat Issuing — issue per-agent virtual cards, top up balance, and simulate
          purchases against oracle tier limits.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent</CardTitle>
          <CardDescription>Select an owned agent with a verification passport.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-select">Agent</Label>
            <select
              id="agent-select"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={agentId}
              onChange={(e) => {
                setError(null);
                setAgentId(e.target.value);
              }}
            >
              {agents.length === 0 ? (
                <option value="">No agents</option>
              ) : (
                agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (#{a.id})
                  </option>
                ))
              )}
            </select>
          </div>

          {state && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Tier:</span>{" "}
                {state.risk.riskTier ?? "—"} ·{" "}
                <span className="text-muted-foreground">Limit:</span> $
                {state.risk.maxDailyLimitUsd}/day
              </p>
              <p>
                <span className="text-muted-foreground">Eligible:</span>{" "}
                {state.risk.eligible ? "yes" : "no"}
                {!state.risk.eligible && state.risk.reasons.length > 0 && (
                  <span className="text-muted-foreground"> — {state.risk.reasons.join("; ")}</span>
                )}
              </p>
              {state.card ? (
                <p>
                  <span className="text-muted-foreground">Card:</span> {state.card.brand} ••••{" "}
                  {state.card.lastFour} ({state.card.status})
                </p>
              ) : (
                <p className="text-muted-foreground">No Stripe card issued for this agent yet.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !agentId}
              onClick={() =>
                run(async () => {
                  const res = await fetch(`/api/stripe/issuing/agents/${agentId}/issue`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ displayName: selectedAgent?.name }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error ?? "Issue failed");
                  setMessage(data.created ? "Card issued" : "Card already exists");
                  await loadState(agentId);
                })
              }
            >
              Issue virtual card
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => agentId && loadState(agentId)}
            >
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Issuing balance (test)</CardTitle>
          <CardDescription>
            Funds the platform Issuing balance via Stripe test helpers ($
            {(Number(topUpCents) / 100).toFixed(2)} default).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="topup-cents">Amount (cents)</Label>
            <Input
              id="topup-cents"
              value={topUpCents}
              onChange={(e) => setTopUpCents(e.target.value)}
              className="w-40"
            />
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const res = await fetch("/api/stripe/issuing/top-up", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ amountCents: Number(topUpCents) }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? "Top-up failed");
                setMessage(`Topped up ${data.amountCents} cents to Issuing balance`);
              })
            }
          >
            Top up balance
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Simulate purchase</CardTitle>
          <CardDescription>
            Creates a test authorization via Stripe test helpers. If webhooks are configured,
            approve/decline follows oracle tier limits.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="purchase-cents">Amount (cents)</Label>
            <Input
              id="purchase-cents"
              value={purchaseCents}
              onChange={(e) => setPurchaseCents(e.target.value)}
              className="w-40"
            />
          </div>
          <Button
            disabled={busy || !agentId || !state?.card}
            onClick={() =>
              run(async () => {
                const res = await fetch(`/api/stripe/issuing/agents/${agentId}/simulate`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ amountCents: Number(purchaseCents) }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? "Simulation failed");
                setMessage(`Test authorization ${data.authorizationId} created`);
                await loadState(agentId);
              })
            }
          >
            Simulate test purchase
          </Button>
        </CardContent>
      </Card>

      {state?.card?.authorizations && state.card.authorizations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent authorizations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {state.card.authorizations.map((auth) => (
                <li key={auth.id} className="rounded border border-border/50 px-3 py-2">
                  <span className={auth.approved ? "text-green-600" : "text-red-600"}>
                    {auth.approved ? "Approved" : "Declined"}
                  </span>
                  {" · "}${(auth.amountCents / 100).toFixed(2)}
                  {auth.merchantName ? ` · ${auth.merchantName}` : ""}
                  {auth.declineReason ? ` — ${auth.declineReason}` : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {message && <p className="text-sm text-green-600">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
