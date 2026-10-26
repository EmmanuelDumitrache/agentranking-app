"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ClipboardCopy,
  Loader2,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { createQR } from "@solana/pay";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { syncDepositWithSignature } from "@/lib/llm-credits/client/desktop-transfer";
import { parseUsdToCents } from "@/lib/llm-credits/client/amount";
import {
  useLlmDepositConfig,
  useCreateLlmDeposit,
  useLlmDeposit,
  useSyncLlmDeposit,
} from "@/features/agent-chat/client/query-hooks";
import { useCountdownUntil } from "@/hooks/use-countdown-until";
/* ------------------------------------------------------------------ */
/*  Types                                                                */
/* ------------------------------------------------------------------ */
type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSettled?: () => void;
  readonly defaultAsset?: "SOL" | "USDC";
};
type DisplayStep =
  | "select"
  | "creating"
  | "awaiting"
  | "checking"
  | "settled"
  | "overpaid"
  | "underpaid"
  | "expired"
  | "failed";
type TransferMode = "wallet" | "direct";
/** Shape of the deposit from the API response, after JSON parse. */
type ApiDeposit = {
  id: string;
  status: string;
  asset: "SOL" | "USDC";
  quotedCents: number;
  expectedAmountAtomic: string;
  displayAmount: string;
  recipientPublicKey: string;
  referencePublicKey: string;
  paymentUrl: string;
  quoteExpiresAt: string;
  settledAt?: string;
  signature?: string;
  creditedCents?: number;
  failureReason?: string;
};
/* ------------------------------------------------------------------ */
/*  Helpers                                                              */
/* ------------------------------------------------------------------ */
function statusToStep(status: string): DisplayStep {
  switch (status) {
    case "SETTLED":
      return "settled";
    case "OVERPAID":
      return "overpaid";
    case "UNDERPAID":
      return "underpaid";
    case "EXPIRED":
      return "expired";
    case "FAILED":
    case "CANCELLED":
      return "failed";
    default:
      return "awaiting";
  }
}
function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function shortenKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
/* ------------------------------------------------------------------ */
/*  Main dialog                                                          */
/* ------------------------------------------------------------------ */
export function LlmCreditTopUpDialog(props: Props) {
  if (!props.open) return null;
  return <LlmCreditTopUpDialogSession {...props} />;
}

