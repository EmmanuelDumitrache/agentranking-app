"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useState, useCallback, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pencil,
  Loader2,
  ExternalLink,
  Plus,
  RefreshCw,
  MessageSquare,
  TrendingUp,
  Rocket,
  Building2,
  Crown,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { AD_TEXT_MAX_CHARS, AD_TIERS } from "@/lib/product-config";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  ADVERTISER_NAME_MAX_CHARS,
  DEFAULT_AD_ACCENT_COLOR,
  DEFAULT_AD_ICON_KEY,
  normalizeAdAccentColor,
  normalizeAdIconKey,
  normalizeAdvertiserDisplayName,
  type AdIconKey,
} from "@/lib/ad-theme";
import { AdThemeControls, AdThemeIcon } from "@/components/ads/ad-theme-controls";
import { ImageCropDialog } from "@/components/shared/image-crop-dialog";
import { useObjectUrlRevocation } from "./use-object-url-revocation";
export interface AdminAdDto {
  source: "direct" | "package";
  id: number;
  bannerUrl: string;
  linkUrl: string;
  adText: string;
  days: number;
  status: string;
  expiresAt: string;
  wallet: string;
  orderNumber: string | null;
  createdAt: string;
  tier: string | null;
  agentName: string | null;
  agentChainId: number | null;
  agentOnChainId: number | null;
  agentProfilePath: string | null;
  stripAdvertiserName: string;
  adIconKey: string;
  adAccentColor: string;
  vipAd: boolean;
  packageOrigin: "checkout" | "manual" | null;
}
const TIER_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Starter: MessageSquare,
  Growth: TrendingUp,
  Launch: Rocket,
};
const AR_TEMPLATE = {
  stripAdvertiserName: "AgentRanking",
  adText: "Discover and rank verified AI agents on-chain. Promote yours on AgentRanking.",
  linkUrl: "/",
} as const;
const STATUSES = ["pending", "active", "removed"] as const;
function statusClass(status: string): string {
  if (status === "active") return "text-green-600";
  if (status === "removed") return "text-muted-foreground";
  return "";
}
function expiresLocalValue(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}
function BannerPreviewCell({ bannerUrl }: { readonly bannerUrl: string }) {
  const b = bannerUrl?.trim();
  if (!b) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <a
      href={b}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-24 h-12 rounded overflow-hidden border border-border hover:border-primary/50 transition-colors"
    >
      <RuntimeImage src={b} alt="" className="w-full h-full object-cover" />
    </a>
  );
}
function StripTextCell({ adText }: { readonly adText: string }) {
  const t = adText?.trim();
  if (!t) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="text-xs text-muted-foreground line-clamp-2 max-w-[160px]" title={t}>
      {t}
    </span>
  );
}
function AdminAdPlacementPreview({
  name,
  adText,
  bannerUrl,
  iconKey,
  accentColor,
}: {
  readonly name: string;
  readonly adText: string;
  readonly bannerUrl: string;
  readonly iconKey: AdIconKey;
  readonly accentColor: string;
}) {
  const label = name.trim() || "Advertiser";
  const text = adText.trim() || "Text banner copy preview";
  const banner = bannerUrl.trim();
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Live placement preview</p>
        <span className="text-[10px] text-muted-foreground">desktop + mobile</span>
      </div>
      <div className="rounded-md border border-border bg-background px-3 py-2">
        <div className="flex items-center gap-2 min-w-0 text-xs">
          <AdThemeIcon iconKey={iconKey} accentColor={accentColor} className="size-3.5" />
          <span className="font-semibold shrink-0 whitespace-nowrap">{label}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="truncate text-muted-foreground">{text}</span>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[16rem_1fr]">
        <div className="rounded-lg border border-border bg-background overflow-hidden w-64 max-w-full">
          <div className="w-full h-36 bg-black/20 flex items-center justify-center overflow-hidden">
            {banner ? (
              <RuntimeImage src={banner} alt="" className="w-full h-full object-contain" />
            ) : (
              <span className="text-[11px] text-muted-foreground">Corner popup banner</span>
            )}
          </div>
          <div className="border-t border-border px-2 py-1.5 text-xs whitespace-nowrap flex items-center gap-1.5">
            <span
              className="inline-flex size-5 items-center justify-center rounded"
              style={{ backgroundColor: `${accentColor}22` }}
            >
              <AdThemeIcon iconKey={iconKey} accentColor={accentColor} className="size-3" />
            </span>
            {label}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background overflow-hidden w-full max-w-[18rem]">
          <div className="w-full h-36 bg-black/20 flex items-center justify-center overflow-hidden">
            {banner ? (
              <RuntimeImage src={banner} alt="" className="w-full h-full object-contain" />
            ) : (
              <span className="text-[10px] text-muted-foreground">Mobile width</span>
            )}
          </div>
          <div className="border-t border-border px-2 py-1.5 text-xs whitespace-nowrap flex items-center gap-1.5">
            <span
              className="inline-flex size-5 items-center justify-center rounded"
              style={{ backgroundColor: `${accentColor}22` }}
            >
              <AdThemeIcon iconKey={iconKey} accentColor={accentColor} className="size-3" />
            </span>
            {label}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Active ads rotate through the strip and popup pool. Pending/removed ads are excluded until published.
      </p>
    </div>
  );
}
export function AdminAdsClient({ initialAds }: { readonly initialAds: AdminAdDto[] }) {
  const [editModal, setEditModal] = useState<AdminAdDto | null>(null);
  const [editLinkUrl, setEditLinkUrl] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editExpiresLocal, setEditExpiresLocal] = useState("");
  const [editAdText, setEditAdText] = useState("");
  const [editBannerUrl, setEditBannerUrl] = useState("");
  const [editStripAdvertiserName, setEditStripAdvertiserName] = useState("");
  const [editAdIconKey, setEditAdIconKey] = useState<AdIconKey>(DEFAULT_AD_ICON_KEY);
  const [editAdAccentColor, setEditAdAccentColor] = useState(DEFAULT_AD_ACCENT_COLOR);
  const [editDays, setEditDays] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTemplate, setCreateTemplate] = useState<"custom" | "ar">("custom");
  const [createTier, setCreateTier] = useState<string>("Growth");
  const [createDurationOverride, setCreateDurationOverride] = useState("");
  const [createLinkUrl, setCreateLinkUrl] = useState("");
  const [createAdText, setCreateAdText] = useState("");
  const [createStripName, setCreateStripName] = useState("");
  const [createAdIconKey, setCreateAdIconKey] = useState<AdIconKey>(DEFAULT_AD_ICON_KEY);
  const [createAdAccentColor, setCreateAdAccentColor] = useState(DEFAULT_AD_ACCENT_COLOR);
  const [createBannerUrl, setCreateBannerUrl] = useState("");
  const [createBannerPreviewUrl, setCreateBannerPreviewUrl] = useState("");
  const [createAgentId, setCreateAgentId] = useState("");
  const [createStatus, setCreateStatus] = useState<"pending" | "active">("active");
  const [createVipAd, setCreateVipAd] = useState(false);
  const [createUploading, setCreateUploading] = useState(false);
  const [createCropFile, setCreateCropFile] = useState<File | null>(null);
  const [createCropOpen, setCreateCropOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [editTier, setEditTier] = useState("");
  const [editPackageDurationDays, setEditPackageDurationDays] = useState("");
  const [editVipAd, setEditVipAd] = useState(false);
  const loadAds = useCallback(async (signal: AbortSignal): Promise<AdminAdDto[]> => {
    const params = new URLSearchParams({ activeOnly: String(!showAll) });
    const response = await fetch(`/api/admin/ads?${params}`, { signal });
    if (!response.ok) throw new Error(`Could not load ads (${response.status})`);
    const data = (await response.json()) as { ads?: AdminAdDto[] };
    return (data.ads ?? []).map((ad) => ({
      ...ad,
      agentName: ad.agentName ?? null,
      agentChainId: ad.agentChainId ?? null,
      agentOnChainId: ad.agentOnChainId ?? null,
      stripAdvertiserName: ad.stripAdvertiserName ?? "",
      adIconKey: normalizeAdIconKey(ad.adIconKey),
      adAccentColor: normalizeAdAccentColor(ad.adAccentColor),
      vipAd: Boolean(ad.vipAd),
      packageOrigin: ad.packageOrigin ?? null,
    }));
  }, [showAll]);
  const adsQuery = useQuery({
    queryKey: adminKeys.ads({ status: showAll ? "all" : "active" }),
    queryFn: async ({ signal }) => loadAds(signal),
    initialData: showAll ? undefined : initialAds,
    refetchOnMount: false,
  });
  const ads = adsQuery.data ?? [];
  const loading = adsQuery.isPending;
  const refreshAds = () => void adsQuery.refetch();
  useObjectUrlRevocation(createBannerPreviewUrl);
  function openEditModal(ad: AdminAdDto) {
    setSaveError(null);
    setEditModal(ad);
    setEditLinkUrl(ad.linkUrl);
    setEditStatus(ad.status);
    setEditExpiresLocal(expiresLocalValue(ad.expiresAt));
    setEditAdText(ad.adText);
    setEditBannerUrl(ad.bannerUrl);
    setEditStripAdvertiserName(ad.stripAdvertiserName ?? "");
    setEditAdIconKey(normalizeAdIconKey(ad.adIconKey));
    setEditAdAccentColor(normalizeAdAccentColor(ad.adAccentColor));
    setEditDays(String(ad.days));
    setEditTier(ad.tier && AD_TIERS.some((t) => t.label === ad.tier) ? ad.tier : "Growth");
    setEditPackageDurationDays(String(ad.days));
    setEditVipAd(Boolean(ad.vipAd));
  }
  function resetCreateForm() {
    setCreateTemplate("custom");
    setCreateTier("Growth");
    setCreateDurationOverride("");
    setCreateLinkUrl("");
    setCreateAdText("");
    setCreateStripName("");
    setCreateAdIconKey(DEFAULT_AD_ICON_KEY);
    setCreateAdAccentColor(DEFAULT_AD_ACCENT_COLOR);
    setCreateBannerUrl("");
    setCreateBannerPreviewUrl("");
    setCreateAgentId("");
    setCreateStatus("active");
    setCreateVipAd(false);
    setCreateError(null);
  }
  function applyCreateTemplate(t: "custom" | "ar") {
    setCreateTemplate(t);
    if (t === "ar") {
      setCreateStripName(AR_TEMPLATE.stripAdvertiserName);
      setCreateAdText(AR_TEMPLATE.adText);
      setCreateLinkUrl(AR_TEMPLATE.linkUrl);
      setCreateAdIconKey("megaphone");
      setCreateAdAccentColor("#22c55e");
    }
  }
  async function uploadCreateCroppedBanner(cropped: File) {
    setCreateError(null);
    setCreateUploading(true);
    try {
      const previewUrl = URL.createObjectURL(cropped);
      setCreateBannerPreviewUrl(previewUrl);
      const fd = new FormData();
      fd.set("file", cropped);
      const res = await fetch("/api/ads/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(typeof data.error === "string" ? data.error : "Upload failed");
        return;
      }
      if (typeof data.url === "string") {
        setCreateBannerUrl(data.url);
        setCreateBannerPreviewUrl("");
      }
    } catch {
      setCreateError("Upload failed");
    } finally {
      setCreateUploading(false);
    }
  }
  function handleCreateBannerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCreateCropFile(file);
    setCreateCropOpen(true);
  }
  async function handleCreateSubmit() {
    setCreateError(null);
    setCreateSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        tier: createTier,
        linkUrl: createLinkUrl.trim(),
        adText: createAdText.trim(),
        stripAdvertiserName: createStripName.trim(),
        adIconKey: createAdIconKey,
        adAccentColor: normalizeAdAccentColor(createAdAccentColor),
        bannerUrl: createBannerUrl.trim(),
        status: createStatus,
        vipAd: createVipAd,
      };
      const dur = createDurationOverride.trim();
      if (dur) {
        const n = Number.parseInt(dur, 10);
        if (!Number.isFinite(n) || n < 1 || n > 365) {
          setCreateError("Custom duration must be 1–365 days");
          setCreateSubmitting(false);
          return;
        }
        body.durationDays = n;
      }
      const aid = createAgentId.trim();
      if (aid) {
        const n = Number.parseInt(aid, 10);
        if (!Number.isFinite(n) || n < 1) {
          setCreateError("Invalid agent ID");
          setCreateSubmitting(false);
          return;
        }
        body.agentId = n;
      }
      const res = await fetch("/api/admin/ad-packages/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : "Create failed";
        const detail =
          typeof (data as { details?: string }).details === "string"
            ? (data as { details: string }).details
            : "";
        setCreateError(detail ? `${msg}\n${detail}` : msg);
        return;
      }
      setCreateOpen(false);
      resetCreateForm();
      refreshAds();
    } catch {
      setCreateError("Network error");
    } finally {
      setCreateSubmitting(false);
    }
  }
  async function handleSyncSlots() {
    setSyncFeedback(null);
    setSyncLoading(true);
    try {
      const res = await fetch("/api/admin/ads/reconcile-checkout-slots", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : "Sync failed";
        setSyncFeedback({ ok: false, message: msg });
        return;
      }
      const n = (data as { republishedPackageCount?: number }).republishedPackageCount;
      setSyncFeedback({
        ok: true,
        message:
          typeof n === "number"
            ? n === 0
              ? "No active paid packages to publish. Pending ads stay off the live site — set status to active and save, then sync again."
              : `Re-synced ${n} active package(s) to strip and sidebar. Pending packages are skipped until active.`
            : "Sync completed.",
      });
      refreshAds();
    } catch {
      setSyncFeedback({ ok: false, message: "Network error" });
    } finally {
      setSyncLoading(false);
    }
  }
  async function handleSaveEdit() {
    if (!editModal) return;
    setSaveError(null);
    setActionLoading(true);
    try {
      const body: Record<string, unknown> = {};
      if (editLinkUrl !== editModal.linkUrl) body.linkUrl = editLinkUrl;
      if (editStatus !== editModal.status) body.status = editStatus;
      const expiresChanged = editExpiresLocal !== expiresLocalValue(editModal.expiresAt);
      const packageDurationChanged =
        editModal.source === "package" &&
        Number.parseInt(editPackageDurationDays, 10) !== editModal.days;
      if (expiresChanged) {
        const d = new Date(editExpiresLocal);
        if (Number.isNaN(d.getTime())) {
          setSaveError("Invalid expiry date");
          setActionLoading(false);
          return;
        }
        if (!(editModal.source === "package" && packageDurationChanged)) {
          body.expiresAt = d.toISOString();
        }
      }
      if (editModal.source === "package") {
        if (editAdText !== editModal.adText) body.adText = editAdText;
        if (editBannerUrl !== editModal.bannerUrl) body.bannerUrl = editBannerUrl;
        if (editStripAdvertiserName !== (editModal.stripAdvertiserName ?? "")) {
          body.stripAdvertiserName = editStripAdvertiserName;
        }
        if (editAdIconKey !== normalizeAdIconKey(editModal.adIconKey)) body.adIconKey = editAdIconKey;
        if (normalizeAdAccentColor(editAdAccentColor) !== normalizeAdAccentColor(editModal.adAccentColor)) {
          body.adAccentColor = normalizeAdAccentColor(editAdAccentColor);
        }
        if (editTier !== (editModal.tier ?? "") && AD_TIERS.some((t) => t.label === editTier)) {
          body.tier = editTier;
        }
        if (packageDurationChanged) {
          const d = Number.parseInt(editPackageDurationDays, 10);
          if (!Number.isFinite(d) || d < 1 || d > 365) {
            setSaveError("Package days must be between 1 and 365");
            setActionLoading(false);
            return;
          }
          body.durationDays = d;
        }
        if (editVipAd !== Boolean(editModal.vipAd)) body.vipAd = editVipAd;
      } else {
        if (editBannerUrl !== editModal.bannerUrl) body.bannerUrl = editBannerUrl;
        const daysNum = Number.parseInt(editDays, 10);
        if (!Number.isFinite(daysNum) || daysNum < 1 || daysNum > 365) {
          setSaveError("Days must be between 1 and 365");
          setActionLoading(false);
          return;
        }
        if (daysNum !== editModal.days) body.days = daysNum;
      }
      if (Object.keys(body).length === 0) {
        setEditModal(null);
        setActionLoading(false);
        return;
      }
      const path =
        editModal.source === "package"
          ? `/api/admin/ad-packages/${editModal.id}`
          : `/api/admin/ads/${editModal.id}`;
      const res = await fetch(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : "Save failed";
        const detail =
          typeof (data as { details?: string }).details === "string"
            ? (data as { details: string }).details
            : "";
        setSaveError(detail ? `${msg}\n${detail}` : msg);
        return;
      }
      setEditModal(null);
      refreshAds();
    } catch {
      setSaveError("Network error");
    } finally {
      setActionLoading(false);
    }
  }
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Ads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Checkout ads, admin-created manual ads, and direct banner orders. Set status to{" "}
            <span className="text-foreground font-medium">active</span> to publish text strip + corner popup/sidebar.
            Saving or creating an active package re-syncs placements; use <strong className="text-foreground">Sync</strong>{" "}
            to re-publish all active packages after bulk changes.
          </p>
          {syncFeedback ? (
            <p
              className={`text-sm mt-2 ${syncFeedback.ok ? "text-green-600" : "text-destructive"}`}
              role="status"
            >
              {syncFeedback.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            size="sm"
            onClick={() => {
              resetCreateForm();
              setCreateOpen(true);
            }}
          >
            <Plus className="size-4 mr-1" />
            New ad
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSyncSlots}
            disabled={syncLoading}
          >
            {syncLoading ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="size-4 mr-1" />
            )}
            Sync
          </Button>
          <Button
            variant={showAll ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "Active only" : "Show all"}
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="text-muted-foreground py-8">Loading...</div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Banner</TableHead>
                <TableHead>Strip text</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ads.map((ad) => (
                <TableRow
                  key={`${ad.source}-${ad.id}`}
                  className={cn(
                    ad.vipAd &&
                      ad.source === "package" &&
                      "bg-amber-500/5 ring-1 ring-amber-400/25 ring-inset"
                  )}
                >
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {ad.source === "direct"
                      ? "Direct"
                      : ad.packageOrigin === "manual"
                        ? "Manual"
                        : "Checkout"}
                  </TableCell>
                  <TableCell className="max-w-[120px]">
                    {ad.source === "package" &&
                    ad.agentName &&
                    ad.agentChainId != null &&
                    ad.agentOnChainId != null &&
                    ad.agentProfilePath ? (
                      <Link
                        href={ad.agentProfilePath!}
                        className="text-xs text-primary hover:underline inline-flex items-center gap-0.5 truncate"
                        target="_blank"
                      >
                        {ad.agentName}
                        <ExternalLink className="size-3 shrink-0 opacity-60" />
                      </Link>
                    ) : ad.source === "package" && (ad.stripAdvertiserName ?? "").trim() ? (
                      <span className="text-xs text-muted-foreground truncate block" title={ad.stripAdvertiserName}>
                        {ad.stripAdvertiserName.trim()}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <BannerPreviewCell bannerUrl={ad.bannerUrl} />
                  </TableCell>
                  <TableCell>
                    <StripTextCell adText={ad.adText} />
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs" title={ad.linkUrl}>
                    {ad.linkUrl || "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {ad.tier ?? "—"}
                      {ad.source === "package" && ad.vipAd ? (
                        <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0 text-[10px] font-medium text-amber-500">
                          <Crown className="size-3" />
                          VIP
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{ad.days}</TableCell>
                  <TableCell>
                    <span className={statusClass(ad.status)}>{ad.status}</span>
                  </TableCell>
                  <TableCell className="font-mono text-[10px] max-w-[100px] truncate" title={ad.orderNumber ?? ""}>
                    {ad.orderNumber ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {format(new Date(ad.expiresAt), "PPp")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEditModal(ad)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {ads.length === 0 && (
            <div className="py-12 px-4 text-center text-muted-foreground text-sm space-y-2">
              <p>No ads found.</p>
              <p>
                Paid ads appear here after checkout payment is confirmed.
                If you only created an order, complete payment first — or open{" "}
                <strong className="text-foreground">Admin → Orders</strong> for pending checkouts.
              </p>
              <p>
                Try <strong className="text-foreground">Show all</strong> if your ad expired.
              </p>
            </div>
          )}
        </div>
      )}
      <Dialog open={!!editModal} onOpenChange={(o: boolean) => !o && setEditModal(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit ad{" "}
              {editModal?.source === "package"
                ? editModal.packageOrigin === "manual"
                  ? "(manual)"
                  : "(checkout)"
                : "(direct)"}
            </DialogTitle>
          </DialogHeader>
          {editModal && (
            <div className="space-y-4">
              {saveError ? (
                <p className="text-sm text-destructive whitespace-pre-wrap break-words" role="alert">
                  {saveError}
                </p>
              ) : null}
              {editModal.source === "package" &&
                editModal.agentName &&
                editModal.agentChainId != null &&
                editModal.agentOnChainId != null &&
                editModal.agentProfilePath && (
                  <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">Linked agent (read-only)</p>
                    <Link
                      href={editModal.agentProfilePath!}
                      className="text-primary hover:underline inline-flex items-center gap-1"
                      target="_blank"
                    >
                      {editModal.agentName}
                      <ExternalLink className="size-3.5" />
                    </Link>
                  </div>
                )}
              <div className="space-y-2">
                <Label htmlFor="ad-expires">Placement expires (local time)</Label>
                <Input
                  id="ad-expires"
                  type="datetime-local"
                  value={editExpiresLocal}
                  onChange={(e) => setEditExpiresLocal(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Stored as UTC on the server after save.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ad-link">Link URL</Label>
                <Input
                  id="ad-link"
                  value={editLinkUrl}
                  onChange={(e) => setEditLinkUrl(e.target.value)}
                  placeholder="https://... or /agents/8453/123/current-agent-name"
                />
              </div>
              {editModal.source === "package" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="ad-strip-name">Display name override (strip / promo)</Label>
                    <Input
                      id="ad-strip-name"
                      value={editStripAdvertiserName}
                      onChange={(e) => setEditStripAdvertiserName(normalizeAdvertiserDisplayName(e.target.value))}
                      placeholder="Leave empty to use linked agent name"
                      maxLength={ADVERTISER_NAME_MAX_CHARS}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Optional. Max {ADVERTISER_NAME_MAX_CHARS} chars. Overrides the linked agent&apos;s profile name for ad chrome only.
                    </p>
                  </div>
                  <AdThemeControls
                    iconKey={editAdIconKey}
                    accentColor={editAdAccentColor}
                    onIconChange={setEditAdIconKey}
                    onAccentColorChange={(color: string) => setEditAdAccentColor(normalizeAdAccentColor(color))}
                    disabled={actionLoading}
                  />
                  <div className="space-y-2">
                    <Label htmlFor="ad-text">Strip ad text</Label>
                    <Textarea
                      id="ad-text"
                      value={editAdText}
                      onChange={(e) => setEditAdText(e.target.value)}
                      rows={4}
                      maxLength={AD_TEXT_MAX_CHARS}
                      className="resize-y min-h-[80px]"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      <span className="font-medium text-foreground/80">
                        {editAdText.length} / {AD_TEXT_MAX_CHARS}
                      </span>{" "}
                      — DB max {AD_TEXT_MAX_CHARS} chars. Strip shows ~2 lines on desktop; lead with the important phrase.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ad-banner">Banner image URL</Label>
                    <Input
                      id="ad-banner"
                      value={editBannerUrl}
                      onChange={(e) => setEditBannerUrl(e.target.value)}
                      placeholder="https://..."
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Recommended: square or 16:9 PNG/WebP. This appears in the corner popup and sidebar-style promo pool.
                    </p>
                  </div>
                  <AdminAdPlacementPreview
                    name={editStripAdvertiserName || editModal.agentName || ""}
                    adText={editAdText}
                    bannerUrl={editBannerUrl}
                    iconKey={editAdIconKey}
                    accentColor={editAdAccentColor}
                  />
                  <div className="space-y-2">
                    <Label>Tier</Label>
                    <Select value={editTier} onValueChange={setEditTier}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Tier" />
                      </SelectTrigger>
                      <SelectContent>
                        {AD_TIERS.map((t) => {
                          const Icon = TIER_ICONS[t.label] ?? MessageSquare;
                          return (
                            <SelectItem key={t.label} value={t.label}>
                              <span className="flex items-center gap-2">
                                <Icon className="size-4 text-muted-foreground" />
                                {t.label}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ad-pkg-days">Placement duration (days)</Label>
                    <Input
                      id="ad-pkg-days"
                      type="number"
                      min={1}
                      max={365}
                      value={editPackageDurationDays}
                      onChange={(e) => setEditPackageDurationDays(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Changing days re-anchors expiry from now. Prefer editing the datetime above for an exact end time.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="ad-vip"
                      checked={editVipAd}
                      onCheckedChange={(c: boolean) => setEditVipAd(c === true)}
                    />
                    <Label htmlFor="ad-vip" className="text-sm font-normal cursor-pointer">
                      VIP ad (gold styling on site)
                    </Label>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="ad-banner-direct">Banner image URL</Label>
                    <Input
                      id="ad-banner-direct"
                      value={editBannerUrl}
                      onChange={(e) => setEditBannerUrl(e.target.value)}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ad-days">Days (duration label)</Label>
                    <Input
                      id="ad-days"
                      type="number"
                      min={1}
                      max={365}
                      value={editDays}
                      onChange={(e) => setEditDays(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editStatus === "pending" &&
                (editBannerUrl.trim().length > 0 || editAdText.trim().length > 0) && (
                  <p
                    className="text-xs text-amber-700 dark:text-amber-400 border border-amber-500/35 rounded-md px-2 py-1.5 bg-amber-500/10"
                    role="status"
                  >
                    <strong className="font-medium">Draft mode:</strong> pending packages are removed from the live
                    strip, sidebar, and promo pool. Choose <strong>active</strong> and save to publish (or use{" "}
                    <strong>Sync</strong> only after everything is active).
                  </p>
                )}
              <p className="text-xs text-muted-foreground">
                Setting status to <strong>active</strong> publishes checkout creatives via sync (strip +
                sidebar). Direct rows also update matching on-chain slot rows when possible.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModal(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={actionLoading}>
              {actionLoading && <Loader2 className="size-4 animate-spin mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={createOpen}
        onOpenChange={(o: boolean) => {
          if (!o) {
            setCreateOpen(false);
            resetCreateForm();
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New manual ad</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {createError ? (
              <p className="text-sm text-destructive whitespace-pre-wrap break-words" role="alert">
                {createError}
              </p>
            ) : null}
            <div className="space-y-2">
              <Label>Template</Label>
              <Select
                value={createTemplate}
                onValueChange={(v: string) => applyCreateTemplate(v as "custom" | "ar")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">
                    <span className="flex items-center gap-2">
                      <Sparkles className="size-4 text-muted-foreground" />
                      Custom
                    </span>
                  </SelectItem>
                  <SelectItem value="ar">
                    <span className="flex items-center gap-2">
                      <Building2 className="size-4 text-muted-foreground" />
                      AgentRanking promo
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tier</Label>
              <Select value={createTier} onValueChange={setCreateTier}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Tier" />
                </SelectTrigger>
                <SelectContent>
                  {AD_TIERS.map((t) => {
                    const Icon = TIER_ICONS[t.label] ?? MessageSquare;
                    return (
                      <SelectItem key={t.label} value={t.label}>
                        <span className="flex items-center gap-2">
                          <Icon className="size-4 text-muted-foreground" />
                          {t.label} — {t.durationDays}d
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-duration">Custom duration (optional)</Label>
              <Input
                id="create-duration"
                type="number"
                min={1}
                max={365}
                placeholder={`Default from tier (${AD_TIERS.find((x) => x.label === createTier)?.durationDays ?? ""} days)`}
                value={createDurationOverride}
                onChange={(e) => setCreateDurationOverride(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-strip">Display name (strip / promo)</Label>
              <Input
                id="create-strip"
                value={createStripName}
                onChange={(e) => setCreateStripName(normalizeAdvertiserDisplayName(e.target.value))}
                placeholder="Shown next to strip text"
                maxLength={ADVERTISER_NAME_MAX_CHARS}
              />
              <p className="text-[10px] text-muted-foreground">
                Max {ADVERTISER_NAME_MAX_CHARS} chars. Ad text truncates before this name does.
              </p>
            </div>
            <AdThemeControls
              iconKey={createAdIconKey}
              accentColor={createAdAccentColor}
              onIconChange={setCreateAdIconKey}
              onAccentColorChange={(color: string) => setCreateAdAccentColor(normalizeAdAccentColor(color))}
              disabled={createSubmitting}
            />
            <div className="space-y-2">
              <Label htmlFor="create-link">Link URL</Label>
              <Input
                id="create-link"
                value={createLinkUrl}
                onChange={(e) => setCreateLinkUrl(e.target.value)}
                placeholder="https://... or /agents/8453/123/current-agent-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-text">Strip ad text</Label>
              <Textarea
                id="create-text"
                value={createAdText}
                onChange={(e) => setCreateAdText(e.target.value)}
                rows={3}
                maxLength={AD_TEXT_MAX_CHARS}
                className="resize-y min-h-[72px]"
              />
              <p className="text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {createAdText.length} / {AD_TEXT_MAX_CHARS}
                </span>{" "}
                — DB max {AD_TEXT_MAX_CHARS} chars. Strip shows ~2 lines on desktop; lead with the important phrase.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-banner-url">Banner image URL</Label>
              <Input
                id="create-banner-url"
                value={createBannerUrl}
                onChange={(e) => {
                  setCreateBannerUrl(e.target.value);
                  setCreateBannerPreviewUrl("");
                }}
                placeholder="https://..."
              />
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  id="create-banner-file"
                  onChange={handleCreateBannerFile}
                />
                <Button type="button" variant="outline" size="sm" asChild disabled={createUploading}>
                  <label htmlFor="create-banner-file" className={createUploading ? "pointer-events-none" : "cursor-pointer"}>
                    {createUploading ? <Loader2 className="size-4 animate-spin" /> : "Upload banner"}
                  </label>
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                PNG, JPG, GIF, or WebP are supported. Square and 16:9 creatives render best in the popup.
              </p>
            </div>
            <AdminAdPlacementPreview
              name={createStripName}
              adText={createAdText}
              bannerUrl={createBannerPreviewUrl || createBannerUrl}
              iconKey={createAdIconKey}
              accentColor={createAdAccentColor}
            />
            <div className="space-y-2">
              <Label htmlFor="create-agent">Linked agent ID (optional)</Label>
              <Input
                id="create-agent"
                type="number"
                min={1}
                placeholder="Database agent id — for profile image / verification"
                value={createAgentId}
                onChange={(e) => setCreateAgentId(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="create-vip"
                checked={createVipAd}
                onCheckedChange={(c: boolean) => setCreateVipAd(c === true)}
              />
              <Label htmlFor="create-vip" className="text-sm font-normal cursor-pointer">
                VIP ad (gold styling on site)
              </Label>
            </div>
            <div className="space-y-2">
              <Label>Initial status</Label>
              <Select
                value={createStatus}
                onValueChange={(v: string) => setCreateStatus(v as "pending" | "active")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">active (live on site)</SelectItem>
                  <SelectItem value="pending">pending (draft — not on site)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Default is <strong className="text-foreground/90 font-medium">active</strong> so new placements publish
                immediately after create.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                resetCreateForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateSubmit} disabled={createSubmitting}>
              {createSubmitting && <Loader2 className="size-4 animate-spin mr-1" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ImageCropDialog
        open={createCropOpen}
        file={createCropFile}
        onClose={() => {
          setCreateCropOpen(false);
          setCreateCropFile(null);
        }}
        onCropped={uploadCreateCroppedBanner}
      />
    </div>
  );
}
