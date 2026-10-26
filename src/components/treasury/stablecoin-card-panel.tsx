"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  VirtualPaymentCard,
  type VirtualPaymentCardDetails,
} from "@/components/treasury/virtual-payment-card";
import { cn } from "@/lib/utils";

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatUsdAmount(dollars: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(dollars);
}

type Agent = { id: number; name: string };

type WalletConfig = {
  fundingProvider: string;
  cardIssuerProvider: string;
  brand: string;
  issuance: {
    feeCents: number;
    devBypassActive: boolean;
    requiresPayment: boolean;
  };
  kripicard: {
    configured: boolean;
    defaultCurrency: string;
    defaultNetwork: string;
    minCardUsd: number;
    minFundUsd: number;
    minDepositUsd: number;
  };
};

type AgentCard = {
  id: string;
  lastFour: string;
  brand: string;
  status: string;
  balanceUsd?: number;
};

type DepositInstructions = {
  intentId: string;
  payAddress: string;
  payAmount: string;
  payCurrency: string;
  network: string;
  creditedOnCompletionUsd?: number;
  expiresAt?: string;
};

export type StablecoinCardPanelInitialData = {
  agents: Agent[];
  config: WalletConfig;
  treasuryCents: number;
  selectedAgentId: number | null;
  agentCard: AgentCard | null;
};