function LlmCreditTopUpDialogSession({
  open,
  onClose,
  onSettled,
  defaultAsset = "USDC",
}: Props) {
  /* ---- state ---------------------------------------------------- */
  const [amountInput, setAmountInput] = useState("1.00");
  const [selectedAsset, setSelectedAsset] = useState<"SOL" | "USDC">(defaultAsset);
  const [createdDepositId, setCreatedDepositId] = useState<string | null>(null);
  const [transferMode, setTransferMode] = useState<TransferMode>("wallet");
  const [manualSignature, setManualSignature] = useState("");
  const [manualVerifying, setManualVerifying] = useState(false);
  const [manualVerifyError, setManualVerifyError] = useState<string | null>(null);
  const [localStep, setLocalStep] = useState<DisplayStep>("select");
  const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [createdDeposit, setCreatedDeposit] = useState<ApiDeposit | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  /* ---- data ----------------------------------------------------- */
  const configQuery = useLlmDepositConfig();
  const config = configQuery.data;
  const createMutation = useCreateLlmDeposit();
  const syncMutation = useSyncLlmDeposit();
  const depositQuery = useLlmDeposit(createdDepositId);
  /* ---- derived --------------------------------------------------- */
  const parseResult = useMemo(
    () => parseUsdToCents(amountInput),
    [amountInput],
  );
  const depositFromQuery = depositQuery.data?.deposit as ApiDeposit | undefined;
  const depositApiData = depositFromQuery ?? createdDeposit ?? undefined;
  const depositStatus = depositFromQuery?.status ?? createdDeposit?.status;
  const statusStep = depositStatus ? statusToStep(depositStatus) : null;
  const terminalStep =
    statusStep && statusStep !== "awaiting" ? statusStep : null;
  const displayStep = terminalStep ?? localStep;
  const statusErrorMessage =
    terminalStep === "underpaid" || terminalStep === "expired" || terminalStep === "failed"
      ? depositApiData?.failureReason || `Deposit ${depositStatus?.toLowerCase() ?? "failed"}`
      : null;
  const errorMessage = localErrorMessage ?? statusErrorMessage;
  const paymentReady =
    !!depositApiData?.paymentUrl &&
    !!depositApiData?.recipientPublicKey;
  const awaitingPaymentUi =
    displayStep === "awaiting" || displayStep === "checking";
  const paymentLoading = awaitingPaymentUi && !paymentReady;
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);
  const settledNotifiedDepositIdRef = useRef<string | null>(null);
  /* ---- QR rendering ---------------------------------------------- */
  useEffect(() => {
    if (
      transferMode !== "wallet" ||
      !awaitingPaymentUi ||
      !depositApiData?.paymentUrl ||
      !qrRef.current
    ) {
      return;
    }
    const host = qrRef.current;
    host.innerHTML = "";
    const qr = createQR(depositApiData.paymentUrl, 200, "#ffffff", "#111111");
    qr.append(host);
    const svg = host.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.style.display = "block";
    }
  }, [
    awaitingPaymentUi,
    depositApiData?.paymentUrl,
    transferMode,
  ]);
  /* ---- notify the caller when a deposit settles ------------------ */
  useEffect(() => {
    if (!depositApiData?.id || (terminalStep !== "settled" && terminalStep !== "overpaid")) {
      return;
    }
    if (settledNotifiedDepositIdRef.current === depositApiData.id) return;
    settledNotifiedDepositIdRef.current = depositApiData.id;
    onSettledRef.current?.();
  }, [depositApiData?.id, terminalStep]);
  /* ---- asset selection ------------------------------------------- */
  const supportedAsset = config?.depositAsset ?? "USDC";
  /* ---- expiry countdown ------------------------------------------ */
  const expiresAt = depositApiData?.quoteExpiresAt ?? null;
  const remaining = useCountdownUntil(expiresAt);
  /* ---- reset ----------------------------------------------------- */
  const reset = useCallback(() => {
    setLocalStep("select");
    setCreatedDepositId(null);
    setCreatedDeposit(null);
    setLocalErrorMessage(null);
    setTransferMode("wallet");
    setManualSignature("");
    setManualVerifyError(null);
    setManualVerifying(false);
    setCopiedKey(null);
    settledNotifiedDepositIdRef.current = null;
  }, []);
  /* ---- handlers -------------------------------------------------- */
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        reset();
        onClose();
      }
    },
    [reset, onClose],
  );
  const handleCreate = useCallback(() => {
    if (!parseResult.ok) return;
    setLocalStep("creating");
    setLocalErrorMessage(null);
    createMutation.mutate(
      { asset: selectedAsset, cents: parseResult.cents },
      {
        onSuccess: (data) => {
          const deposit = data.deposit as ApiDeposit | undefined;
          if (deposit?.id) {
            setCreatedDeposit(deposit);
            setCreatedDepositId(deposit.id);
            setLocalStep("awaiting");
          } else {
            setLocalStep("failed");
            setLocalErrorMessage("Deposit creation returned no ID");
          }
        },
        onError: (err) => {
          setLocalStep("failed");
          setLocalErrorMessage(err instanceof Error ? err.message : "Failed to create deposit");
        },
      },
    );
  }, [parseResult, selectedAsset, createMutation]);
  const handleCopy = useCallback((text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }, []);
  const handleManualSync = useCallback(() => {
    if (!createdDepositId) return;
    setLocalStep("checking");
    setManualVerifyError(null);
    setLocalErrorMessage(null);
    syncMutation.mutate(createdDepositId, {
      onSuccess: () => {
        // depositQuery will refetch and status change triggers step update
      },
      onError: (err) => {
        setLocalStep("awaiting");
        const message = err instanceof Error ? err.message : "Sync failed";
        setLocalErrorMessage(message);
      },
    });
  }, [createdDepositId, syncMutation]);
  const handleManualVerify = useCallback(() => {
    if (!createdDepositId || !manualSignature.trim()) return;
    setManualVerifying(true);
    setManualVerifyError(null);
    syncDepositWithSignature(createdDepositId, manualSignature.trim())
      .then((result) => {
        if (result.ok) {
          setLocalStep("checking");
        } else {
          setManualVerifyError(result.error || "Verification failed");
        }
      })
      .catch((err) => {
        setManualVerifyError(
          err instanceof Error ? err.message : "Verification failed",
        );
      })
      .finally(() => setManualVerifying(false));
  }, [createdDepositId, manualSignature]);
  const isCheckingPayment =
    displayStep === "checking" || syncMutation.isPending;
  /* ---- render ---------------------------------------------------- */
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="ui-overview-panel max-h-[min(92dvh,40rem)] gap-0 overflow-hidden rounded-xl p-0 sm:max-w-md"
        showCloseButton={displayStep !== "creating"}
        overlayClassName="bg-black/50 backdrop-blur-md"
      >
        <DialogHeader className="ui-overview-panel-header gap-1 space-y-0 px-5 py-4 pr-10 text-left">
          <DialogTitle className="text-base">Add funds</DialogTitle>
          <DialogDescription className="text-xs">
            Purchase LLM credits with crypto
          </DialogDescription>
        </DialogHeader>
        {/* ── Select amount ───────────────────────────────────────── */}
        <div className="max-h-[calc(min(92dvh,40rem)-5rem)] overflow-y-auto px-5 py-4">
        {displayStep === "select" && (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <label
                  htmlFor="llm-topup-amount"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Amount (USD)
                </label>
                <Input
                  id="llm-topup-amount"
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="1.00"
                  className="h-9 text-sm"
                />
              </div>
              <div className="flex shrink-0 gap-1 rounded-lg border border-border/50 bg-muted/30 p-0.5">
                {supportedAsset === "USDC" ? (
                  <button
                    type="button"
                    onClick={() => setSelectedAsset("USDC")}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      selectedAsset === "USDC"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    USDC
                  </button>
                ) : null}
                {supportedAsset === "SOL" ? (
                  <button
                    type="button"
                    onClick={() => setSelectedAsset("SOL")}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      selectedAsset === "SOL"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    SOL
                  </button>
                ) : null}
              </div>
            </div>
            {parseResult.ok ? (
              <p className="text-[11px] text-muted-foreground">
                ≈ ${(parseResult.cents / 100).toFixed(2)}
                {config
                  ? ` · Min $${((config.minUsdCents ?? 100) / 100).toFixed(2)}`
                  : null}
              </p>
            ) : (
              <p className="text-[11px] text-destructive">{parseResult.error}</p>
            )}
            <Button
              onClick={handleCreate}
              disabled={!parseResult.ok || createMutation.isPending}
              className="h-9 w-full"
              size="sm"
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Create deposit
            </Button>
          </div>
        )}
        {/* ── Creating quote ──────────────────────────────────────── */}
        {displayStep === "creating" && (
          <div className="flex flex-col items-center gap-2 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Creating deposit…</p>
          </div>
        )}
        {/* ── Payment details loading (awaiting deposit payload) ─── */}
        {paymentLoading && (
          <div className="flex flex-col items-center gap-2 py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Preparing payment…</p>
          </div>
        )}
        {/* ── Awaiting / Checking payment ─────────────────────────── */}
        {awaitingPaymentUi && paymentReady && depositApiData && (
            <div className="space-y-3">
            <div className="ui-overview-metrics grid grid-cols-3 overflow-hidden rounded-lg text-[11px]">
                <div className="ui-overview-metric min-w-0 px-2.5 py-2">
                  <p className="text-muted-foreground">Amount</p>
                  <p className="truncate font-medium tabular-nums">
                    ${(depositApiData.quotedCents / 100).toFixed(2)}
                  </p>
                </div>
                <div className="ui-overview-metric min-w-0 px-2.5 py-2 text-center">
                  <p className="text-muted-foreground">Crypto</p>
                  <p className="truncate font-medium tabular-nums">
                    {depositApiData.displayAmount} {depositApiData.asset}
                  </p>
                </div>
                <div className="ui-overview-metric min-w-0 px-2.5 py-2 text-right">
                  <p className="text-muted-foreground">Expires</p>
                  <p
                    className={cn(
                      "font-medium tabular-nums",
                      remaining < 60 && "text-destructive",
                    )}
                  >
                    {expiresAt ? formatCountdown(remaining) : "—"}
                  </p>
                </div>
              </div>
              <div className="flex rounded-lg border border-border/40 bg-muted/40 p-0.5">
                <button
                  type="button"
                  onClick={() => setTransferMode("wallet")}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                    transferMode === "wallet"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Wallet
                </button>
                <button
                  type="button"
                  onClick={() => setTransferMode("direct")}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                    transferMode === "direct"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Direct
                </button>
              </div>
              {transferMode === "wallet" && (
                <div className="space-y-3">
                  <SendToAddressRow
                    address={depositApiData.recipientPublicKey}
                    copied={copiedKey === "recipient"}
                    onCopy={() =>
                      handleCopy(depositApiData.recipientPublicKey, "recipient")
                    }
                  />
                  <div className="flex flex-col items-center gap-2.5">
                    <div className="flex size-[200px] items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-white p-2 shadow-sm">
                      <div ref={qrRef} className="size-full [&_svg]:size-full" />
                    </div>
                    <p className="text-center text-[11px] text-muted-foreground">
                      Scan with Phantom, Solflare, or any Solana wallet
                    </p>
                    <div className="w-full space-y-1 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2">
                      <CopyRow
                        label="Reference"
                        value={depositApiData.referencePublicKey}
                        display={shortenKey(depositApiData.referencePublicKey)}
                        copied={copiedKey === "reference"}
                        onCopy={() =>
                          handleCopy(
                            depositApiData.referencePublicKey,
                            "reference",
                          )
                        }
                      />
                      <CopyRow
                        label="Pay URL"
                        value={depositApiData.paymentUrl}
                        display="Copy link"
                        copied={copiedKey === "pay-url"}
                        onCopy={() =>
                          handleCopy(depositApiData.paymentUrl, "pay-url")
                        }
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleManualSync}
                    variant="outline"
                    size="sm"
                    className="h-9 w-full"
                    disabled={isCheckingPayment}
                  >
                    {isCheckingPayment ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {isCheckingPayment ? "Checking…" : "Check payment"}
                  </Button>
                  <p className="text-center text-[11px] text-muted-foreground">
                    Waiting for payment…
                  </p>
                </div>
              )}
              {transferMode === "direct" && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-50 px-2.5 py-2 dark:bg-amber-950/20">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
                      Direct sends often miss the Solana Pay reference and can&apos;t
                      auto-credit. Prefer{" "}
                      <button
                        type="button"
                        onClick={() => setTransferMode("wallet")}
                        className="font-medium underline underline-offset-2"
                      >
                        Wallet
                      </button>{" "}
                      or QR.
                    </p>
                  </div>
                  <SendToAddressRow
                    address={depositApiData.recipientPublicKey}
                    copied={copiedKey === "direct-recipient"}
                    onCopy={() =>
                      handleCopy(
                        depositApiData.recipientPublicKey,
                        "direct-recipient",
                      )
                    }
                  />
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">Send</p>
                      <p className="font-medium tabular-nums">
                        {depositApiData.displayAmount} {depositApiData.asset}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">Credit</p>
                      <p className="font-medium tabular-nums">
                        ${(depositApiData.quotedCents / 100).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    After sending, paste the tx signature and verify. Only
                    transfers with the deposit reference can be matched.
                  </p>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="manual-signature"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      Transaction signature
                    </label>
                    <Input
                      id="manual-signature"
                      type="text"
                      value={manualSignature}
                      onChange={(e) => {
                        setManualSignature(e.target.value);
                        setManualVerifyError(null);
                      }}
                      placeholder="Paste signature…"
                      className="h-9 font-mono text-xs"
                    />
                  </div>
                  {manualSignature.trim() ? (
                    <Button
                      onClick={handleManualVerify}
                      disabled={manualVerifying}
                      size="sm"
                      className="h-9 w-full"
                    >
                      {manualVerifying ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {manualVerifying ? "Verifying…" : "Verify payment"}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleManualSync}
                      variant="outline"
                      size="sm"
                      className="h-9 w-full"
                      disabled={isCheckingPayment}
                    >
                      {isCheckingPayment ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      I&apos;ve sent the transfer
                    </Button>
                  )}
                  {manualVerifyError ? (
                    <p className="text-center text-[11px] text-destructive">
                      {manualVerifyError}
                    </p>
                  ) : null}
                  {errorMessage ? (
                    <p className="text-center text-[11px] text-destructive">
                      {errorMessage}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          )}
        {/* ── Settled / Overpaid ───────────────────────────────────── */}
        {(displayStep === "settled" || displayStep === "overpaid") && (
          <div className="flex flex-col items-center gap-2.5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-muted">
              <Check className="h-5 w-5 text-foreground" />
            </div>
            <p className="text-sm font-medium">
              {displayStep === "overpaid"
                ? "Payment received (overpaid)"
                : "Payment received!"}
            </p>
            {depositApiData ? (
              <p className="text-[11px] text-muted-foreground">
                $
                {(
                  (depositApiData.creditedCents ?? depositApiData.quotedCents) /
                  100
                ).toFixed(2)}{" "}
                added to your balance.
              </p>
            ) : null}
            {depositApiData?.signature ? (
              <a
                href={`https://solscan.io/tx/${depositApiData.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                View on Solscan
              </a>
            ) : null}
            <DialogCloseButton
              onClick={() => {
                reset();
                onClose();
              }}
            />
          </div>
        )}
        {/* ── Underpaid / Expired / Failed ─────────────────────────── */}
        {(displayStep === "underpaid" ||
          displayStep === "expired" ||
          displayStep === "failed") && (
          <div className="flex flex-col items-center gap-2.5 py-4">
            <p className="text-sm font-medium text-destructive">
              {displayStep === "underpaid"
                ? "Payment underpaid"
                : displayStep === "expired"
                  ? "Deposit expired"
                  : "Deposit failed"}
            </p>
            {errorMessage ? (
              <p className="text-center text-[11px] text-muted-foreground">
                {errorMessage}
              </p>
            ) : null}
            <Button onClick={reset} variant="outline" size="sm" className="h-9 w-full">
              Try again
            </Button>
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
/* ------------------------------------------------------------------ */
/*  Internal Components                                                  */
/* ------------------------------------------------------------------ */
function SendToAddressRow({
  address,
  copied,
  onCopy,
}: {
  readonly address: string;
  readonly copied: boolean;
  readonly onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          Send to
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Copy recipient address"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <ClipboardCopy className="h-3 w-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="break-all font-mono text-[11px] leading-snug tracking-tight text-foreground/90">
        {address}
      </p>
    </div>
  );
}
function CopyRow({
  label,
  value,
  display,
  copied,
  onCopy,
}: {
  readonly label: string;
  readonly value: string;
  readonly display: string;
  readonly copied: boolean;
  readonly onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={onCopy}
        className="flex min-w-0 items-center gap-1 transition-colors hover:text-foreground"
        aria-label={`Copy ${label.toLowerCase()}`}
        title={value}
      >
        <span className="truncate tabular-nums">{display}</span>
        {copied ? (
          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
        ) : (
          <ClipboardCopy className="h-3 w-3 shrink-0 opacity-70" />
        )}
      </button>
    </div>
  );
}
function DialogCloseButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <Button onClick={onClick} size="sm" className="mt-1 h-9 w-full">
      Done
    </Button>
  );
}
