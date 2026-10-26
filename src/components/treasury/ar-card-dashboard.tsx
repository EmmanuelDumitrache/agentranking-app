"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Eye,
  MoreHorizontal,
  Plus,
  Snowflake,
  TrendingUp,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  KripiIssuerBadge,
} from "@/components/treasury/card-network-marks";
import {
  VirtualPaymentCard,
  VirtualCardThumb,
  type VirtualPaymentCardDetails,
} from "@/components/treasury/virtual-payment-card";
import {
  ArCardPinDialog,
  type ArCardPinDialogMode,
} from "@/components/treasury/ar-card-pin-dialog";
import { showToast } from "@/components/ui/toast-simple";
import {
  getArCardBinOption,
  type ArCardBinOption,
} from "@/lib/agent-payments/providers/card/ar-card-bins";
import { cn } from "@/lib/utils";

type WalletConfig = {
  fundingProvider: string;
  cardIssuerProvider: string;
  oneCardPerAccount?: boolean;
  demoFlow?: boolean;
  bins?: ArCardBinOption[];
  issuance: { devBypassActive: boolean; demoFlowActive?: boolean };
  kripicard: {
    configured: boolean;
    defaultCurrency: string;
    defaultNetwork: string;
    defaultBin?: string;
    minCardUsd: number;
    minFundUsd: number;
  };
};

export type AccountCard = {
  id: string;
  lastFour: string;
  brand: string;
  status: string;
  bin?: string;
  nameOnCard?: string;
  initialAmountUsd?: number;
  balanceUsd?: number;
  pinSet?: boolean;
  createdAt?: string;
};

export type ArCardDashboardInitialData = {
  config: WalletConfig;
  cards: AccountCard[];
};

const CARDS_PER_PAGE = 10;

function formatUsd(dollars: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    dollars,
  );
}

function formatCreatedAt(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 24) {
    if (hours < 1) return "Just now";
    return `${hours}h ago`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function networkFromCard(card: { brand: string; bin?: string }) {
  const brand = card.brand.toLowerCase();
  if (brand.includes("visa")) return "visa" as const;
  if (brand.includes("master")) return "mastercard" as const;
  return getArCardBinOption(card.bin ?? "")?.network ?? "visa";
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "active") {
    return (
      <Badge variant="secondary" className="border-border bg-muted/60 text-foreground">
        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-foreground/70" />
        ACTIVE
      </Badge>
    );
  }
  if (normalized === "frozen") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        FROZEN
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {status.toUpperCase()}
    </Badge>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="ui-overview-metric p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        <div className="rounded-lg border border-border bg-[#212121] p-2 text-muted-foreground">{icon}</div>
      </div>
    </div>
  );
}

