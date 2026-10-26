"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type Agent = { id: number; name: string };

type IssuanceState = {
  feeCents: number;
  currency: string;
  devBypassActive: boolean;
  requiresPayment: boolean;
  canAfford: boolean;
};

type Balance = {
  availableUsdcCents: number;
};

type CardIssuancePanelProps = {
  onIssued?: () => void;
  className?: string;
  embedded?: boolean;
};

export function CardIssuancePanel({
  onIssued,
  className,
  embedded = false,
}: CardIssuancePanelProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [issuance, setIssuance] = useState<IssuanceState | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState("25");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [agentsRes, cardsRes] = await Promise.all([
      fetch("/api/wallet/agents", { signal }),
      fetch("/api/cards", { signal }),
    ]);
    const agentsBody = await agentsRes.json();
    const cardsBody = await cardsRes.json();
    if (!agentsRes.ok) throw new Error(agentsBody.error ?? "Failed to load agents");
    if (!cardsRes.ok) throw new Error(cardsBody.error ?? "Failed to load card state");

    const list = (agentsBody.agents ?? []) as Agent[];
    setAgents(list);
    setIssuance(cardsBody.issuance ?? null);
    setBalance(cardsBody.balance ?? null);
    setSelectedAgentId((current) => {
      if (current != null && list.some((a) => a.id === current)) return current;
      return list[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      void refresh(controller.signal).catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      });
    });
    return () => controller.abort();
  }, [refresh]);

  async function fundWallet() {
    setBusy(true);
    setError(null);
    try {
      const cents = Math.round(Number(fundAmount) * 100);
      const res = await fetch("/api/wallet/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: cents, autoConfirm: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Funding failed");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding failed");
    } finally {
      setBusy(false);
    }
  }

  async function issueCard() {
    if (selectedAgentId == null) {
      setError("Select an agent to attach this card to");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cards/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: selectedAgentId }),
      });
      const body = await res.json();
      if (res.status === 402) {
        setError(body.error ?? "Add USDC to your card balance before issuing");
        await refresh();
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Card issuance failed");
      onIssued?.();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Card issuance failed");
    } finally {
      setBusy(false);
    }
  }

  const feeCents = issuance?.feeCents ?? 0;
  const needsFunding =
    issuance?.requiresPayment && issuance.canAfford === false && balance != null;

  return (
    <section
      className={cn(
        embedded ? "space-y-4" : "ui-panel ui-panel--stack space-y-4",
        className,
      )}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Issue payment card</h2>
        <p className="text-sm text-muted-foreground">
          Pay once to issue a shared virtual card for your account. Your agent spends from this
          card under your policies — agents never hold the card directly.
        </p>
      </div>

      {issuance?.devBypassActive ? (
        <p className="rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          Dev bypass active — issuance fee waived locally via{" "}
          <code className="text-[11px]">CARD_ISSUANCE_DEV_BYPASS</code>.
        </p>
      ) : issuance?.requiresPayment ? (
        <p className="text-sm">
          Issuance fee: <span className="font-semibold tabular-nums">{formatUsd(feeCents)}</span>{" "}
          USDC
        </p>
      ) : null}

      {agents.length === 0 ? (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Create an agent first, then return here to issue a card for it.</p>
          <Button asChild size="sm" variant="secondary">
            <Link href="/dashboard/agents/new">Create agent</Link>
          </Button>
        </div>
      ) : (
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Agent</span>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedAgentId ?? ""}
            onChange={(e) => setSelectedAgentId(Number(e.target.value) || null)}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {balance && issuance?.requiresPayment ? (
        <p className="text-xs text-muted-foreground">
          Available balance:{" "}
          <span className="tabular-nums">{formatUsd(balance.availableUsdcCents)}</span>
        </p>
      ) : null}

      {needsFunding ? (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <p className="text-sm text-muted-foreground">
            Fund your card balance before issuing. You need at least {formatUsd(feeCents)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="number"
              min={1}
              step={1}
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              className="w-28 rounded-md border bg-background px-3 py-2 text-sm"
            />
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void fundWallet()}>
              {busy ? "Funding…" : "Fund USDC"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-300/40 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <Button
        type="button"
        disabled={busy || agents.length === 0 || selectedAgentId == null || needsFunding}
        onClick={() => void issueCard()}
      >
        {busy
          ? "Issuing…"
          : issuance?.requiresPayment
            ? `Pay ${formatUsd(feeCents)} & issue card`
            : "Issue card"}
      </Button>
    </section>
  );
}
