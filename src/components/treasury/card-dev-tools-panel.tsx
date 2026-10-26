"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { CreditCard, Loader2, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DevToolsFloatingWidget } from "@/components/dev/dev-tools-floating-widget";
import { showToast } from "@/components/ui/toast-simple";
import { useTreasuryWalletAgents } from "@/components/treasury/treasury-query-hooks";
import type { AccountCard } from "@/components/treasury/ar-card-dashboard";

type AgentOption = { id: number; name: string };

type Props = {
  cards: AccountCard[];
  onChanged: () => Promise<void> | void;
};

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}

export function CardDevToolsPanel({ cards, onChanged }: Props) {
  const { data: agentsData } = useTreasuryWalletAgents();
  const agents: AgentOption[] = (agentsData?.agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
  }));
  const [agentId, setAgentId] = useState<string>("");
  const [cardId, setCardId] = useState<string>("");
  const [amountUsd, setAmountUsd] = useState("12.50");
  const [busy, setBusy] = useState<string | null>(null);

  const activeCards = useMemo(
    () => cards.filter((card) => card.status !== "cancelled"),
    [cards],
  );
  const effectiveCardId = activeCards.some((card) => card.id === cardId)
    ? cardId
    : (activeCards[0]?.id ?? "");
  const effectiveAgentId = agentId || (agents[0] ? String(agents[0].id) : "");

  const runAction = useCallback(
    async (action: "generate" | "cancel" | "simulate-spend", payload: Record<string, unknown>) => {
      setBusy(action);
      try {
        const res = await fetch("/api/cards/dev-tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Dev tools action failed");

        if (action === "generate") {
          const generated = body.generated as
            | { label?: string; amountUsd?: number; displayName?: string }
            | undefined;
          showToast(
            generated?.label
              ? `Issued ${generated.label} · $${generated.amountUsd} for ${generated.displayName}`
              : "Random card issued",
            "success",
          );
        } else if (action === "cancel") {
          showToast("Card cancelled", "success");
        } else {
          const amountCents = Number(body.transaction?.amountCents ?? 0);
          const merchant = body.card?.merchant ?? "merchant";
          showToast(`Simulated ${formatUsd(amountCents)} at ${merchant}`, "success");
        }

        await onChanged();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Dev tools action failed", "error");
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  return (
    <DevToolsFloatingWidget
      title="Card dev"
      subtitle="AR_CARD_DEMO_FLOW=true · local only"
    >
      <div className="space-y-3">
        <label className="block space-y-1.5 text-sm">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Agent
          </span>
          <select
            value={effectiveAgentId}
            onChange={(event) => setAgentId(event.target.value)}
            className="ui-card-input w-full"
          >
            <option value="">Auto-pick</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Card
          </span>
          <select
            value={effectiveCardId}
            onChange={(event) => setCardId(event.target.value)}
            className="ui-card-input w-full"
            disabled={activeCards.length === 0}
          >
            {activeCards.length === 0 ? (
              <option value="">No active cards</option>
            ) : (
              activeCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.nameOnCard ?? "AR card"} · •••• {card.lastFour}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Payment amount (USD)
          </span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amountUsd}
            onChange={(event) => setAmountUsd(event.target.value)}
            className="ui-card-input w-full"
          />
        </label>

        <div className="grid gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full justify-start"
            disabled={busy !== null}
            onClick={() =>
              void runAction("generate", {
                agentId: agentId ? Number(agentId) : undefined,
              })
            }
          >
            {busy === "generate" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <CreditCard className="mr-2 size-4" />
            )}
            Generate random card
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full justify-start"
            disabled={busy !== null || !effectiveCardId}
            onClick={() => void runAction("cancel", { cardId: effectiveCardId })}
          >
            {busy === "cancel" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 size-4" />
            )}
            Cancel card
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full justify-start"
            disabled={busy !== null || !effectiveCardId}
            onClick={() => {
              const parsed = Number.parseFloat(amountUsd);
              const amountCents = Number.isFinite(parsed)
                ? Math.max(1, Math.round(parsed * 100))
                : undefined;
              void runAction("simulate-spend", {
                cardId: effectiveCardId,
                agentId: agentId ? Number(agentId) : undefined,
                amountCents,
              });
            }}
          >
            {busy === "simulate-spend" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Receipt className="mr-2 size-4" />
            )}
            Simulate payment
          </Button>

          <Button asChild type="button" variant="ghost" size="sm" className="w-full justify-start">
            <Link href="/dashboard/card/transactions">View transactions</Link>
          </Button>
        </div>
      </div>
    </DevToolsFloatingWidget>
  );
}