export function ArCardDashboard({
  className,
  initialData,
  canIssueCards = true,
}: {
  className?: string;
  initialData?: ArCardDashboardInitialData;
  canIssueCards?: boolean;
}) {
  const [config, setConfig] = useState<WalletConfig | null>(initialData?.config ?? null);
  const [cards, setCards] = useState<AccountCard[]>(initialData?.cards ?? []);
  const [loading, setLoading] = useState(!initialData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [page, setPage] = useState(0);

  const [detailCard, setDetailCard] = useState<AccountCard | null>(null);
  const [detailCredentials, setDetailCredentials] = useState<VirtualPaymentCardDetails | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);

  const [pinDialog, setPinDialog] = useState<{
    card: AccountCard;
    mode: ArCardPinDialogMode;
  } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const configured = config?.kripicard?.configured ?? false;
  const demoFlow = Boolean(config?.demoFlow || config?.issuance?.demoFlowActive);

  const refresh = useCallback(async () => {
    try {
      const [configRes, cardRes] = await Promise.all([
        fetch("/api/wallet/config"),
        fetch("/api/cards"),
      ]);
      const configBody = await configRes.json();
      const cardBody = await cardRes.json();
      if (!configRes.ok) throw new Error(configBody.error ?? "Failed to load config");
      if (!cardRes.ok) throw new Error(cardBody.error ?? "Failed to load cards");
      setConfig(configBody);
      const nextCards: AccountCard[] = (cardBody.cards ?? (cardBody.card ? [cardBody.card] : [])).map(
        (c: AccountCard) => ({
          id: c.id,
          lastFour: c.lastFour,
          brand: c.brand,
          status: String(c.status).toLowerCase(),
          bin: c.bin,
          nameOnCard: c.nameOnCard,
          initialAmountUsd: c.initialAmountUsd,
          pinSet: Boolean(c.pinSet),
          createdAt: c.createdAt,
        }),
      );
      setCards(nextCards);
      setPage((current) =>
        Math.min(
          current,
          Math.max(0, Math.ceil(nextCards.length / CARDS_PER_PAGE) - 1),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

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
  }, [initialData, refresh]);

  const totalPages = Math.max(1, Math.ceil(cards.length / CARDS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);

  const paginatedCards = useMemo(() => {
    const start = currentPage * CARDS_PER_PAGE;
    return cards.slice(start, start + CARDS_PER_PAGE);
  }, [cards, currentPage]);

  const pageStart = cards.length === 0 ? 0 : currentPage * CARDS_PER_PAGE + 1;
  const pageEnd = Math.min(cards.length, (currentPage + 1) * CARDS_PER_PAGE);

  const stats = useMemo(() => {
    const active = cards.filter((c) => c.status === "active").length;
    const totalBalance = cards.reduce(
      (sum, c) => sum + (c.balanceUsd ?? c.initialAmountUsd ?? 0),
      0,
    );
    return {
      total: cards.length,
      active,
      totalBalance,
      activePct: cards.length ? Math.round((active / cards.length) * 100) : 0,
    };
  }, [cards]);

  async function executeFreeze(
    cardId: string,
    action: "freeze" | "unfreeze",
    pin?: string,
  ) {
    setBusy(true);
    setPinBusy(true);
    setError(null);
    setPinError(null);
    try {
      const res = await fetch(`/api/cards/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId, pin }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      showToast(action === "freeze" ? "Card frozen" : "Card unfrozen", "success");
      setPinDialog(null);
      await refresh();
      if (detailCard?.id === cardId) {
        setDetailCard((current) =>
          current
            ? { ...current, status: action === "freeze" ? "frozen" : "active" }
            : current,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      if (pinDialog) setPinError(message);
      else setError(message);
      if (pinDialog) showToast(message, "error");
    } finally {
      setBusy(false);
      setPinBusy(false);
    }
  }

  function requestFreezeToggle(card: AccountCard, action: "freeze" | "unfreeze") {
    if (card.pinSet) {
      setPinError(null);
      setPinDialog({ card, mode: action });
      return;
    }
    void executeFreeze(card.id, action);
  }

  async function handlePinDialogSubmit(pin: string, confirmPin?: string) {
    if (!pinDialog) return;
    setPinBusy(true);
    setPinError(null);
    try {
      if (pinDialog.mode === "set") {
        const res = await fetch("/api/cards/pin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cardId: pinDialog.card.id,
            action: "set",
            pin,
            confirmPin,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not set PIN");
        showToast("Freeze PIN set for this card", "success");
        setPinDialog(null);
        await refresh();
        return;
      }

      if (pinDialog.mode === "remove") {
        const res = await fetch("/api/cards/pin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cardId: pinDialog.card.id,
            action: "remove",
            pin,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not remove PIN");
        showToast("Freeze PIN removed", "success");
        setPinDialog(null);
        await refresh();
        return;
      }

      await executeFreeze(
        pinDialog.card.id,
        pinDialog.mode === "freeze" ? "freeze" : "unfreeze",
        pin,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "PIN action failed";
      setPinError(message);
      showToast(message, "error");
    } finally {
      setPinBusy(false);
    }
  }

  function openPinDialog(card: AccountCard, mode: ArCardPinDialogMode) {
    setPinError(null);
    setPinDialog({ card, mode });
  }

  const fetchCredentials = useCallback(
    async (card: AccountCard): Promise<boolean> => {
      try {
        const res = await fetch("/api/cards/details", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cardId: card.id }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.error ?? "Could not load card details");
          return false;
        }
        if (body.credentials?.pan && body.credentials?.cvv) {
          setDetailCredentials({
            pan: body.credentials.pan,
            cvv: body.credentials.cvv,
            expiry: body.credentials.expiry,
            cardholderName: body.credentials.cardholderName ?? card.nameOnCard ?? "AR AGENT",
            last4: card.lastFour,
            amountDollars: body.balanceUsd ?? card.balanceUsd ?? card.initialAmountUsd,
          });
          if (typeof body.balanceUsd === "number") {
            setCards((current) =>
              current.map((c) =>
                c.id === card.id ? { ...c, balanceUsd: body.balanceUsd } : c,
              ),
            );
            setDetailCard((current) =>
              current?.id === card.id ? { ...current, balanceUsd: body.balanceUsd } : current,
            );
          }
          return true;
        }
        setError(body.error ?? "Card details unavailable");
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load card details");
        return false;
      }
    },
    [],
  );

  function openDetail(card: AccountCard) {
    setDetailCard(card);
    setDetailCredentials(null);
    setDetailLoading(true);
    setError(null);
    setMessage(null);
  }

  useEffect(() => {
    if (!detailCard) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void fetchCredentials(detailCard)
        .catch(() => false)
        .finally(() => {
          if (!cancelled) setDetailLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [detailCard, fetchCredentials]);

  if (loading) {
    return (
      <div className={cn("flex min-h-[360px] items-center justify-center", className)}>
        <VirtualPaymentCard details={null} loading />
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="ui-overview-summary overflow-hidden rounded-xl">
      <div className="ui-overview-identity flex flex-wrap items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Finance / Cards
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Payment cards</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Issue, fund and manage virtual cards across multiple BINs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm">
            <Upload className="mr-1.5 size-3.5" />
            Export
          </Button>
          {canIssueCards ? (
            <Button asChild size="sm" variant="secondary">
              <Link href="/dashboard/card/create">
                <Plus className="mr-1.5 size-3.5" />
                Add card
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="secondary">
              <Link href="/dashboard/verify">Verify to add card</Link>
            </Button>
          )}
        </div>
      </div>
      <div className="ui-overview-metrics grid sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total cards"
          value={String(stats.total)}
          sub={`${stats.active} active`}
          icon={<CreditCard className="size-4" />}
        />
        <StatCard
          label="Active"
          value={String(stats.active)}
          sub={stats.total ? `${stats.activePct}% of cards` : "—"}
          icon={<CreditCard className="size-4" />}
        />
        <StatCard
          label="Total balance"
          value={formatUsd(stats.totalBalance)}
          sub="USD"
          icon={<Plus className="size-4" />}
        />
        <StatCard
          label="Monthly spend"
          value={formatUsd(0)}
          sub="0 transactions"
          icon={<TrendingUp className="size-4" />}
        />
      </div>
      </div>

      {demoFlow ? (
        <p className="rounded-md border border-border bg-[#212121] px-3 py-2 text-xs text-muted-foreground">
          Demo flow — create multiple cards without USDT. Cards are not live and cannot spend at
          merchants.
        </p>
      ) : null}

      {!configured && !demoFlow ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
          Set <code className="text-[11px]">KRIPICARD_API_KEY</code> in{" "}
          <code className="text-[11px]">.env.local</code> to issue live cards.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          {message}
        </div>
      ) : null}

      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-semibold">Cards</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Card</th>
                <th className="px-4 py-3 font-medium">Balance</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedCards.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No cards yet — click Add card to create your first virtual card.
                  </td>
                </tr>
              ) : (
                paginatedCards.map((card, index) => (
                  <tr
                    key={card.id}
                    className="group border-b transition hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {String(currentPage * CARDS_PER_PAGE + index + 1).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <VirtualCardThumb
                          lastFour={card.lastFour}
                          cardholderName={card.nameOnCard}
                          network={networkFromCard(card)}
                          bin={card.bin}
                          brand={card.brand}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {card.nameOnCard ?? "AR AGENT"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {card.brand} · BIN {card.bin ?? "—"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {formatUsd(card.balanceUsd ?? card.initialAmountUsd ?? 0)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">USD</span>
                    </td>
                    <td className="px-4 py-3">{statusBadge(card.status)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatCreatedAt(card.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 opacity-90 transition group-hover:opacity-100">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-8"
                          onClick={() => openDetail(card)}
                        >
                          <Eye className="mr-1 size-3.5" />
                          View
                        </Button>
                        {card.status === "active" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8"
                            disabled={busy}
                            onClick={() => requestFreezeToggle(card, "freeze")}
                          >
                            <Snowflake className="mr-1 size-3.5" />
                            Freeze
                          </Button>
                        ) : card.status === "frozen" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8"
                            disabled={busy}
                            onClick={() => requestFreezeToggle(card, "unfreeze")}
                          >
                            Unfreeze
                          </Button>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="secondary"
                              className="size-8"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(card)}>
                              Manage card
                            </DropdownMenuItem>
                            {card.pinSet ? (
                              <DropdownMenuItem onClick={() => openPinDialog(card, "remove")}>
                                Remove freeze PIN
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => openPinDialog(card, "set")}>
                                Set freeze PIN
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
          <span>
            {cards.length === 0
              ? "No cards"
              : `Showing ${pageStart}–${pageEnd} of ${cards.length} cards`}
          </span>
          {cards.length > CARDS_PER_PAGE ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8"
                disabled={currentPage === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft className="mr-1 size-3.5" />
                Previous
              </Button>
              <span className="text-foreground">
                Page {currentPage + 1} of {totalPages}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              >
                Next
                <ChevronRight className="ml-1 size-3.5" />
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <div className="flex justify-center">
        <KripiIssuerBadge />
      </div>

      <Dialog
        open={Boolean(detailCard)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCard(null);
            setDetailCredentials(null);
            setDetailLoading(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {detailCard ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {detailCard.nameOnCard ?? "AR card"}
                </DialogTitle>
              </DialogHeader>
              <VirtualPaymentCard
                details={detailCredentials}
                maskedLast4={detailCard.lastFour}
                network={networkFromCard(detailCard)}
                bin={detailCard.bin}
                loading={detailLoading && !detailCredentials}
                autoRevealOnLoad
                onReveal={() => fetchCredentials(detailCard)}
                footerActions={
                  detailCard.status === "active" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={busy}
                      onClick={() => requestFreezeToggle(detailCard, "freeze")}
                    >
                      <Snowflake className="mr-1.5 size-3" />
                      Freeze
                    </Button>
                  ) : detailCard.status === "frozen" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={busy}
                      onClick={() => requestFreezeToggle(detailCard, "unfreeze")}
                    >
                      <Snowflake className="mr-1.5 size-3" />
                      Unfreeze
                    </Button>
                  ) : null
                }
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ArCardPinDialog
        open={Boolean(pinDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setPinDialog(null);
            setPinError(null);
          }
        }}
        mode={pinDialog?.mode ?? "set"}
        cardLabel={
          pinDialog
            ? `${pinDialog.card.nameOnCard ?? "AR card"} · •••• ${pinDialog.card.lastFour}`
            : undefined
        }
        busy={pinBusy}
        error={pinError}
        onSubmit={handlePinDialogSubmit}
      />
    </div>
  );
}
