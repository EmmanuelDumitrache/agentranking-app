"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  VirtualPaymentCard,
  type VirtualPaymentCardDetails,
} from "@/components/treasury/virtual-payment-card";
import { ArCardBinPicker, arCardRegionFlag } from "@/components/treasury/ar-card-bin-picker";
import { ArCardBinPlatformsPanel } from "@/components/treasury/ar-card-bin-insights-panel";
import { ArCardBinStatGrid } from "@/components/treasury/ar-card-bin-stat-grid";
import { KripiIssuerBadge } from "@/components/treasury/card-network-marks";
import {
  ArCardCreateActions,
  ArCardTermsDialog,
} from "@/components/treasury/ar-card-terms-dialog";
import {
  estimateArCardFundFees,
  estimateArCardIssueFees,
  getArCardBinOption,
  type ArCardBinOption,
} from "@/lib/agent-payments/providers/card/ar-card-bins";
import { cn } from "@/lib/utils";

function formatUsdAmount(dollars: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    dollars,
  );
}

function networkFromCard(card: { brand: string; bin?: string }) {
  const brand = card.brand.toLowerCase();
  if (brand.includes("visa")) return "visa" as const;
  if (brand.includes("master")) return "mastercard" as const;
  return getArCardBinOption(card.bin ?? "")?.network;
}

const EMPTY_AR_CARD_BINS: ArCardBinOption[] = [];

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

type AccountCard = {
  id: string;
  lastFour: string;
  brand: string;
  status: string;
  bin?: string;
  nameOnCard?: string;
  balanceUsd?: number;
  createdAt?: string;
};

type DepositInstructions = {
  intentId: string;
  payAddress: string;
  payAmount: string;
  payCurrency: string;
  network: string;
  creditedOnCompletionUsd?: number;
};

export type ArCardPanelInitialData = {
  config: WalletConfig;
  card: AccountCard | null;
};

const AMOUNT_PRESETS = [10, 25, 50, 100, 250];

const CARD_FEE = "ui-card-fee-breakdown space-y-1.5 text-xs";