export function StablecoinCardPanel({
  className,
  initialData,
}: {
  className?: string;
  initialData?: StablecoinCardPanelInitialData;
}) {
  const [agents, setAgents] = useState<Agent[]>(initialData?.agents ?? []);
  const [config, setConfig] = useState<WalletConfig | null>(initialData?.config ?? null);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(
    initialData?.selectedAgentId ?? null,
  );
  const [agentCard, setAgentCard] = useState<AgentCard | null>(initialData?.agentCard ?? null);
  const [cardDetails, setCardDetails] = useState<VirtualPaymentCardDetails | null>(null);
  const [treasuryCents, setTreasuryCents] = useState<number | null>(
    initialData?.treasuryCents ?? null,
  );
  const [fundAmount, setFundAmount] = useState("50");
  const [issueAmount, setIssueAmount] = useState("25");
  const [loadAmount, setLoadAmount] = useState("25");
  const [cardholderName, setCardholderName] = useState("");
  const [deposit, setDeposit] = useState<DepositInstructions | null>(null);
  const [initialLoading, setInitialLoading] = useState(!initialData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const defaultCardholderName = selectedAgent
    ? `AR ${selectedAgent.name}`.slice(0, 64)
    : "AR AGENT";

  const loadAgentCard = useCallback(async (agentId: number, signal?: AbortSignal) => {
    const res = await fetch(`/api/treasury/agents/${agentId}/card`, { signal });
    const body = await res.json();
    if (!res.ok) {
      setAgentCard(null);
      setCardDetails(null);
      return;
    }
    setAgentCard(body.card ?? null);
    if (!body.card) {
      setCardDetails(null);
      return;
    }

    setCardDetails((current) => ({
      pan: current?.pan && current.pan.length > 4 ? current.pan : "",
      cvv: current?.cvv && current.cvv !== "•••" ? current.cvv : "",
      expiry: current?.expiry && current.expiry !== "••/••" ? current.expiry : "••/••",
      cardholderName: defaultCardholderName,
      last4: body.card.lastFour,
      amountDollars: body.card.balanceUsd,
    }));
  }, [defaultCardholderName]);

  const fetchCardCredentials = useCallback(
    async (agentId: number, lastFour?: string | null): Promise<boolean> => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const detailsRes = await fetch(
          `/api/treasury/agents/${agentId}/card?action=details`,
          { method: "POST", signal: controller.signal },
        );
        const detailsBody = await detailsRes.json();
        if (!detailsRes.ok) {
          setError(detailsBody.error ?? "Could not load card credentials");
          return false;
        }

        if (detailsBody.credentials?.pan && detailsBody.credentials?.cvv) {
          setCardDetails({
            pan: detailsBody.credentials.pan,
            cvv: detailsBody.credentials.cvv,
            expiry: detailsBody.credentials.expiry,
            cardholderName: detailsBody.credentials.cardholderName,
            last4: lastFour ?? agentCard?.lastFour,
            amountDollars:
              detailsBody.balanceUsd ??
              detailsBody.credentials.balanceUsd ??
              agentCard?.balanceUsd,
          });
          return true;
        }

        setError("Could not load card credentials");
        return false;
      } catch (err) {
        setError(
          err instanceof Error && err.name === "AbortError"
            ? "Card provider timed out — check KRIPICARD_API_KEY and base URL."
            : err instanceof Error
              ? err.message
              : "Could not load card credentials",
        );
        return false;
      } finally {
        window.clearTimeout(timeout);
      }
    },
    [agentCard],
  );

  const refresh = useCallback(async () => {
    try {
      const [agentsRes, balanceRes, configRes] = await Promise.all([
        fetch("/api/wallet/agents"),
        fetch("/api/wallet/balance"),
        fetch("/api/wallet/config"),
      ]);
      const agentsBody = await agentsRes.json();
      const balanceBody = await balanceRes.json();
      const configBody = await configRes.json();
      if (!agentsRes.ok) throw new Error(agentsBody.error ?? "Failed to load agents");
      if (!balanceRes.ok) throw new Error(balanceBody.error ?? "Failed to load balance");
      if (!configRes.ok) throw new Error(configBody.error ?? "Failed to load config");

      const list = (agentsBody.agents ?? []) as Agent[];
      setAgents(list);
      setTreasuryCents(balanceBody.balance?.availableUsdcCents ?? null);
      setConfig(configBody);

      const nextAgentId =
        selectedAgentId != null && list.some((a) => a.id === selectedAgentId)
          ? selectedAgentId
          : (list[0]?.id ?? null);

      if (nextAgentId !== selectedAgentId) {
        setSelectedAgentId(nextAgentId);
      }

      if (nextAgentId != null) {
        await loadAgentCard(nextAgentId);
      } else {
        setAgentCard(null);
        setCardDetails(null);
      }
    } finally {
      setInitialLoading(false);
    }
  }, [loadAgentCard, selectedAgentId]);

  useEffect(() => {
    if (initialData) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void refresh().catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount + manual refresh only
  }, [initialData]);

  useEffect(() => {
    if (selectedAgentId == null || initialLoading) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadAgentCard(selectedAgentId, controller.signal).catch((err) => {
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : "Failed to load card");
          }
        });
      }
    });
    return () => controller.abort();
  }, [selectedAgentId, initialLoading, loadAgentCard]);

  async function fundTreasury() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setDeposit(null);
    try {
      const cents = Math.round(Number(fundAmount) * 100);
      const res = await fetch("/api/wallet/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountCents: cents,
          autoConfirm: config?.fundingProvider === "mock",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Funding failed");

      if (body.autoConfirmed) {
        setMessage(`Treasury funded ${formatUsd(cents)}`);
        await refresh();
        return;
      }

      const metadata = body.intent?.metadata as Record<string, unknown> | undefined;
      if (metadata?.payAddress) {
        setDeposit({
          intentId: body.intent.id,
          payAddress: String(metadata.payAddress),
          payAmount: String(metadata.payAmount ?? ""),
          payCurrency: String(metadata.payCurrency ?? "USDT"),
          network: String(metadata.network ?? ""),
          creditedOnCompletionUsd:
            typeof metadata.creditedOnCompletionUsd === "number"
              ? metadata.creditedOnCompletionUsd
              : undefined,
          expiresAt:
            typeof body.intent.expiresAt === "string" ? body.intent.expiresAt : undefined,
        });
        setMessage("Send the exact crypto amount below — then check deposit status.");
      } else {
        setMessage("Deposit created — check your treasury balance after payment confirms.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding failed");
    } finally {
      setBusy(false);
    }
  }

  async function checkDepositStatus() {
    if (!deposit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm", intentId: deposit.intentId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Deposit not confirmed yet");
      if (body.intent?.status === "CONFIRMED") {
        setMessage("Deposit confirmed — treasury balance updated.");
        setDeposit(null);
        await refresh();
      } else {
        setMessage("Deposit still pending — send crypto to the address below.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit check failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadCardBalance() {
    if (selectedAgentId == null) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const cents = Math.round(Number(loadAmount) * 100);
      const res = await fetch(`/api/treasury/agents/${selectedAgentId}/fund-ledger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: cents }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Load failed");
      setMessage(body.message ?? `Loaded ${formatUsd(cents)} onto card`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setBusy(false);
    }
  }

  async function issueCard() {
    if (selectedAgentId == null) {
      setError("Select an agent first");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const amountUsd = Number(issueAmount);
      const res = await fetch("/api/cards/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgentId,
          amountUsd,
          displayName: cardholderName.trim() || defaultCardholderName,
        }),
      });
      const body = await res.json();
      if (res.status === 402) {
        setError(body.error ?? "Fund treasury before issuing");
        await refresh();
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Card issuance failed");
      setMessage(`AR virtual card issued with ${formatUsdAmount(amountUsd)} balance.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Card issuance failed");
    } finally {
      setBusy(false);
    }
  }

  const minCardUsd = config?.kripicard?.minCardUsd ?? 10;
  const feeCents = config?.issuance?.feeCents ?? 0;
  const issueAmountCents = Math.round(Number(issueAmount) * 100);
  const treasuryNeeded = issueAmountCents + feeCents;
  const isMock = config?.fundingProvider === "mock";
  const isKripicard =
    config?.fundingProvider === "kripicard" || config?.cardIssuerProvider === "ar";
  const needsFundingForIssue =
    !isKripicard && treasuryCents != null && treasuryCents < treasuryNeeded;
  const hasInlineCredentials = Boolean(cardDetails?.pan && cardDetails?.cvv);
  const canRevealCard = Boolean(agentCard && selectedAgentId != null);

  if (initialLoading) {
    return (
      <div className={cn("space-y-5", className)}>
        <div className="flex min-h-[280px] items-center justify-center">
          <VirtualPaymentCard details={null} loading />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-5", className)}>
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          AgentRanking
        </p>
        <h2 className="text-lg font-semibold">AR Virtual Card</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {isMock
            ? "Demo mode"
            : isKripicard
              ? "Powered by Kripicard · USDT in, fiat spend at merchants"
              : "Crypto in · fiat spend at merchants"}
        </p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <VirtualPaymentCard
          details={cardDetails}
          maskedLast4={agentCard?.lastFour}
          loading={busy}
          onReveal={
            canRevealCard && selectedAgentId != null
              ? async () => fetchCardCredentials(selectedAgentId, agentCard?.lastFour)
              : undefined
          }
        />
        {agentCard ? (
          <p className="text-center text-xs text-muted-foreground">
            {agentCard.brand.toUpperCase()} ·••• {agentCard.lastFour} · {agentCard.status}
            {agentCard.balanceUsd != null
              ? ` · ${formatUsdAmount(agentCard.balanceUsd)} on card`
              : null}
          </p>
        ) : (
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            {isKripicard
              ? "Deposit USDT to your Kripicard account, then issue an AR virtual card for your agent."
              : "Fund your treasury with crypto, then issue an AR virtual card for your agent."}{" "}
            Use it anywhere Visa/Mastercard is accepted.
          </p>
        )}
        {agentCard && canRevealCard && !hasInlineCredentials ? (
          <p className="text-center text-xs text-muted-foreground">
            Tap <strong>Reveal card details</strong> to load your PAN and CVV.
          </p>
        ) : null}
      </div>

      {isKripicard && config?.kripicard && !config.kripicard.configured ? (
        <p className="rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          Set <code className="text-[11px]">KRIPICARD_API_KEY</code> in{" "}
          <code className="text-[11px]">.env.local</code> — copy it from your{" "}
          <a
            href="https://www.kripicard.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Kripicard dashboard
          </a>
          , then restart the dev server.
        </p>
      ) : null}

      {config?.issuance?.devBypassActive ? (
        <p className="rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          Dev mode — issuance fee waived.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-300/40 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-300/40 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {message}
        </div>
      ) : null}

      {deposit ? (
        <div className="space-y-2 rounded-md border border-blue-300/40 bg-blue-50/50 p-3 text-sm dark:bg-blue-950/20">
          <p className="font-medium">Send deposit</p>
          <p className="text-xs text-muted-foreground">
            Send exactly <strong>{deposit.payAmount} {deposit.payCurrency}</strong> on{" "}
            <strong>{deposit.network}</strong>
            {deposit.creditedOnCompletionUsd != null
              ? ` — ~$${deposit.creditedOnCompletionUsd.toFixed(2)} credited after fees`
              : null}
          </p>
          <code className="block break-all rounded bg-background px-2 py-1 text-xs">
            {deposit.payAddress}
          </code>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void checkDepositStatus()}>
            Check deposit status
          </Button>
        </div>
      ) : null}

      {agents.length === 0 ? (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Create an agent first.</p>
          <Button asChild size="sm" variant="secondary">
            <Link href="/dashboard/agents/new">Create agent</Link>
          </Button>
        </div>
      ) : (
        <>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Spending agent</span>
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

          {!agentCard ? (
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Name on card</span>
              <input
                type="text"
                value={cardholderName}
                onChange={(e) => setCardholderName(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder={defaultCardholderName}
                minLength={2}
              />
            </label>
          ) : null}
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-medium">
            {isKripicard ? "1. Fund Kripicard wallet" : "1. Fund treasury"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isKripicard
              ? "Deposits credit your Kripicard account balance"
              : `Available: ${treasuryCents != null ? formatUsd(treasuryCents) : "—"}`}
          </p>
          {isKripicard ? (
            <p className="text-xs text-muted-foreground">
              Local ledger: {treasuryCents != null ? formatUsd(treasuryCents) : "—"}
            </p>
          ) : null}
          <div className="flex gap-2">
            <input
              type="number"
              min={minCardUsd}
              step={1}
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void fundTreasury()}
            >
              {isMock ? "Add demo funds" : isKripicard ? "Deposit USDT" : "Create deposit"}
            </Button>
          </div>
        </div>

        {agentCard ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-medium">Load card balance</p>
            <p className="text-xs text-muted-foreground">
              Min ${config?.kripicard?.minFundUsd ?? 10} · 4% + $1 fee applies at issuer
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                min={minCardUsd}
                step={1}
                value={loadAmount}
                onChange={(e) => setLoadAmount(e.target.value)}
                className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || selectedAgentId == null}
                onClick={() => void loadCardBalance()}
              >
                Load card
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-medium">2. Initial card balance</p>
            <p className="text-xs text-muted-foreground">Min ${minCardUsd}</p>
            <input
              type="number"
              min={minCardUsd}
              step={1}
              value={issueAmount}
              onChange={(e) => setIssueAmount(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
        )}
      </div>

      {!agentCard ? (
        <div className="space-y-2">
          {needsFundingForIssue ? (
            <p className="text-xs text-muted-foreground">
              Need {formatUsd(treasuryNeeded)} in treasury
              {config?.issuance?.requiresPayment ? ` (incl. ${formatUsd(feeCents)} fee)` : ""}.
            </p>
          ) : isKripicard ? (
            <p className="text-xs text-muted-foreground">
              Card balance is charged from your Kripicard account (min ${minCardUsd}).
            </p>
          ) : null}
          <Button
            type="button"
            disabled={
              busy ||
              agents.length === 0 ||
              selectedAgentId == null ||
              needsFundingForIssue ||
              Number(issueAmount) < minCardUsd ||
              (isKripicard && !config?.kripicard?.configured)
            }
            onClick={() => void issueCard()}
          >
            {busy ? "Issuing…" : "Issue AR virtual card"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Card active. Freeze or cancel from{" "}
          <Link href="/dashboard/card/manage" className="underline underline-offset-2">
            Manage
          </Link>
          .
        </p>
      )}
    </div>
  );
}
