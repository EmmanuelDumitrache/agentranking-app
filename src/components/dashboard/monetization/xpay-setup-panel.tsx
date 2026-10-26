"use client";
import Image from "next/image";
import {
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  ShieldCheck,
  WalletCards,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DashboardX402ReadinessCard } from "@/components/dashboard/monetization/x402-readiness-card";
import type { X402DisplayState } from "@/lib/dashboard/x402-display";
import {
  classifyPaymentWalletTrust,
  paymentWalletTrustLabel,
} from "@/lib/dashboard/payment-wallet-trust";
import { cn } from "@/lib/utils";
export type XPaySetupForm = {
  title: string;
  description: string;
  endpointUrl: string;
  priceUsd: string;
  priceLabel: string;
  paymentWallet: string;
  isPublished: boolean;
};
type Props = {
  form: XPaySetupForm;
  onChange: (next: XPaySetupForm) => void;
  trustedWallets: string[];
  x402State: X402DisplayState;
  scanning: boolean;
  onScan: () => void;
  saving: boolean;
  onSubmit: () => void;
  validationError: string | null;
  publishedXPayCount: number;
  scanHint?: string | null;
  compact?: boolean;
  submitLabel?: string;
};
function stepDone(form: XPaySetupForm, x402State: X402DisplayState, step: 1 | 2 | 3): boolean {
  if (step === 1) return Boolean(form.endpointUrl.trim() && x402State.lastScanned);
  if (step === 2) return Boolean(form.title.trim());
  const hasPrice = Boolean(form.priceUsd.trim() || form.priceLabel.trim());
  return hasPrice && Boolean(form.paymentWallet.trim());
}
function isX402DiscoveryUrl(endpoint: string): boolean {
  try {
    return new URL(endpoint).pathname.replace(/\/$/, "") === "/.well-known/x402";
  } catch {
    return false;
  }
}
export function DashboardXPaySetupPanel({
  form,
  onChange,
  trustedWallets,
  x402State,
  scanning,
  onScan,
  saving,
  onSubmit,
  validationError,
  publishedXPayCount,
  scanHint,
  compact = false,
  submitLabel,
}: Props) {
  const walletTrust = classifyPaymentWalletTrust(form.paymentWallet, trustedWallets);
  const walletLabel = paymentWalletTrustLabel(walletTrust);
  const steps = [
    { id: 1 as const, label: "Scan endpoint", hint: "Paste URL and check x402" },
    { id: 2 as const, label: "Listing details", hint: "Service name confirmed" },
    { id: 3 as const, label: "Price & publish", hint: "Wallet, pricing, go live" },
  ];
  const primaryLabel =
    submitLabel ?? (form.isPublished ? "Publish xPay listing" : "Save as draft");
  const walletMatchesVerified = walletTrust === "matches_verified";
  const showUseVerifiedWallet =
    Boolean(trustedWallets[0]) && form.paymentWallet.trim() !== trustedWallets[0];
  const discoveryUrl = isX402DiscoveryUrl(form.endpointUrl);
  return (
    <div className="space-y-5">
      {!compact ? (
        <div className="ui-overview-panel overflow-hidden rounded-xl p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                  <Image
                    src="/partners/xona/xona-mark.png"
                    alt="Xona"
                    width={22}
                    height={22}
                    className="object-contain"
                  />
                </span>
                <Image
                  src="/partners/xona/xona-wordmark.png"
                  alt="Xona"
                  width={92}
                  height={24}
                  className="h-6 w-auto object-contain"
                />
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                  <Zap className="h-3 w-3" />
                  xPay
                </span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Add an xPay listing</h3>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-300">
                  Scan your endpoint first — we&apos;ll detect x402 and pre-fill pricing where possible.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-right shrink-0">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Live xPay listings</p>
              <p className="text-2xl font-bold tabular-nums text-white">{publishedXPayCount}</p>
            </div>
          </div>
        </div>
      ) : null}
      {!compact ? (
        <ol className="grid gap-2 sm:grid-cols-3">
          {steps.map((step) => {
            const done = stepDone(form, x402State, step.id);
            return (
              <li
                key={step.id}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  done ? "border-emerald-400/25 bg-emerald-400/[0.06]" : "border-border/60 bg-muted/20",
                )}
              >
                <div className="flex items-start gap-2">
                  {done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-xs font-medium">
                      Step {step.id}: {step.label}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{step.hint}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      <div className={cn("space-y-4", !compact && "ui-overview-panel rounded-xl p-4")}>
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 1</p>
          <div>
            <Label htmlFor="xpay-endpoint" className="text-xs text-muted-foreground">
              Endpoint URL
            </Label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input
                id="xpay-endpoint"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                value={form.endpointUrl}
                onChange={(e) => onChange({ ...form, endpointUrl: e.target.value })}
                placeholder="https://api.example.com/v1/generate"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={scanning || !form.endpointUrl.trim()}
                onClick={onScan}
                className="shrink-0"
              >
                {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Scan x402"}
              </Button>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Must be a public HTTPS URL. Scan checks for x402 payment headers and can pre-fill the form.
            </p>
            {discoveryUrl ? (
              <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2 text-[11px] text-amber-100">
                <AlertTriangle className="mr-1 inline h-3 w-3 -mt-px" />
                This looks like a discovery URL. If buyers should call a different API path, replace it with the
                paid endpoint before publishing.
              </p>
            ) : null}
          </div>
          <DashboardX402ReadinessCard state={x402State} compact />
          {scanHint ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              {scanHint}
            </p>
          ) : null}
        </div>
        <div className="border-t border-border/50 pt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 2</p>
          <div className="space-y-2">
            <div>
              <Label htmlFor="xpay-title" className="text-xs text-muted-foreground">
                Service name
              </Label>
              <input
                id="xpay-title"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={form.title}
                onChange={(e) => onChange({ ...form, title: e.target.value })}
                placeholder="e.g. Image generation API"
              />
            </div>
            <div>
              <Label htmlFor="xpay-description" className="text-xs text-muted-foreground">
                Short description <span className="font-normal">(optional)</span>
              </Label>
              <textarea
                id="xpay-description"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm min-h-[56px]"
                value={form.description}
                onChange={(e) => onChange({ ...form, description: e.target.value })}
                placeholder="What does this paid endpoint do?"
              />
            </div>
          </div>
        </div>
        <div className="border-t border-border/50 pt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step 3</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="xpay-price-usd" className="text-xs text-muted-foreground">
                Price (USD)
              </Label>
              <input
                id="xpay-price-usd"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={form.priceUsd}
                onChange={(e) => onChange({ ...form, priceUsd: e.target.value })}
                placeholder="0.50"
                inputMode="decimal"
              />
            </div>
            <div>
              <Label htmlFor="xpay-price-label" className="text-xs text-muted-foreground">
                Or price label
              </Label>
              <input
                id="xpay-price-label"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={form.priceLabel}
                onChange={(e) => onChange({ ...form, priceLabel: e.target.value })}
                placeholder="1 USDC via xPay"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">Fill in at least one price field.</p>
          <div>
            <Label htmlFor="xpay-wallet" className="text-xs text-muted-foreground">
              Payment wallet
            </Label>
            <div className="mt-1 flex gap-2">
              <input
                id="xpay-wallet"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                value={form.paymentWallet}
                onChange={(e) => onChange({ ...form, paymentWallet: e.target.value })}
                placeholder="Solana or Base address"
              />
              {showUseVerifiedWallet ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => onChange({ ...form, paymentWallet: trustedWallets[0] })}
                >
                  <WalletCards className="h-3.5 w-3.5 mr-1" />
                  Use verified
                </Button>
              ) : null}
            </div>
            {form.paymentWallet.trim() ? (
              <p
                className={cn(
                  "mt-1 text-[10px]",
                  walletTrust === "matches_verified"
                    ? "text-emerald-400/90"
                    : walletTrust === "unverified"
                      ? "text-amber-400/90"
                      : "text-muted-foreground",
                )}
              >
                <ShieldCheck className="inline h-3 w-3 mr-0.5 -mt-px" />
                {walletMatchesVerified ? "Verified wallet selected" : walletLabel}
              </p>
            ) : (
              <p className="mt-1 text-[10px] text-muted-foreground">
                USDC payments on Solana or Base are sent to this wallet.
              </p>
            )}
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.isPublished}
              onChange={(e) => onChange({ ...form, isPublished: e.target.checked })}
            />
            <span className="text-xs">
              <span className="font-medium text-foreground">Publish on public profile</span>
              <span className="block text-muted-foreground mt-0.5">
                Shows an xPay badge and lets buyers use your listing from the agent page.
              </span>
            </span>
          </label>
        </div>
      </div>
      {validationError ? (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          {validationError}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" disabled={saving} onClick={onSubmit} className="sm:min-w-[200px]">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          {primaryLabel}
        </Button>
        <a
          href="https://xpay.xona-agent.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:ml-auto"
        >
          xPay docs
          <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
