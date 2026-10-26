"use client";
import { useCallback, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, Clock, XCircle, RefreshCw, ExternalLink, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import { POWER_BOOST_TIERS, AD_TIERS, VERIFIED_REVENUE_TIERS } from "@/lib/product-config";
export interface AdminOrderDto {
  id: string;
  orderNumber: string;
  productType: string;
  tier: string;
  usdPrice: number;
  cryptoAmount: string;
  paymentAsset: string;
  wallet: string;
  email: string;
  referralCode?: string;
  txHash: string | null;
  status: string;
  agentId: number | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
  agent: { id: number; name: string; agentId: number; chainId: number; profilePath: string } | null;
  agentBoost: { id: number } | null;
  adPackage: { id: number; status: string } | null;
}
const STATUS_TABS = [
  { label: "All",       value: "all" },
  { label: "Pending",   value: "pending" },
  { label: "Paid",      value: "paid" },
  { label: "Expired",   value: "expired" },
  { label: "Cancelled", value: "cancelled" },
];
const PRODUCT_TYPES = [
  { value: "kya_verify",       label: "KYA Verify" },
  { value: "power_boost",      label: "Reputation boost" },
  { value: "ad",               label: "Ad Package" },
  { value: "verified_revenue", label: "Verified Revenue" },
  { value: "pro_subscription", label: "Pro Subscription" },
];
function tiersFor(productType: string): { value: string; label: string }[] {
  if (productType === "power_boost")
    return POWER_BOOST_TIERS.map((t) => ({ value: t.label, label: `${t.label} — +${t.units} pts / ${t.durationHours}h ($${t.priceUsd})` }));
  if (productType === "ad")
    return AD_TIERS.map((t) => ({ value: t.label, label: `${t.label} — ${t.durationDays}d ($${t.priceUsd})` }));
  if (productType === "verified_revenue")
    return VERIFIED_REVENUE_TIERS.map((t) => ({ value: t.label, label: `${t.label} — ${t.durationDays}d ($${t.priceUsd})` }));
  return [];
}
function productTypeLabel(t: string) {
  if (t === "power_boost")      return "Reputation boost";
  if (t === "ad")               return "Ad Package";
  if (t === "kya_verify")       return "KYA Verify";
  if (t === "verified_revenue") return "Verified Revenue";
  if (t === "pro_subscription") return "Pro Sub";
  return t;
}
function StatusBadge({ status }: { readonly status: string }) {
  const cls =
    status === "paid"      ? "text-green-400 bg-green-900/30" :
    status === "pending"   ? "text-yellow-400 bg-yellow-900/30" :
    status === "expired"   ? "text-gray-400 bg-gray-800" :
    "text-red-400 bg-red-900/30";
  return (
    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", cls)}>
      {status}
    </span>
  );
}
// ── Manual Grant Modal ────────────────────────────────────────────────────────
function ManualGrantModal({ onClose, onDone }: { readonly onClose: () => void; readonly onDone: () => void }) {
  const [productType, setProductType] = useState("kya_verify");
  const [tier, setTier]               = useState(() => tiersFor("kya_verify")[0]?.value ?? "");
  const [agentId, setAgentId]         = useState("");
  const [wallet, setWallet]           = useState("");
  const [email, setEmail]             = useState("");
  const [overridePrice, setOverridePrice] = useState("");
  const [bannerUrl, setBannerUrl]     = useState("");
  const [linkUrl, setLinkUrl]         = useState("");
  const [adText, setAdText]           = useState("");
  const [notes, setNotes]             = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState<string | null>(null);
  const tiers = tiersFor(productType);
  function selectProductType(nextProductType: string) {
    setProductType(nextProductType);
    setTier(tiersFor(nextProductType)[0]?.value ?? "");
  }
  const needsAgent = productType !== "pro_subscription";
  const isAd = productType === "ad";
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/orders/manual-grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productType,
          tier,
          agentId: agentId.trim() ? Number(agentId) : undefined,
          wallet: wallet.trim() || undefined,
          email: email.trim() || undefined,
          overridePrice: overridePrice.trim() ? Number(overridePrice) : undefined,
          bannerUrl: bannerUrl.trim() || undefined,
          linkUrl: linkUrl.trim() || undefined,
          adText: adText.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json() as { ok?: boolean; orderNumber?: string; error?: string };
      if (!res.ok) { setError(data.error ?? "Failed"); return; }
      setSuccess(`✓ Granted ${productTypeLabel(productType)}${tier ? ` (${tier})` : ""} — ${data.orderNumber}`);
      onDone();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Plus className="size-4 text-primary" /> Manual Grant / Override
          </h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <XCircle className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Product type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Product Type *</label>
              <select
                value={productType}
                onChange={(e) => selectProductType(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {PRODUCT_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            {tiers.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Tier *</label>
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {tiers.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {/* Agent ID */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Agent DB ID {needsAgent ? "*" : "(optional)"}
              <span className="ml-1 text-[10px] opacity-60">— the numeric id from /admin/verified-agents</span>
            </label>
            <input
              type="number"
              placeholder="e.g. 1"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              required={needsAgent}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          {/* Wallet + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Wallet address</label>
              <input
                type="text"
                placeholder="0x..."
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <input
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          {/* Override price */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Override price (USD) <span className="opacity-60">— leave blank to use standard price, enter 0 for free</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 49 or 0"
              value={overridePrice}
              onChange={(e) => setOverridePrice(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          {/* Ad creative (only for ad product) */}
          {isAd && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ad Creative</p>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Agent profile link URL</label>
                <input type="url" placeholder="https://agentranking.io/agents/8453/123/current-agent-name" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Banner image URL</label>
                <input type="url" placeholder="https://..." value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Ad text (max 220 chars)</label>
                <input type="text" maxLength={220} value={adText} onChange={(e) => setAdText(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              </div>
            </div>
          )}
          {/* Notes */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Internal notes (optional)</label>
            <input
              type="text"
              placeholder="e.g. Paid via bank transfer, support ticket #123"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
          {success && <p className="text-sm text-green-400 bg-green-900/20 rounded-lg px-3 py-2">{success}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? <><Loader2 className="size-4 mr-2 animate-spin" /> Granting…</> : "Grant & Activate Now"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            This immediately activates the product — no payment required. An order record is created for your audit trail.
          </p>
        </form>
      </div>
    </div>
  );
}
// ── Main Page ─────────────────────────────────────────────────────────────────
export function AdminOrdersClient({
  initialStatus,
  initialData,
}: {
  readonly initialStatus: string;
  readonly initialData: { orders: AdminOrderDto[]; total: number };
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const statusFilter = searchParams.get("status") ?? initialStatus;
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showGrant, setShowGrant] = useState(false);
  const loadOrders = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/admin/orders?status=${statusFilter}&perPage=100`, {
      signal,
    });
    if (!response.ok) throw new Error("Failed to load orders");
    const payload = (await response.json()) as {
      orders: AdminOrderDto[];
      total: number;
    };
    return { orders: payload.orders, total: payload.total };
  }, [statusFilter]);
  const queryClient = useQueryClient();
  const ordersQuery = useQuery({
    queryKey: adminKeys.orders({ status: statusFilter, perPage: 100 }),
    queryFn: ({ signal }) => loadOrders(signal),
    initialData: statusFilter === initialStatus ? initialData : undefined,
    refetchOnMount: false,
  });
  const orders = ordersQuery.data?.orders ?? [];
  const total = ordersQuery.data?.total ?? 0;
  const loading = ordersQuery.isPending;
  const initialLoading = loading && ordersQuery.data == null;
  const refreshOrders = () => queryClient.invalidateQueries({ queryKey: adminKeys.orders({ status: statusFilter, perPage: 100 }) });
  async function markPaid(orderId: string) {
    setActionLoading(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/mark-paid`, { method: "POST" });
      if (res.ok) refreshOrders();
      else {
        const d = await res.json() as { error?: string };
        alert(d.error ?? "Failed");
      }
    } finally {
      setActionLoading(null);
    }
  }
  async function cancelOrder(orderId: string) {
    if (!confirm("Cancel this order?")) return;
    setActionLoading(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/cancel`, { method: "POST" });
      if (res.ok) refreshOrders();
      else {
        const d = await res.json() as { error?: string };
        alert(d.error ?? "Failed");
      }
    } finally {
      setActionLoading(null);
    }
  }
  return (
    <div>
      {showGrant && (
        <ManualGrantModal
          onClose={() => setShowGrant(false)}
          onDone={refreshOrders}
        />
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-sm text-muted-foreground">{total} total</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowGrant(true)} size="sm" className="gap-1.5">
            <Plus className="size-4" /> Manual Grant
          </Button>
          <Button variant="outline" size="sm" onClick={refreshOrders} disabled={loading}>
            <RefreshCw className={cn("size-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>
      {/* Status filter tabs */}
      <div className="flex gap-2 mb-6 border-b border-border pb-2 flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => router.push(`/admin/orders?status=${tab.value}`)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              statusFilter === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {initialLoading ? (
        <div className="text-muted-foreground text-sm flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading orders...
        </div>
      ) : orders.length === 0 ? (
        <div className="text-muted-foreground text-sm">No orders found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-3 pr-4">Order #</th>
                <th className="text-left py-3 pr-4">Product</th>
                <th className="text-left py-3 pr-4">Tier</th>
                <th className="text-left py-3 pr-4">Agent</th>
                <th className="text-left py-3 pr-4">Receipt / wallet</th>
                <th className="text-left py-3 pr-4">Price</th>
                <th className="text-left py-3 pr-4">Status</th>
                <th className="text-left py-3 pr-4">Created</th>
                <th className="text-left py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-3 pr-4 font-mono text-xs">{order.orderNumber}</td>
                  <td className="py-3 pr-4">
                    <span className={cn(
                      "text-xs font-medium px-1.5 py-0.5 rounded",
                      order.productType === "kya_verify"       ? "bg-amber-500/10 text-amber-400" :
                      order.productType === "power_boost"      ? "bg-purple-500/10 text-purple-400" :
                      order.productType === "ad"               ? "bg-blue-500/10 text-blue-400" :
                      order.productType === "verified_revenue" ? "bg-emerald-500/10 text-emerald-400" :
                      "bg-primary/10 text-primary"
                    )}>
                      {productTypeLabel(order.productType)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{order.tier || "—"}</td>
                  <td className="py-3 pr-4">
                    {order.agent ? (
                      <a
                        href={order.agent.profilePath}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline flex items-center gap-1"
                      >
                        {order.agent.name}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 align-top">
                    <div className="space-y-1 max-w-[200px]">
                      <div className="text-xs">
                        <span className="text-muted-foreground">Receipt </span>
                        {order.email?.trim() ? (
                          <a
                            href={`mailto:${order.email}`}
                            className="text-foreground hover:text-primary break-all"
                            title={order.email}
                          >
                            {order.email}
                          </a>
                        ) : (
                          <span className="text-amber-400/80">No email</span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {order.wallet !== "admin-manual"
                          ? `${order.wallet.slice(0, 6)}…${order.wallet.slice(-4)}`
                          : <span className="text-amber-400/70">admin</span>}
                      </div>
                      {order.referralCode?.trim() ? (
                        <div className="text-[10px] text-violet-400 font-mono">
                          Ref {order.referralCode}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className="font-medium">${order.usdPrice}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground text-xs">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      {order.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-green-400 border-green-800 hover:bg-green-900/30"
                            disabled={actionLoading === order.id}
                            onClick={() => markPaid(order.id)}
                          >
                            <CheckCircle className="size-3 mr-1" />
                            Mark paid
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-red-400 border-red-800 hover:bg-red-900/30"
                            disabled={actionLoading === order.id}
                            onClick={() => cancelOrder(order.id)}
                          >
                            <XCircle className="size-3 mr-1" />
                            Cancel
                          </Button>
                        </>
                      )}
                      {order.txHash && !order.txHash.startsWith("manual") && !order.txHash.startsWith("admin") && (
                        <a
                          href={`https://basescan.org/tx/${order.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                      {order.status === "paid" && (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <Clock className="size-3" />
                          {order.paidAt ? new Date(order.paidAt).toLocaleDateString() : "—"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