export function ArCardPanel({
  className,
  initialData,
  mode = "default",
}: {
  className?: string;
  initialData?: ArCardPanelInitialData;
  mode?: "create" | "default";
}) {
  const router = useRouter();
  const [config, setConfig] = useState<WalletConfig | null>(initialData?.config ?? null);
  const [card, setCard] = useState<AccountCard | null>(initialData?.card ?? null);
  const [cardDetails, setCardDetails] = useState<VirtualPaymentCardDetails | null>(null);
  const [loading, setLoading] = useState(!initialData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [nameOnCard, setNameOnCard] = useState("AR AGENT");
  const [selectedBin, setSelectedBin] = useState(
    initialData?.config?.kripicard?.defaultBin ?? "441357",
  );
  const [issueAmount, setIssueAmount] = useState("10");
  const [email, setEmail] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [depositAmount, setDepositAmount] = useState("50");
  const [loadAmount, setLoadAmount] = useState("25");
  const [deposit, setDeposit] = useState<DepositInstructions | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const bins = config?.bins ?? EMPTY_AR_CARD_BINS;
  const binOption = bins.find((b) => b.bin === selectedBin) ?? bins[0];
  const effectiveSelectedBin = binOption?.bin ?? selectedBin;
  const minUsd = config?.kripicard?.minCardUsd ?? 10;
  const configured = config?.kripicard?.configured ?? false;
  const demoFlow = Boolean(config?.demoFlow || config?.issuance?.demoFlowActive);
  const currency = config?.kripicard?.defaultCurrency ?? "USDT";
  const network = config?.kripicard?.defaultNetwork ?? "trx";

  const issueFees = useMemo(
    () => estimateArCardIssueFees(Number(issueAmount) || 0),
    [issueAmount],
  );
  const fundFees = useMemo(
    () => estimateArCardFundFees(Number(loadAmount) || 0),
    [loadAmount],
  );

  const refresh = useCallback(async () => {
    try {
      const [configRes, cardRes] = await Promise.all([
        fetch("/api/wallet/config"),
        fetch("/api/cards"),
      ]);
      const configBody = await configRes.json();
      const cardBody = await cardRes.json();
      if (!configRes.ok) throw new Error(configBody.error ?? "Failed to load config");
      if (!cardRes.ok) throw new Error(cardBody.error ?? "Failed to load card");
      setConfig(configBody);
      const nextCard = cardBody.card
        ? {
            id: cardBody.card.id,
            lastFour: cardBody.card.lastFour,
            brand: cardBody.card.brand,
            status: String(cardBody.card.status).toLowerCase(),
            bin: cardBody.card.bin,
            nameOnCard: cardBody.card.nameOnCard,
            createdAt: cardBody.card.createdAt,
          }
        : null;
      if (mode !== "create") {
        setCard(nextCard);
      }
      if (configBody.kripicard?.defaultBin && (mode === "create" || !nextCard)) {
        setSelectedBin(configBody.kripicard.defaultBin);
      }
    } finally {
      setLoading(false);
    }
  }, [mode]);

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

  async function createDeposit() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setDeposit(null);
    try {
      const cents = Math.round(Number(depositAmount) * 100);
      const res = await fetch("/api/wallet/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: cents }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Deposit failed");
      if (body.autoConfirmed || body.intent?.status === "CONFIRMED") {
        setMessage(
          demoFlow
            ? "Demo funds added to your AR wallet."
            : "Funds confirmed — you can create your AR card.",
        );
        setDeposit(null);
        return;
      }
      const metadata = body.intent?.metadata as Record<string, unknown> | undefined;
      if (metadata?.payAddress) {
        setDeposit({
          intentId: String(body.intent.id),
          payAddress: String(metadata.payAddress),
          payAmount: String(metadata.payAmount ?? ""),
          payCurrency: String(metadata.payCurrency ?? currency),
          network: String(metadata.network ?? network),
          creditedOnCompletionUsd:
            typeof metadata.creditedOnCompletionUsd === "number"
              ? metadata.creditedOnCompletionUsd
              : undefined,
        });
        setMessage("Send the exact amount below, then check deposit status.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  }

  async function checkDeposit() {
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
        setMessage("Deposit confirmed — create your AR card.");
        setDeposit(null);
      } else {
        setMessage("Still pending — send crypto to the address below.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit check failed");
    } finally {
      setBusy(false);
    }
  }

  async function issueCard() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/cards/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: nameOnCard.trim() || "AR AGENT",
          amountUsd: Number(issueAmount),
          bin: effectiveSelectedBin,
          email: email.trim() || undefined,
          dateOfBirth: binOption?.requiresDateOfBirth ? dateOfBirth.trim() : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Card issuance failed");
      if (mode === "create") {
        router.push("/dashboard/card");
        return;
      }
      setMessage("AR virtual card issued — all agents on this account can use it.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Card issuance failed");
    } finally {
      setBusy(false);
    }
  }

  async function fundCard() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/cards/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountUsd: Number(loadAmount) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Top-up failed");
      setMessage(body.message ?? "Card funded");
      if (typeof body.balanceUsd === "number") {
        setCard((current) => (current ? { ...current, balanceUsd: body.balanceUsd } : current));
        setCardDetails((current) =>
          current ? { ...current, amountDollars: body.balanceUsd } : current,
        );
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Top-up failed");
    } finally {
      setBusy(false);
    }
  }

  const fetchCredentials = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/cards/details", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not load card details");
        return false;
      }
      if (body.credentials?.pan && body.credentials?.cvv) {
        setCardDetails({
          pan: body.credentials.pan,
          cvv: body.credentials.cvv,
          expiry: body.credentials.expiry,
          cardholderName: body.credentials.cardholderName ?? card?.nameOnCard ?? "AR AGENT",
          last4: card?.lastFour,
          amountDollars: body.balanceUsd ?? card?.balanceUsd,
        });
        if (typeof body.balanceUsd === "number") {
          setCard((current) => (current ? { ...current, balanceUsd: body.balanceUsd } : current));
        }
        return true;
      }
      setError(body.error ?? "Card details unavailable from Kripicard");
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load card details");
      return false;
    }
  }, [card]);

  async function freeze(action: "freeze" | "unfreeze") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cards/${action}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      setMessage(action === "freeze" ? "Card frozen" : "Card unfrozen");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className={cn("flex min-h-[360px] items-center justify-center", className)}>
        <VirtualPaymentCard details={null} loading />
      </div>
    );
  }

  const previewDetails: VirtualPaymentCardDetails = {
    pan: "",
    cvv: "",
    expiry: "••/••",
    cardholderName: nameOnCard || "YOUR NAME",
    last4: effectiveSelectedBin.slice(-4),
  };

  const showCreate = mode === "create" || !card;

  return (
    <div className={cn("mx-auto w-full max-w-5xl space-y-6 min-w-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 text-center sm:text-left">
        <div className="mx-auto w-full sm:mx-0">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            AgentRanking
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {showCreate ? "Create virtual card" : "AR card details"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {showCreate
              ? "Instantly issue a virtual card funded from your Kripicard balance."
              : "View and manage this card."}
          </p>
        </div>
        {mode === "create" ? (
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/card">
              <ChevronLeft className="mr-1 size-3.5" />
              Back to cards
            </Link>
          </Button>
        ) : card ? (
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/card">All cards</Link>
          </Button>
        ) : null}
      </div>

      {!configured && !demoFlow ? (
        <p className="ui-card-alert">
          Set <code className="text-[11px]">KRIPICARD_API_KEY</code> in{" "}
          <code className="text-[11px]">.env.local</code> from your{" "}
          <a
            href="https://www.kripicard.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-2"
          >
            Kripicard dashboard
          </a>
          .
        </p>
      ) : null}

      {demoFlow ? (
        <p className="ui-card-alert">
          Demo flow on — create, reveal, fund, and freeze without USDT. Cards are not live and
          cannot spend at merchants. Set <code className="text-[11px]">AR_CARD_DEMO_FLOW=false</code>{" "}
          and fund your Kripicard wallet for real cards.
        </p>
      ) : null}

      {error ? <div className="ui-card-alert ui-card-alert--error">{error}</div> : null}
      {message ? <div className="ui-card-alert ui-card-alert--success">{message}</div> : null}

      {showCreate ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
              <div className="ui-overview-panel-header px-5 py-4">
                <h2 className="text-sm font-medium">
                  {demoFlow ? "1 · Demo wallet (optional)" : "Fund Kripicard wallet"}
                </h2>
              </div>
              <div className="ui-settings-panel-body space-y-3">
              <p className="text-xs text-muted-foreground">
                {demoFlow
                  ? "Skipped for demo — click Create card without depositing. Optional mock credit below."
                  : `Deposit ${currency} on ${network.toUpperCase()} before issuing (min $${minUsd}).`}
              </p>
              {!demoFlow ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="number"
                      min={minUsd}
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="ui-card-input w-28"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy || !configured}
                      onClick={() => void createDeposit()}
                    >
                      Deposit {currency}
                    </Button>
                  </div>
                  {deposit ? (
                    <div className="ui-card-fee-breakdown space-y-2 text-xs">
                      <p>
                        Send <strong>{deposit.payAmount} {deposit.payCurrency}</strong> on{" "}
                        <strong>{deposit.network}</strong>
                      </p>
                      <code className="block break-all rounded-md border border-border/60 bg-[#181818] px-2 py-1">
                        {deposit.payAddress}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void checkDeposit()}
                      >
                        Check deposit
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void createDeposit()}
                >
                  Add demo funds (optional)
                </Button>
              )}
              </div>
            </section>

            <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
              <div className="ui-overview-panel-header px-5 py-4">
                <h2 className="text-sm font-medium">Card details</h2>
              </div>
              <div className="ui-settings-panel-body space-y-4">
              <label className="block space-y-1.5 text-xs">
                <span className="font-medium uppercase tracking-wide text-muted-foreground">
                  Name on card
                </span>
                <input
                  type="text"
                  value={nameOnCard}
                  onChange={(e) => setNameOnCard(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  className={cn("ui-card-input w-full")}
                  minLength={2}
                />
              </label>

              <ArCardBinPicker
                bins={bins}
                selectedBin={effectiveSelectedBin}
                onSelectBin={setSelectedBin}
              />

              <label className="block space-y-1.5 text-xs">
                <span className="font-medium uppercase tracking-wide text-muted-foreground">
                  Email (optional)
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={cn("ui-card-input w-full")}
                  placeholder="receipts@example.com"
                />
              </label>

              {binOption?.requiresDateOfBirth ? (
                <label className="block space-y-1.5 text-xs">
                  <span className="font-medium uppercase tracking-wide text-muted-foreground">
                    Date of birth (required for this BIN)
                  </span>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className={cn("ui-card-input w-full")}
                  />
                </label>
              ) : null}

              <div className="space-y-2">
                <label className="block space-y-1.5 text-xs">
                  <span className="font-medium uppercase tracking-wide text-muted-foreground">
                    Initial amount (USD)
                  </span>
                  <input
                    type="number"
                    min={minUsd}
                    value={issueAmount}
                    onChange={(e) => setIssueAmount(e.target.value)}
                    className={cn("ui-card-input w-full")}
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {AMOUNT_PRESETS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setIssueAmount(String(amount))}
                      className={cn(
                        "ui-launch-tag",
                        Number(issueAmount) === amount && "ui-launch-tag--active",
                      )}
                    >
                      ${amount}
                    </button>
                  ))}
                </div>
              </div>

              <dl className={CARD_FEE}>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Card amount</dt>
                  <dd>{formatUsdAmount(issueFees.cardAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Issuance fee</dt>
                  <dd>{formatUsdAmount(issueFees.issuanceFee)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Funding fee (4%)</dt>
                  <dd>{formatUsdAmount(issueFees.fundingFee)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Processing fee</dt>
                  <dd>{formatUsdAmount(issueFees.processingFee)}</dd>
                </div>
                <div className="flex justify-between border-t pt-2 text-sm font-semibold">
                  <dt>Total cost</dt>
                  <dd className="text-foreground">
                    {formatUsdAmount(issueFees.total)}
                  </dd>
                </div>
              </dl>

              <ArCardCreateActions
                busy={busy}
                termsAccepted={termsAccepted}
                demoFlow={demoFlow}
                canSubmit={
                  (configured || demoFlow) &&
                  Number(issueAmount) >= minUsd &&
                  nameOnCard.trim().length >= 2 &&
                  (demoFlow || !binOption?.requiresDateOfBirth || Boolean(dateOfBirth))
                }
                onOpenTerms={() => setTermsOpen(true)}
                onCreate={() => void issueCard()}
              />
              <ArCardTermsDialog
                open={termsOpen}
                onOpenChange={setTermsOpen}
                accepted={termsAccepted}
                onAccept={() => setTermsAccepted(true)}
              />
              <p className="text-center text-[11px] text-muted-foreground">
                Issued cards appear in your dashboard. Agents on this account can use them.
              </p>
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <div className="flex justify-center lg:justify-end">
              <VirtualPaymentCard
                details={previewDetails}
                maskedLast4={effectiveSelectedBin.slice(-4)}
                network={binOption?.network}
                bin={effectiveSelectedBin}
              />
            </div>
            {binOption ? (
              <>
                <div className="ui-overview-panel overflow-hidden rounded-xl p-0 text-sm">
                  <div className="ui-settings-panel-body space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-xl leading-none" aria-hidden>
                        {arCardRegionFlag(binOption.regionCode)}
                      </span>
                      <p className="font-semibold tracking-tight">{binOption.region}</p>
                    </div>
                    <KripiIssuerBadge />
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {binOption.description}
                  </p>
                  <ArCardBinStatGrid option={binOption} />
                  </div>
                </div>
                <ArCardBinPlatformsPanel option={binOption} />
              </>
            ) : null}
          </aside>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <div className="flex justify-center lg:justify-start">
              <VirtualPaymentCard
                details={cardDetails}
                maskedLast4={card.lastFour}
                network={networkFromCard(card)}
                bin={card.bin}
                loading={busy}
                onReveal={() => fetchCredentials()}
              />
            </div>
            <dl className="ui-overview-panel overflow-hidden rounded-xl p-0 text-sm">
              <div className="ui-overview-panel-header px-5 py-4">
                <h2 className="text-sm font-medium">Card details</h2>
              </div>
              <div className="ui-settings-panel-body space-y-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Card ID</dt>
                <dd className="truncate font-mono text-xs">{card.id}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Brand</dt>
                <dd className="capitalize">{card.brand}</dd>
              </div>
              {card.bin ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">BIN</dt>
                  <dd className="font-mono">{card.bin}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <span className="rounded-full border border-border/60 bg-[#212121] px-2 py-0.5 text-[11px] uppercase tracking-wide text-foreground">
                    {card.status}
                  </span>
                </dd>
              </div>
              {card.createdAt ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="text-xs">{new Date(card.createdAt).toLocaleString()}</dd>
                </div>
              ) : null}
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void freeze(card.status === "frozen" ? "unfreeze" : "freeze")}
              >
                {card.status === "frozen" ? "Unfreeze" : "Freeze"}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
              <div className="ui-overview-panel-header px-5 py-4">
                <h2 className="text-sm font-medium">Fund card</h2>
              </div>
              <div className="ui-settings-panel-body space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Current card balance</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {card.balanceUsd != null ? formatUsdAmount(card.balanceUsd) : "—"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void fetchCredentials()}
                >
                  Refresh
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="number"
                  min={minUsd}
                  value={loadAmount}
                  onChange={(e) => setLoadAmount(e.target.value)}
                  className="ui-card-input w-28"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || Number(loadAmount) < minUsd}
                  onClick={() => void fundCard()}
                >
                  Confirm funding
                </Button>
              </div>
              <dl className={CARD_FEE}>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd>{formatUsdAmount(fundFees.amount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Fixed fee</dt>
                  <dd>{formatUsdAmount(fundFees.fixedFee)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Service fee (4%)</dt>
                  <dd>{formatUsdAmount(fundFees.serviceFee)}</dd>
                </div>
                <div className="flex justify-between border-t pt-1 font-medium">
                  <dt>Total deducted</dt>
                  <dd>{formatUsdAmount(fundFees.total)}</dd>
                </div>
              </dl>
              </div>
            </section>

            <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
              <div className="ui-overview-panel-header px-5 py-4">
                <h2 className="text-sm font-medium">Shared access</h2>
              </div>
              <div className="ui-settings-panel-body space-y-3">
              <p className="text-xs text-muted-foreground">
                Every agent under this account spends from this single AR card. No per-agent cards.
              </p>
              <Button asChild size="sm" variant="secondary">
                <Link href="/dashboard/card/agents">View agent activity</Link>
              </Button>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
