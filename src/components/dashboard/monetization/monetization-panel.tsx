"use client";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { CheckCircle2, ChevronDown, Loader2, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DashboardConfirmDeleteDialog } from "@/components/dashboard/shared/confirm-delete-dialog";
import { DashboardX402ReadinessCard } from "@/components/dashboard/monetization/x402-readiness-card";
import {
  DashboardXPaySetupPanel,
  type XPaySetupForm,
} from "@/components/dashboard/monetization/xpay-setup-panel";
import { parseX402SignalState, type X402DisplayState } from "@/lib/dashboard/x402-display";
import {
  classifyPaymentWalletTrust,
  paymentWalletTrustLabel,
} from "@/lib/dashboard/payment-wallet-trust";
import { showToast } from "@/components/ui/toast-simple";
import { cn } from "@/lib/utils";
import { isXPayServiceType, XPAY_SERVICE_TYPE, xpayServiceLabel } from "@/lib/xpay/display";
import type { X402ScanResult } from "@/lib/dashboard/x402-scanner";
import {
  applyX402ScanAutofill,
  formatAutofillFields,
  x402DisplayStateFromScan,
  x402ScanFeedback,
} from "@/lib/xpay/scan-autofill";
export type PaidServiceRow = {
  id: number;
  title: string;
  description?: string;
  serviceType?: string;
  endpointUrl?: string;
  priceUsd?: number | null;
  priceLabel?: string;
  paymentWallet?: string;
  sampleResponse?: string;
  isPublished: boolean;
};
type SignalRow = {
  signalType: string;
  status: string;
  value: string;
  payloadJson?: unknown;
  lastCheckedAt?: string | Date | null;
};
type Props = {
  agentDbId: number;
  paidServices: PaidServiceRow[];
  signals?: SignalRow[];
  trustedWallets?: string[];
  publicProfileHref?: string;
  readiness?: {
    score: number;
    maxScore: number;
    items: Array<{ id: string; label: string; points: number; done: boolean; tip?: string }>;
  } | null;
  onUpdated: () => void;
  /** Agent detail page: skip duplicate page chrome. */
  embedded?: boolean;
};
type FormState = {
  title: string;
  description: string;
  serviceType: string;
  endpointUrl: string;
  priceUsd: string;
  priceLabel: string;
  paymentWallet: string;
  sampleResponse: string;
  isPublished: boolean;
};
const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  serviceType: "x402",
  endpointUrl: "",
  priceUsd: "",
  priceLabel: "",
  paymentWallet: "",
  sampleResponse: "",
  isPublished: true,
};
const XPAY_FORM_DEFAULTS: FormState = {
  title: "",
  description: "",
  serviceType: XPAY_SERVICE_TYPE,
  endpointUrl: "",
  priceUsd: "",
  priceLabel: "",
  paymentWallet: "",
  sampleResponse: "",
  isPublished: true,
};
type FormMode = "overview" | "xpay" | "other";
function toXPayForm(form: FormState): XPaySetupForm {
  return {
    title: form.title,
    description: form.description,
    endpointUrl: form.endpointUrl,
    priceUsd: form.priceUsd,
    priceLabel: form.priceLabel,
    paymentWallet: form.paymentWallet,
    isPublished: form.isPublished,
  };
}
function fromXPayForm(prev: FormState, xpay: XPaySetupForm): FormState {
  return {
    ...prev,
    ...xpay,
    serviceType: XPAY_SERVICE_TYPE,
  };
}
function validateForm(form: FormState, mode: "xpay" | "other"): string | null {
  if (!form.title.trim()) return "Enter a service name.";
  if (mode === "xpay" || isXPayServiceType(form.serviceType)) {
    if (!form.endpointUrl.trim()) return "Enter your service endpoint URL.";
    try {
      const url = new URL(form.endpointUrl.trim());
      if (url.protocol !== "https:") return "Endpoint must use https://.";
    } catch {
      return "Enter a valid https:// endpoint URL.";
    }
  }
  const hasPrice = Boolean(form.priceUsd.trim() || form.priceLabel.trim());
  if (!hasPrice) return "Set a price (USD amount or a label like \"1 USDC\").";
  if (form.priceUsd.trim()) {
    const parsed = Number.parseFloat(form.priceUsd);
    if (!Number.isFinite(parsed) || parsed < 0) return "Price USD must be a valid number.";
  }
  if (!form.paymentWallet.trim()) return "Enter the wallet that receives payments.";
  return null;
}
function DashboardMonetizationPanelInner({
  agentDbId,
  paidServices,
  signals = [],
  trustedWallets = [],
  publicProfileHref,
  readiness = null,
  onUpdated,
  embedded = false,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const xpayDeepLink = searchParams.get("xpay") === "1";
  const [formMode, setFormMode] = useState<FormMode>(xpayDeepLink ? "xpay" : "overview");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [scanEndpoint, setScanEndpoint] = useState("");
  const [liveX402State, setLiveX402State] = useState<X402DisplayState | null>(null);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [publishedNotice, setPublishedNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(() =>
    xpayDeepLink
      ? { ...XPAY_FORM_DEFAULTS, paymentWallet: trustedWallets[0] ?? "" }
      : EMPTY_FORM,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [editService, setEditService] = useState<PaidServiceRow | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PaidServiceRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const normalizedSignals = useMemo(
    () =>
      signals.map((s) => ({
        ...s,
        payloadJson: s.payloadJson ?? null,
        lastCheckedAt: s.lastCheckedAt ? new Date(s.lastCheckedAt) : null,
        value: s.value ?? "",
      })),
    [signals],
  );
  const x402StateFromSignals = useMemo(
    () => parseX402SignalState(normalizedSignals),
    [normalizedSignals],
  );
  const x402State = liveX402State ?? x402StateFromSignals;
  const xpayServices = useMemo(
    () => paidServices.filter((service) => isXPayServiceType(service.serviceType)),
    [paidServices],
  );
  const otherServices = useMemo(
    () => paidServices.filter((service) => !isXPayServiceType(service.serviceType)),
    [paidServices],
  );
  const publishedXPayCount = xpayServices.filter((service) => service.isPublished).length;
  const allTrusted = useMemo(
    () => [...new Set(trustedWallets.filter(Boolean))],
    [trustedWallets],
  );
  function clearXPayQueryParam() {
    if (searchParams.get("xpay") !== "1") return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("xpay");
    const query = params.toString();
    router.replace(query ? `?${query}#monetization` : "#monetization", { scroll: false });
  }
  function startXPayService() {
    setValidationError(null);
    setScanHint(null);
    setLiveX402State(null);
    setPublishedNotice(null);
    setFormMode("xpay");
    setForm({
      ...XPAY_FORM_DEFAULTS,
      paymentWallet: allTrusted[0] ?? "",
    });
  }
  function startOtherService() {
    setValidationError(null);
    setScanHint(null);
    setPublishedNotice(null);
    setFormMode("other");
    setForm({ ...EMPTY_FORM, paymentWallet: allTrusted[0] ?? "" });
  }
  function cancelForm() {
    setValidationError(null);
    setScanHint(null);
    setLiveX402State(null);
    setPublishedNotice(null);
    setFormMode("overview");
    setForm(EMPTY_FORM);
    clearXPayQueryParam();
  }
  function applyScanToForm(
    current: FormState,
    scan: X402ScanResult,
  ): { next: FormState; filled: string[] } {
    const currentXPay = toXPayForm(current);
    const { next, filled } = applyX402ScanAutofill(currentXPay, scan);
    return { next: fromXPayForm(current, { ...currentXPay, ...next }), filled };
  }
  async function scanX402(endpointOverride?: string) {
    const endpoint = (endpointOverride ?? scanEndpoint ?? form.endpointUrl).trim();
    if (!endpoint) return;
    setScanning(true);
    setScanHint(null);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/x402-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      const data = (await res.json()) as { error?: string; scan?: X402ScanResult };
      if (!res.ok) throw new Error(data.error ?? "x402 scan failed");
      if (!data.scan) throw new Error("No scan result returned");
      const scan = data.scan;
      setLiveX402State(x402DisplayStateFromScan(scan));
      let filled: string[] = [];
      if (formMode === "xpay") {
        const applied = applyScanToForm(form, scan);
        filled = applied.filled;
        setForm(applied.next);
        if (filled.length > 0) {
          setScanHint(`Scan detected x402. Autofilled: ${formatAutofillFields(filled)}.`);
        } else if (scan.statusCode === 402 || scan.paymentHeaders.length > 0) {
          setScanHint("Scan detected x402. Review the details below before publishing.");
        }
      } else if (editOpen && editService) {
        const applied = applyScanToForm(editForm, scan);
        filled = applied.filled;
        setEditForm(applied.next);
        setScanEndpoint(scan.endpoint);
      } else {
        setScanEndpoint(scan.endpoint);
      }
      const feedback = x402ScanFeedback(scan, filled);
      showToast(feedback.message, feedback.type);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "x402 scan failed", "error");
    } finally {
      setScanning(false);
    }
  }
  async function addPaidService(mode: "xpay" | "other") {
    const error = validateForm(form, mode);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    setSaving(true);
    try {
      const listingTitle = form.title.trim();
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/paid-services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          serviceType: mode === "xpay" ? XPAY_SERVICE_TYPE : form.serviceType,
          endpointUrl: form.endpointUrl.trim() || undefined,
          priceUsd: form.priceUsd ? Number.parseFloat(form.priceUsd) : null,
          priceLabel: form.priceLabel.trim() || undefined,
          paymentWallet: form.paymentWallet.trim() || undefined,
          sampleResponse: form.sampleResponse.trim() || undefined,
          isPublished: form.isPublished,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add paid service");
      setForm(EMPTY_FORM);
      setFormMode("overview");
      setScanHint(null);
      setLiveX402State(null);
      setPublishedNotice(mode === "xpay" && form.isPublished ? listingTitle : null);
      clearXPayQueryParam();
      onUpdated();
      router.refresh();
      const label = mode === "xpay" ? "xPay listing" : "Paid service";
      showToast(
        form.isPublished ? `${label} published` : `${label} saved as draft`,
        "success",
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to add paid service", "error");
    } finally {
      setSaving(false);
    }
  }
  function openEdit(service: PaidServiceRow) {
    setEditService(service);
    setEditForm({
      title: service.title,
      description: service.description ?? "",
      serviceType: service.serviceType ?? "x402",
      endpointUrl: service.endpointUrl ?? "",
      priceUsd: service.priceUsd != null ? String(service.priceUsd) : "",
      priceLabel: service.priceLabel ?? "",
      paymentWallet: service.paymentWallet ?? "",
      sampleResponse: service.sampleResponse ?? "",
      isPublished: service.isPublished,
    });
    setEditOpen(true);
  }
  async function saveEdit() {
    if (!editService) return;
    const mode = isXPayServiceType(editForm.serviceType) ? "xpay" : "other";
    const error = validateForm(editForm, mode);
    if (error) {
      showToast(error, "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/paid-services`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editService.id,
          title: editForm.title.trim(),
          description: editForm.description.trim() || undefined,
          serviceType: editForm.serviceType,
          endpointUrl: editForm.endpointUrl.trim() || undefined,
          priceUsd: editForm.priceUsd ? Number.parseFloat(editForm.priceUsd) : null,
          priceLabel: editForm.priceLabel.trim() || undefined,
          paymentWallet: editForm.paymentWallet.trim() || undefined,
          sampleResponse: editForm.sampleResponse.trim() || undefined,
          isPublished: editForm.isPublished,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update paid service");
      setEditOpen(false);
      onUpdated();
      router.refresh();
      showToast("Paid service updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update paid service", "error");
    } finally {
      setSaving(false);
    }
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/paid-services?id=${deleteTarget.id}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete paid service");
      setDeleteOpen(false);
      setDeleteTarget(null);
      onUpdated();
      router.refresh();
      showToast("Paid service deleted", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete paid service", "error");
    } finally {
      setDeleting(false);
    }
  }
  function renderServiceList(services: PaidServiceRow[], emptyLabel: string) {
    if (services.length === 0) {
      return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
    }
    return (
      <ul className="space-y-2">
        {services.map((p) => {
          const walletTrust = classifyPaymentWalletTrust(p.paymentWallet, allTrusted);
          const walletLabel = paymentWalletTrustLabel(walletTrust);
          return (
            <li key={p.id} className="rounded-lg border border-border/60 px-3 py-3 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {p.title}
                    <span
                      className={cn(
                        "ml-2 rounded-full border px-2 py-0.5 text-[10px]",
                        isXPayServiceType(p.serviceType)
                          ? "border-border bg-muted/60 text-foreground"
                          : "border-border bg-[#272727] text-muted-foreground",
                      )}
                    >
                      {xpayServiceLabel(p.serviceType)}
                    </span>
                    {p.isPublished ? (
                      <span className="text-emerald-400 text-xs ml-2">· live</span>
                    ) : (
                      <span className="text-muted-foreground text-xs ml-2">· draft</span>
                    )}
                  </p>
                  {p.endpointUrl ? (
                    <p className="text-xs text-muted-foreground truncate font-mono">{p.endpointUrl}</p>
                  ) : null}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => openEdit(p)}
                    aria-label={`Edit ${p.title}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-red-400"
                    onClick={() => {
                      setDeleteTarget(p);
                      setDeleteOpen(true);
                    }}
                    aria-label={`Delete ${p.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p
                className={cn(
                  "text-[10px]",
                  walletTrust === "matches_verified"
                    ? "text-emerald-400/90"
                    : walletTrust === "unverified"
                      ? "text-amber-400/90"
                      : "text-muted-foreground",
                )}
              >
                {walletLabel}
              </p>
              {(p.priceUsd != null && p.priceUsd > 0) || p.priceLabel ? (
                <p className="text-[10px] text-muted-foreground">
                  {p.priceUsd != null && p.priceUsd > 0 ? `$${p.priceUsd.toFixed(2)}` : p.priceLabel}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }
  function renderOtherFormFields(
    values: FormState,
    onChange: (next: FormState) => void,
  ) {
    return (
      <div className="space-y-2">
        <input
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={values.title}
          onChange={(e) => onChange({ ...values, title: e.target.value })}
          placeholder="Service name"
        />
        <textarea
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm min-h-[60px]"
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          placeholder="Description (optional)"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={values.serviceType}
            onChange={(e) => onChange({ ...values, serviceType: e.target.value })}
          >
            <option value="x402">x402</option>
            <option value="custom">Custom paid endpoint</option>
          </select>
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            value={values.endpointUrl}
            onChange={(e) => onChange({ ...values, endpointUrl: e.target.value })}
            placeholder="Endpoint URL"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={values.priceUsd}
            onChange={(e) => onChange({ ...values, priceUsd: e.target.value })}
            placeholder="Price USD"
            inputMode="decimal"
          />
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={values.priceLabel}
            onChange={(e) => onChange({ ...values, priceLabel: e.target.value })}
            placeholder="Price label"
          />
        </div>
        <input
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
          value={values.paymentWallet}
          onChange={(e) => onChange({ ...values, paymentWallet: e.target.value })}
          placeholder="Payment wallet"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={values.isPublished}
            onChange={(e) => onChange({ ...values, isPublished: e.target.checked })}
          />
          Published on public profile
        </label>
      </div>
    );
  }
  return (
    <div
      className={cn(
        embedded ? "space-y-4" : "ui-overview-panel rounded-xl p-4 space-y-5",
      )}
    >
      {formMode === "overview" ? (
        <>
          <div
            className={cn(
              embedded
                ? "ui-overview-panel-header flex flex-col gap-2 rounded-xl px-4 py-3.5 sm:flex-row sm:flex-wrap"
                : "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
            )}
          >
            {!embedded ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold">Monetization</p>
                <p className="text-xs text-muted-foreground max-w-xl">
                  List paid endpoints on your public agent profile. Use Xona xPay for the simplest path, or add custom x402 listings.
                </p>
              </div>
            ) : null}
            <div
              className={cn(
                "flex gap-2",
                embedded ? "w-full sm:w-auto" : "flex-wrap",
              )}
            >
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={embedded ? "flex-1 sm:flex-none" : undefined}
                onClick={startXPayService}
              >
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                Add xPay listing
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={embedded ? "flex-1 sm:flex-none" : undefined}
                onClick={startOtherService}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Other paid service
              </Button>
            </div>
          </div>
          {!embedded || publishedXPayCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Image
                  src="/partners/xona/xona-mark.png"
                  alt=""
                  width={18}
                  height={18}
                  className="object-contain shrink-0"
                />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Xona xPay</span>
                  {" · "}
                  {publishedXPayCount > 0
                    ? `${publishedXPayCount} live listing${publishedXPayCount === 1 ? "" : "s"}`
                    : "No live xPay listings yet"}
                </p>
              </div>
              {publicProfileHref ? (
                <Link
                  href={publicProfileHref}
                  target="_blank"
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  View on profile
                </Link>
              ) : null}
            </div>
          ) : null}
          {publishedNotice ? (
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.08] px-3 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm text-emerald-100">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                  <span>
                    <span className="font-medium">{publishedNotice}</span> is live as an xPay listing.
                  </span>
                </p>
                {publicProfileHref ? (
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link href={publicProfileHref} target="_blank">
                      View on profile
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {paidServices.length > 0 ? (
            embedded ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Your listings
                </p>
                {renderServiceList(paidServices, "")}
              </div>
            ) : (
              <>
                {xpayServices.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      xPay listings
                    </p>
                    {renderServiceList(xpayServices, "No xPay listings yet.")}
                  </div>
                ) : null}
                {otherServices.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Other paid services
                    </p>
                    {renderServiceList(otherServices, "No other paid services.")}
                  </div>
                ) : null}
              </>
            )
          ) : (
            <div className="rounded-xl border border-border bg-[#212121] px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {x402State.detected
                  ? "x402 is detected on this agent. Add a listing above to publish a paid endpoint on your profile."
                  : "No paid listings yet. Use the buttons above to add an xPay listing or other paid service."}
              </p>
            </div>
          )}
        </>
      ) : null}
      {formMode === "xpay" ? (
        <div className={cn(embedded && "ui-overview-panel rounded-xl p-4 space-y-4")}>
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancelForm}>
              ← Back
            </Button>
          </div>
          <DashboardXPaySetupPanel
            form={toXPayForm(form)}
            onChange={(xpay) => {
              setValidationError(null);
              if (xpay.endpointUrl !== form.endpointUrl) {
                setScanHint(null);
                setLiveX402State(null);
              }
              setForm((prev) => fromXPayForm(prev, xpay));
            }}
            trustedWallets={allTrusted}
            x402State={x402State}
            scanning={scanning}
            onScan={() => void scanX402(form.endpointUrl)}
            saving={saving}
            onSubmit={() => void addPaidService("xpay")}
            validationError={validationError}
            publishedXPayCount={publishedXPayCount}
            scanHint={scanHint}
          />
        </div>
      ) : null}
      {formMode === "other" ? (
        <div className={cn("space-y-4", embedded && "ui-overview-panel rounded-xl p-4")}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Add other paid service</p>
              <p className="text-xs text-muted-foreground">x402 or custom endpoints without the xPay tag.</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={cancelForm}>
              Cancel
            </Button>
          </div>
          {validationError ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              {validationError}
            </p>
          ) : null}
          {renderOtherFormFields(form, (next) => {
            setValidationError(null);
            setForm(next);
          })}
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void addPaidService("other")}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Add paid service
          </Button>
        </div>
      ) : null}
      {formMode === "overview" ? (
        <div className={cn(!embedded && "border-t border-border/50 pt-3")}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowAdvanced((open) => !open)}
          >
            <span>Advanced: readiness score & x402 tools</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvanced && "rotate-180")} />
          </button>
          {showAdvanced ? (
            <div className="mt-3 space-y-4 rounded-lg border border-border/60 bg-muted/10 p-3">
              {readiness ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    Monetization readiness:{" "}
                    <span className="font-semibold tabular-nums">
                      {readiness.score}/{readiness.maxScore}
                    </span>
                  </p>
                  <ul className="text-[11px] text-muted-foreground space-y-1">
                    {readiness.items.map((item) => (
                      <li key={item.id} className={item.done ? "text-emerald-400/90" : undefined}>
                        {item.done ? "✓" : "○"} {item.label} (+{item.points})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <DashboardX402ReadinessCard state={x402State} />
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                  value={scanEndpoint}
                  onChange={(e) => setScanEndpoint(e.target.value)}
                  placeholder="x402 endpoint URL to scan"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={scanning || !scanEndpoint.trim()}
                  onClick={() => void scanX402()}
                >
                  {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Scan"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit {isXPayServiceType(editForm.serviceType) ? "xPay listing" : "paid service"}
            </DialogTitle>
          </DialogHeader>
          {isXPayServiceType(editForm.serviceType) ? (
            <DashboardXPaySetupPanel
              form={toXPayForm(editForm)}
              onChange={(xpay) => {
                if (xpay.endpointUrl !== editForm.endpointUrl) {
                  setLiveX402State(null);
                }
                setEditForm((prev) => fromXPayForm(prev, xpay));
              }}
              trustedWallets={allTrusted}
              x402State={x402State}
              scanning={scanning}
              onScan={() => void scanX402(editForm.endpointUrl)}
              saving={saving}
              onSubmit={() => void saveEdit()}
              validationError={null}
              publishedXPayCount={publishedXPayCount}
              compact
              submitLabel="Save changes"
            />
          ) : (
            renderOtherFormFields(editForm, setEditForm)
          )}
          {!isXPayServiceType(editForm.serviceType) ? (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={saving} onClick={() => void saveEdit()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
      <DashboardConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete paid service?"
        description={`Remove "${deleteTarget?.title ?? "this listing"}"? This cannot be undone.`}
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
function MonetizationPanelFallback() {
  return (
    <div className="ui-overview-panel flex items-center justify-center rounded-xl p-8 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      Loading monetization…
    </div>
  );
}
export function DashboardMonetizationPanel(props: Props) {
  return (
    <Suspense fallback={<MonetizationPanelFallback />}>
      <DashboardMonetizationPanelInner {...props} />
    </Suspense>
  );
}
