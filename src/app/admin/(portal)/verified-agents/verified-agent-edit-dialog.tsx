"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Gift, Loader2, Plug, RefreshCw, Upload } from "lucide-react";
import { DashboardMcpOffersEditor } from "@/components/dashboard/mcp-offers-editor";
import { showToast } from "@/components/ui/toast-simple";
import { previewPersistedListingPowerScore } from "@/lib/agent-utils";
import {
  PUBLIC_REFERRAL_CODE_FIELD_MAX,
  PUBLIC_REFERRAL_DEST_MAX,
  PUBLIC_REFERRAL_INFO_MAX,
  publicReferralShareAbsoluteUrl,
} from "@/lib/agent-public-referral";
import { useSourceDraft } from "@/hooks/use-source-draft";
import type {
  AdminVerifiedAgentDetail,
  AdminVerifiedAgentDetailExtras,
  AdminVerifiedAgentDetailPayload,
} from "./verified-agents-types";

function mergeAdminVerifiedAgentDetailCache(qc: QueryClient, agentId: number, data: unknown) {
  if (typeof data !== "object" || data === null) return;
  const d = data as Partial<AdminVerifiedAgentDetailPayload>;
  if (!d.agent || !d.socialPresence) return;
  const computedAgentRankScore =
    typeof d.computedAgentRankScore === "number" ? d.computedAgentRankScore : null;
  if (computedAgentRankScore == null || !d.scoringLayerBreakdown) return;
  qc.setQueryData<AdminVerifiedAgentDetailPayload>(["admin-verified-agent", agentId], {
    agent: d.agent,
    computedAgentRankScore,
    scoringLayerBreakdown: d.scoringLayerBreakdown,
    socialPresence: d.socialPresence,
  });
}
function metadataBanner(metadata: AdminVerifiedAgentDetail["metadata"]): string {
  return metadata.find((m) => m.key === "banner")?.value ?? "";
}
function firstMeta(metadata: AdminVerifiedAgentDetail["metadata"], keys: string[]): string {
  const want = new Set(keys.map((k) => k.toLowerCase()));
  const row = metadata.find((m) => want.has(m.key.toLowerCase()));
  return row?.value ?? "";
}
type ServiceFormRow = { key: string; name: string; endpoint: string; version: string };
function rowsFromAgentServices(s: AdminVerifiedAgentDetail["services"] | undefined): ServiceFormRow[] {
  if (!s?.length) return [];
  return s.map((r) => ({
    key: `db-${r.id}`,
    name: r.name.toUpperCase(),
    endpoint: r.endpoint,
    version: r.version ?? "",
  }));
}
export function VerifiedAgentEditDialog({
  agent,
  extras,
  onClose,
  onSaved,
}: {
  agent: AdminVerifiedAgentDetail;
  extras: AdminVerifiedAgentDetailExtras;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useSourceDraft(agent.name, agent.name);
  const [description, setDescription] = useSourceDraft(agent.description, agent.description);
  const [image, setImage] = useSourceDraft(agent.image, agent.image);
  const initialBanner = metadataBanner(agent.metadata);
  const [banner, setBanner] = useSourceDraft(initialBanner, initialBanner);
  const [agentURI, setAgentURI] = useSourceDraft(agent.agentURI, agent.agentURI);
  const [owner, setOwner] = useSourceDraft(agent.owner, agent.owner);
  const [tokenAddress, setTokenAddress] = useSourceDraft(agent.tokenAddress, agent.tokenAddress);
  const [isVerified, setIsVerified] = useSourceDraft(String(agent.isVerified), agent.isVerified);
  const [isPremiumVerified, setIsPremiumVerified] = useSourceDraft(String(agent.isPremiumVerified), agent.isPremiumVerified);
  const [isActive, setIsActive] = useSourceDraft(String(agent.isActive), agent.isActive);
  const [isCustomListed, setIsCustomListed] = useSourceDraft(String(agent.isCustomListed), agent.isCustomListed);
  const initialWorkReadyStatus = agent.workReadyStatus ?? "none";
  const [workReadyStatus, setWorkReadyStatus] = useSourceDraft(initialWorkReadyStatus, initialWorkReadyStatus);
  const initialFeaturedWorkReady = agent.featuredWorkReady ?? false;
  const [featuredWorkReady, setFeaturedWorkReady] = useSourceDraft(String(initialFeaturedWorkReady), initialFeaturedWorkReady);
  const [imageUploading, setImageUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [bannerUploadError, setBannerUploadError] = useState<string | null>(null);
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [referralDialogOpen, setReferralDialogOpen] = useState(false);
  const initialRefCode = agent.publicReferralCode ?? "";
  const [refCode, setRefCode] = useSourceDraft(initialRefCode, initialRefCode);
  const initialRefDest = agent.publicReferralDestination ?? "";
  const [refDest, setRefDest] = useSourceDraft(initialRefDest, initialRefDest);
  const initialRefInfo = agent.publicReferralInfo ?? "";
  const [refInfo, setRefInfo] = useSourceDraft(initialRefInfo, initialRefInfo);
  const initialTwitter = firstMeta(agent.metadata, ["twitter", "x"]);
  const [twitter, setTwitter] = useSourceDraft(initialTwitter, initialTwitter);
  const initialWebsite = firstMeta(agent.metadata, ["website", "uri", "url"]);
  const [website, setWebsite] = useSourceDraft(initialWebsite, initialWebsite);
  const initialGithub = firstMeta(agent.metadata, ["github"]);
  const [github, setGithub] = useSourceDraft(initialGithub, initialGithub);
  const initialDiscord = firstMeta(agent.metadata, ["discord"]);
  const [discord, setDiscord] = useSourceDraft(initialDiscord, initialDiscord);
  const initialTelegram = firstMeta(agent.metadata, ["telegram"]);
  const [telegram, setTelegram] = useSourceDraft(initialTelegram, initialTelegram);
  const initialSvcRows = rowsFromAgentServices(agent.services);
  const [svcRows, setSvcRows] = useSourceDraft<ServiceFormRow[]>(JSON.stringify(initialSvcRows), initialSvcRows);
  const initialRank = String(agent.rank);
  const [rank] = useSourceDraft(initialRank, initialRank);
  const initialAgentRankDraft = String(agent.agentRankScore ?? 0);
  const [agentRankDraft, setAgentRankDraft] = useSourceDraft(initialAgentRankDraft, initialAgentRankDraft);
  const initialExecutionDraft = String(agent.executionScore);
  const [executionDraft, setExecutionDraft] = useSourceDraft(initialExecutionDraft, initialExecutionDraft);
  const initialPowerEstimate = previewPersistedListingPowerScore({
    score: Number(agent.score) || 0,
    activeBoosts: agent.activeBoosts ?? 0,
    voteFireCount: agent.voteFireCount ?? 0,
    votePooCount: agent.votePooCount ?? 0,
    adminPowerAdjust: Number(agent.adminPowerAdjust) || 0,
  });
  const initialPowerDraft = String(Math.round(agent.powerScore ?? initialPowerEstimate));
  const [powerDraft, setPowerDraft] = useSourceDraft(initialPowerDraft, initialPowerDraft);
  const initialAdminPowerAdjust = String(agent.adminPowerAdjust);
  const [adminPowerAdjust, setAdminPowerAdjust] = useSourceDraft(initialAdminPowerAdjust, initialAdminPowerAdjust);
  const initialDimDraft: Record<string, string> = {};
  for (const row of extras.scoringLayerBreakdown.rows) {
    initialDimDraft[row.key] = String(row.display);
  }
  const [dimDraft, setDimDraft] = useSourceDraft<Record<string, string>>(
    JSON.stringify(initialDimDraft),
    initialDimDraft,
  );
  const syncFromRegistry = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/verified-agents/${agent.id}/sync-from-registry`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Sync failed");
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      await qc.invalidateQueries({ queryKey: ["admin-verified-agent", agent.id] });
      showToast("Synced from chain");
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Sync failed", "error");
    },
  });
  const scoresConfirmMutation = useMutation({
    mutationFn: async () => {
      const agentRankScore = Number(agentRankDraft);
      const executionScore = Number(executionDraft);
      const pw = Number(powerDraft);
      if (!Number.isFinite(agentRankScore) || agentRankScore < 0 || agentRankScore > 100) {
        throw new Error("AR score must be a number between 0 and 100");
      }
      if (!Number.isFinite(executionScore) || executionScore < 0 || executionScore > 100) {
        throw new Error("Execution score must be a number between 0 and 100");
      }
      if (!Number.isFinite(pw) || pw < 0 || pw > 10_000_000) {
        throw new Error("Listing power must be a non-negative number (max 10,000,000)");
      }
      const res = await fetch(`/api/admin/verified-agents/${agent.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applyManualScores: true,
          agentRankScore: Math.round(agentRankScore),
          executionScore: Math.round(executionScore),
          powerScore: Math.round(pw),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Scores update failed");
      return data;
    },
    onSuccess: async (data) => {
      mergeAdminVerifiedAgentDetailCache(qc, agent.id, data);
      await qc.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      await qc.invalidateQueries({ queryKey: ["admin-verified-agent", agent.id] });
      showToast(
        "AR score pinned; layer overrides cleared. Global rank recalculated.",
      );
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Scores update failed", "error");
    },
  });
  const resumeScoresMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/verified-agents/${agent.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeAutoArScore: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Resume failed");
      return data;
    },
    onSuccess: async (data) => {
      mergeAdminVerifiedAgentDetailCache(qc, agent.id, data);
      await qc.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      await qc.invalidateQueries({ queryKey: ["admin-verified-agent", agent.id] });
      showToast("Formula AR restored; manual pin and layer overrides cleared. Rank recalculated.");
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Resume failed", "error");
    },
  });
  const formulaPowerMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/verified-agents/${agent.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recomputeListingPower: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Listing power recompute failed");
      return data;
    },
    onSuccess: async (data) => {
      mergeAdminVerifiedAgentDetailCache(qc, agent.id, data);
      await qc.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      await qc.invalidateQueries({ queryKey: ["admin-verified-agent", agent.id] });
      showToast("Listing power recalculated using the live rank formula for this row.");
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Recompute failed", "error");
    },
  });
  const formulaFullResetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/verified-agents/${agent.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeAutoArScore: true, recomputeListingPower: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Formula reset failed");
      return data;
    },
    onSuccess: async (data) => {
      mergeAdminVerifiedAgentDetailCache(qc, agent.id, data);
      await qc.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      await qc.invalidateQueries({ queryKey: ["admin-verified-agent", agent.id] });
      showToast("AR + listing power reset to formulas. Hard-refresh listing if cache lags.");
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Formula reset failed", "error");
    },
  });
  const layerMutation = useMutation({
    mutationFn: async (patch: Record<string, number | null>) => {
      const res = await fetch(`/api/admin/verified-agents/${agent.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoringLayerOverrides: patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as { error?: string; detail?: string };
        const msg =
          d.detail != null && String(d.detail).trim() !== ""
            ? `${d.error ?? "Request failed"}: ${d.detail}`
            : (d.error ?? "Trust breakdown update failed");
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: async (data) => {
      mergeAdminVerifiedAgentDetailCache(qc, agent.id, data);
      await qc.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      await qc.invalidateQueries({ queryKey: ["admin-verified-agent", agent.id] });
      showToast("Layer scores updated; global rank recalculated");
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Layer score update failed", "error");
    },
  });
  const patch = useMutation({
    mutationFn: async () => {
      const n = (s: string) => {
        const v = Number(s);
        return Number.isFinite(v) ? v : null;
      };
      const cleanedServices = svcRows
        .filter((r) => r.name.trim() && r.endpoint.trim())
        .map((r) => {
          const { key: _k, ...rest } = r;
          return {
            name: rest.name.trim().toUpperCase(),
            endpoint: rest.endpoint.trim(),
            version: rest.version.trim(),
          };
        });
      const res = await fetch(`/api/admin/verified-agents/${agent.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          image,
          banner,
          agentURI,
          owner,
          tokenAddress,
          isVerified,
          isPremiumVerified,
          isActive,
          isCustomListed,
          workReadyStatus,
          featuredWorkReady,
          socialMetadata: {
            twitter: twitter.trim(),
            website: website.trim(),
            github: github.trim(),
            discord: discord.trim(),
            telegram: telegram.trim(),
          },
          services: cleanedServices,
          publicReferralCode: refCode.trim() === "" ? null : refCode,
          publicReferralDestination: refDest,
          publicReferralInfo: refInfo,
          ...(n(rank) != null ? { rank: n(rank) } : {}),
          ...(n(adminPowerAdjust) != null ? { adminPowerAdjust: n(adminPowerAdjust) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Update failed");
      return data;
    },
    onSuccess: (data) => {
      mergeAdminVerifiedAgentDetailCache(qc, agent.id, data);
      qc.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      qc.invalidateQueries({ queryKey: ["admin-verified-agent", agent.id] });
      showToast("Agent saved. Public profile will refresh on next visit.");
      onSaved();
      onClose();
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    },
  });
  const referralMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/verified-agents/${agent.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicReferralCode: refCode.trim() === "" ? null : refCode,
          publicReferralDestination: refDest,
          publicReferralInfo: refInfo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as { error?: string; detail?: string };
        const msg =
          d.detail != null && String(d.detail).trim() !== ""
            ? `${d.error ?? "Request failed"} (${d.detail})`
            : (d.error ?? "Update failed");
        throw new Error(msg);
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-verified-agents"] });
      await qc.invalidateQueries({ queryKey: ["admin-verified-agent", agent.id] });
      showToast("Referral saved. Public profile will refresh.");
      setReferralDialogOpen(false);
    },
    onError: (e) => {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    },
  });
  const isSapListing =
    agent.sapVerified === true ||
    String(agent.listingRegistrySource ?? "")
      .trim()
      .toLowerCase() === "sap";
  const scoresBaselineAgentRank = String(
    agent.agentRankScore ?? 0,
  );
  const scoresBaselineExecution = Number.isFinite(agent.executionScore) ? String(agent.executionScore) : "";
  const adminAdjDraftNum = Number(adminPowerAdjust);
  const formulaPreviewPw = previewPersistedListingPowerScore({
    score: Number(agent.score) || 0,
    activeBoosts: agent.activeBoosts ?? 0,
    voteFireCount: agent.voteFireCount ?? 0,
    votePooCount: agent.votePooCount ?? 0,
    adminPowerAdjust: Number.isFinite(adminAdjDraftNum)
      ? adminAdjDraftNum
      : Number(agent.adminPowerAdjust) || 0,
  });
  const scoresBaselinePower = String(
    Math.round(agent.powerScore ?? previewPersistedListingPowerScore({
      score: Number(agent.score) || 0,
      activeBoosts: agent.activeBoosts ?? 0,
      voteFireCount: agent.voteFireCount ?? 0,
      votePooCount: agent.votePooCount ?? 0,
      adminPowerAdjust: Number(agent.adminPowerAdjust) || 0,
    })),
  );
  const scoresDirty =
    agentRankDraft.trim() !== scoresBaselineAgentRank.trim() ||
    executionDraft.trim() !== scoresBaselineExecution.trim() ||
    powerDraft.trim() !== scoresBaselinePower.trim();
  const manualAgentRankPinned = agent.metadata.some(
    (m) =>
      m.key === "admin_agent_rank_score_lock" &&
      typeof m.value === "string" &&
      m.value.trim().toLowerCase() === "1",
  );
  function applyLayerOverridesFromDraft() {
    const rows = extras.scoringLayerBreakdown.rows;
    const patch: Record<string, number | null> = {};
    for (const r of rows) {
      const raw = dimDraft[r.key]?.trim() ?? "";
      if (raw === "") {
        if (r.overridden) patch[r.key] = null;
        continue;
      }
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        showToast(`${r.label}: use a number from 0–100, or clear the field to reset`, "error");
        return;
      }
      patch[r.key] = n === r.actual ? null : n;
    }
    if (Object.keys(patch).length === 0) {
      showToast("No layer changes to apply", "error");
      return;
    }
    layerMutation.mutate(patch);
  }
  return (
    <>
      <div
        className={`grid gap-4 py-2 flex-1 min-h-0 max-h-[min(78vh,720px)] overflow-y-auto pr-1 relative ${(patch.isPending || referralMutation.isPending || scoresConfirmMutation.isPending || resumeScoresMutation.isPending || formulaPowerMutation.isPending || formulaFullResetMutation.isPending || layerMutation.isPending) ? "pointer-events-none opacity-60" : ""}`}
      >
        {(patch.isPending || referralMutation.isPending || scoresConfirmMutation.isPending || resumeScoresMutation.isPending || formulaPowerMutation.isPending || formulaFullResetMutation.isPending || layerMutation.isPending) && (
          <div className="sticky top-0 z-[1] flex justify-center py-1 -mt-1 mb-1">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm">
              <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
              {referralMutation.isPending &&
              !patch.isPending &&
              !scoresConfirmMutation.isPending &&
              !resumeScoresMutation.isPending &&
              !formulaPowerMutation.isPending &&
              !formulaFullResetMutation.isPending &&
              !layerMutation.isPending
                ? "Saving referral…"
                : layerMutation.isPending &&
                    !patch.isPending &&
                    !scoresConfirmMutation.isPending &&
                    !resumeScoresMutation.isPending &&
                    !referralMutation.isPending &&
                    !formulaPowerMutation.isPending &&
                    !formulaFullResetMutation.isPending
                  ? "Updating trust breakdown…"
                : formulaFullResetMutation.isPending ||
              (formulaPowerMutation.isPending &&
                !patch.isPending &&
                !scoresConfirmMutation.isPending &&
                !resumeScoresMutation.isPending &&
                !referralMutation.isPending &&
                !layerMutation.isPending)
                ? "Applying rank formula…"
                : resumeScoresMutation.isPending && !patch.isPending && !scoresConfirmMutation.isPending && !referralMutation.isPending
                  ? "Restoring formula AR…"
                  : scoresConfirmMutation.isPending && !patch.isPending && !referralMutation.isPending
                    ? "Confirming score overrides…"
                    : "Saving agent…"}
            </span>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="va-name">Name</Label>
          <Input id="va-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="va-desc">Description</Label>
          <Textarea
            id="va-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="resize-y min-h-[80px]"
          />
        </div>
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
          <p className="text-xs font-medium text-foreground/90">Profile image</p>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
              {image.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.trim()} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-[10px] text-muted-foreground px-1 text-center">No image</span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Input
                id="va-image"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://…"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={imageUploading}
                  asChild
                >
                  <label className="cursor-pointer">
                    <Upload className="size-3.5" aria-hidden />
                    {imageUploading ? "Uploading…" : "Upload to Blob"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        setImageUploading(true);
                        setImageUploadError(null);
                        try {
                          const fd = new FormData();
                          fd.append("file", file);
                          const res = await fetch("/api/upload/agent-image", { method: "POST", body: fd });
                          const data = (await res.json()) as { url?: string; error?: string };
                          if (data.url) {
                            setImage(data.url);
                            showToast("Profile image uploaded");
                          } else setImageUploadError(data.error ?? "Upload failed");
                        } catch {
                          setImageUploadError("Upload failed");
                        } finally {
                          setImageUploading(false);
                        }
                      }}
                    />
                  </label>
                </Button>
                {image.trim() && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setImage("")}>
                    Clear URL
                  </Button>
                )}
              </div>
              {imageUploadError && <p className="text-xs text-destructive">{imageUploadError}</p>}
            </div>
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
          <p className="text-xs font-medium text-foreground/90">Profile banner</p>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Wide header on the public agent page (metadata key <span className="font-mono">banner</span>). Leave URL
            empty and save to remove.
          </p>
          <div
            className="relative flex min-h-[72px] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-background"
          >
            {banner.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={banner.trim()} alt="" className="max-h-28 w-full object-cover" />
            ) : (
              <span className="text-xs text-muted-foreground">No banner</span>
            )}
          </div>
          <Input
            id="va-banner"
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
            placeholder="https://… (or upload)"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={bannerUploading}
              asChild
            >
              <label className="cursor-pointer">
                <Upload className="size-3.5" aria-hidden />
                {bannerUploading ? "Uploading…" : "Upload banner"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setBannerUploading(true);
                    setBannerUploadError(null);
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await fetch("/api/upload/agent-image", { method: "POST", body: fd });
                          const data = (await res.json()) as { url?: string; error?: string };
                          if (data.url) {
                            setBanner(data.url);
                            showToast("Banner uploaded");
                          } else setBannerUploadError(data.error ?? "Upload failed");
                    } catch {
                      setBannerUploadError("Upload failed");
                    } finally {
                      setBannerUploading(false);
                    }
                  }}
                />
              </label>
            </Button>
            {banner.trim() && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setBanner("")}>
                Clear banner
              </Button>
            )}
          </div>
          {bannerUploadError && <p className="text-xs text-destructive">{bannerUploadError}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="va-uri">Agent URI</Label>
          <Input id="va-uri" value={agentURI} onChange={(e) => setAgentURI(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="va-owner">Owner (0x…)</Label>
          <Input id="va-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="0x…" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="va-token">Token address</Label>
          <Input
            id="va-token"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
          />
        </div>
        <div className="rounded-md border border-border bg-muted/15 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground/90">Score and visibility</p>
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Edit here first
            </span>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/8 px-3 py-2 text-[11px] text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground/90 text-xs">Change scores in three steps</p>
            <ol className="list-decimal list-inside space-y-0.5 leading-relaxed">
              <li>Set <strong className="text-foreground">AR Score (composite)</strong>, on-chain execution, or layer weights below.</li>
              <li>Click <strong className="text-foreground">Confirm score overrides</strong> or <strong className="text-foreground">Apply layer overrides</strong>.</li>
              <li>Global <strong className="text-foreground"># rank</strong> updates automatically from the composite score.</li>
            </ol>
            <p className="text-[10px]">
              <strong className="text-foreground/85">Manual AR</strong> pins the public AgentRank score (30/30/25/15 composite).{" "}
              <strong className="text-foreground/85">Layer overrides</strong> adjust Profile, Protocol trust, Reputation, or Activity and recompute composite AR.{" "}
              <strong className="text-foreground/85">Resume computed AR</strong> clears pins and restores formula scores.
            </p>
            <p className="text-[10px]">
              <span className="font-medium text-foreground/85">Save</span> handles profile text, services, badges, and
              recomputes composites — it does <em>not</em> apply the dashed fields until you Confirm.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border-2 border-dashed border-primary/50 bg-background/50 p-3 space-y-2 sm:col-span-2 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Manual overrides</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="va-ar">① AR Score — composite (0–100)</Label>
                  <Input id="va-ar" value={agentRankDraft} onChange={(e) => setAgentRankDraft(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="va-execution">② Execution (0–100)</Label>
                  <Input id="va-execution" value={executionDraft} onChange={(e) => setExecutionDraft(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="va-pow">③ Listing power</Label>
                  <Input id="va-pow" value={powerDraft} onChange={(e) => setPowerDraft(e.target.value)} className="h-8 text-xs tabular-nums" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Formula preview (rank job, using admin adjust field below) ≈{" "}
                <span className="font-semibold tabular-nums text-foreground">{formulaPreviewPw}</span>. Public reputation badge
                badge often mirrors AR when boost tiers are inactive.
              </p>
              {manualAgentRankPinned && (
                <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[10px] text-muted-foreground">
                  <strong className="text-foreground/90">Manual AR pinned</strong> — Save will not revert confirmed AR
                  until you resume the formula.
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={
                    !scoresDirty ||
                    scoresConfirmMutation.isPending ||
                    resumeScoresMutation.isPending ||
                    formulaPowerMutation.isPending ||
                    formulaFullResetMutation.isPending ||
                    layerMutation.isPending
                  }
                  onClick={() => scoresConfirmMutation.mutate()}
                >
                  {scoresConfirmMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
                  ) : null}
                  Confirm score overrides
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={
                    !manualAgentRankPinned ||
                    scoresConfirmMutation.isPending ||
                    resumeScoresMutation.isPending ||
                    formulaPowerMutation.isPending ||
                    formulaFullResetMutation.isPending ||
                    layerMutation.isPending
                  }
                  onClick={() => resumeScoresMutation.mutate()}
                >
                  {resumeScoresMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
                  ) : null}
                  Resume computed AR
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={
                    scoresConfirmMutation.isPending ||
                    resumeScoresMutation.isPending ||
                    formulaPowerMutation.isPending ||
                    formulaFullResetMutation.isPending ||
                    layerMutation.isPending
                  }
                  onClick={() => formulaPowerMutation.mutate()}
                >
                  {formulaPowerMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
                  ) : null}
                  Reset listing power (formula)
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={
                    scoresConfirmMutation.isPending ||
                    resumeScoresMutation.isPending ||
                    formulaPowerMutation.isPending ||
                    formulaFullResetMutation.isPending ||
                    layerMutation.isPending
                  }
                  onClick={() => formulaFullResetMutation.mutate()}
                >
                  {formulaFullResetMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
                  ) : null}
                  Reset AR + listing power (formula)
                </Button>
              </div>
              {!scoresDirty && !manualAgentRankPinned && (
                <p className="text-[10px] text-muted-foreground pt-1">Change a number above to enable Confirm.</p>
              )}
            </div>
            {isSapListing && (
              <div className="rounded border border-cyan-500/25 bg-cyan-950/25 px-2 py-1.5 sm:col-span-2 text-muted-foreground">
                <strong className="text-foreground/90">SAP listing detected</strong>
                {": "}
                public SAP verification badges come from indexer fields — there is no separate numeric “SAP score” column yet.
                Use AR for directory completeness and on-chain execution where applicable on Solana.
              </div>
            )}
            <div className="rounded border border-border/80 bg-background/60 px-2 py-1.5 sm:col-span-2">
              <span className="text-muted-foreground">Formula AR Score (composite): </span>
              <span className="font-semibold tabular-nums">{extras.computedAgentRankScore}</span>
              <span className="text-muted-foreground"> / 100</span>
              <span className="text-muted-foreground ml-2">· Stored agentRankScore: </span>
              <span className="font-semibold tabular-nums">{agent.agentRankScore ?? 0}</span>
              <span className="text-muted-foreground ml-2">· Social signals: </span>
              <span className="font-mono text-[10px]">
                X{extras.socialPresence.twitter ? "✓" : "—"} web{extras.socialPresence.website ? "✓" : "—"} gh
                {extras.socialPresence.github ? "✓" : "—"} disc{extras.socialPresence.discord ? "✓" : "—"} tg
                {extras.socialPresence.telegram ? "✓" : "—"}
              </span>
            </div>
            <div className="rounded border border-border/80 bg-background/60 px-2 py-2 sm:col-span-2 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground/90">AR layer overrides</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {extras.scoringLayerBreakdown.formulaAgentRankScore}/100 composite
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Profile 30%, Protocol trust 30%, Reputation 25%, Activity 15%. Apply recomputes stored layer columns and
                composite AR, then refreshes global rank. Manual AR pin above clears when you apply layers.
              </p>
              <div className="space-y-2 max-h-[min(52vh,520px)] overflow-y-auto pr-0.5">
                {extras.scoringLayerBreakdown.rows.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_88px_auto] gap-2 items-center rounded-md border border-border/50 px-2 py-1.5 text-[11px]"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{row.label}</span>
                      <span className="text-muted-foreground font-normal"> ({row.weightLabel})</span>
                      <span className="text-muted-foreground ml-1.5 tabular-nums">
                        computed {row.actual}
                        {row.overridden ? (
                          <>
                            {" "}
                            → shown {row.display}
                          </>
                        ) : null}
                      </span>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      aria-label={`${row.label} override`}
                      className="h-8 text-xs tabular-nums"
                      value={dimDraft[row.key] ?? ""}
                      onChange={(e) => setDimDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0"
                      disabled={
                        !row.overridden ||
                        layerMutation.isPending ||
                        scoresConfirmMutation.isPending ||
                        resumeScoresMutation.isPending ||
                        formulaPowerMutation.isPending ||
                        formulaFullResetMutation.isPending
                      }
                      onClick={() => layerMutation.mutate({ [row.key]: null })}
                    >
                      Reset
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5"
                disabled={
                  layerMutation.isPending ||
                  scoresConfirmMutation.isPending ||
                  resumeScoresMutation.isPending ||
                  formulaPowerMutation.isPending ||
                  formulaFullResetMutation.isPending
                }
                onClick={() => applyLayerOverridesFromDraft()}
              >
                {layerMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin shrink-0" aria-hidden />
                ) : null}
                Apply layer overrides
              </Button>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-score">Stored score (0–100)</Label>
              <Input
                id="va-score"
                readOnly
                value={Number.isFinite(agent.score) ? String(agent.score) : ""}
                className="h-8 text-xs bg-muted/40"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-hot">Hot score (0–100)</Label>
              <Input
                id="va-hot"
                readOnly
                value={Number.isFinite(agent.hotScore) ? String(agent.hotScore) : ""}
                className="h-8 text-xs bg-muted/40"
              />
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="va-rank">Organic rank (#)</Label>
              <Input
                id="va-rank"
                readOnly
                value={rank}
                className="h-8 text-xs bg-muted/40 tabular-nums"
              />
              <p className="text-[10px] text-muted-foreground">
                Auto-updated from composite AR (<span className="font-mono">agentRankScore</span>) whenever you confirm
                scores or apply layer overrides. Listing power (below) is separate for the sponsored leaderboard.
              </p>
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="va-powadj">Admin power adjust</Label>
              <Input
                id="va-powadj"
                value={adminPowerAdjust}
                onChange={(e) => setAdminPowerAdjust(e.target.value)}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Added inside the power-score formula on rank jobs — durable way to nudge leaderboard position.
              </p>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-sm">scoreMetadata</Label>
              <Input id="va-sm" readOnly value={String(agent.scoreMetadata)} className="h-8 text-xs bg-muted/40" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-ss">scoreServices</Label>
              <Input id="va-ss" readOnly value={String(agent.scoreServices)} className="h-8 text-xs bg-muted/40" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-sq">scoreQuality</Label>
              <Input id="va-sq" readOnly value={String(agent.scoreQuality)} className="h-8 text-xs bg-muted/40" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-sp">scorePopularity</Label>
              <Input id="va-sp" readOnly value={String(agent.scorePopularity)} className="h-8 text-xs bg-muted/40" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-sf">scoreFreshness</Label>
              <Input id="va-sf" readOnly value={String(agent.scoreFreshness)} className="h-8 text-xs bg-muted/40" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-sw">scoreWallet</Label>
              <Input id="va-sw" readOnly value={String(agent.scoreWallet)} className="h-8 text-xs bg-muted/40" />
            </div>
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/15 p-3 space-y-3">
          <p className="text-xs font-medium text-foreground/90">Social links (metadata)</p>
          <p className="text-[10px] text-muted-foreground">
            Saved as metadata keys <span className="font-mono">twitter</span>, <span className="font-mono">website</span>, etc.
            Empty field removes that key. Chain sync preserves these when the registry omits them.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="va-tw">Twitter / X URL</Label>
              <Input id="va-tw" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/…" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-web">Website</Label>
              <Input id="va-web" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-gh">GitHub</Label>
              <Input id="va-gh" value={github} onChange={(e) => setGithub(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="va-disc">Discord</Label>
              <Input id="va-disc" value={discord} onChange={(e) => setDiscord(e.target.value)} />
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="va-tg">Telegram</Label>
              <Input id="va-tg" value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="@handle or https://t.me/…" />
            </div>
          </div>
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <Plug className="size-4 text-primary shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="text-xs font-medium text-foreground/90">MCP marketplace listings</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 max-w-md">
                  Curated offers on the public agent MCP tab. Opens in a second dialog so you can keep editing services
                  below.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 text-xs shrink-0 gap-1.5"
              onClick={() => setMcpDialogOpen(true)}
            >
              <Plug className="size-3.5" aria-hidden />
              MCP listings…
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <Gift className="size-4 text-amber-400 shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="text-xs font-medium text-foreground/90">Public referral</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 max-w-md">
                  Short link, destination, and promo on the public agent profile. Opens in a dialog like MCP listings;
                  you can also apply changes with the main Save button at the bottom.
                </p>
                {refCode.trim() ? (
                  <p className="text-[10px] font-mono text-amber-400/90 mt-1 break-all">
                    {publicReferralShareAbsoluteUrl(refCode.trim().toLowerCase())}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground mt-1">No short code — destination-only is ok.</p>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 text-xs shrink-0 gap-1.5"
              onClick={() => setReferralDialogOpen(true)}
            >
              <Gift className="size-3.5" aria-hidden />
              Referral…
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/15 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground/90">Endpoints (services)</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                setSvcRows((rows) => [
                  ...rows,
                  {
                    key: globalThis.crypto.randomUUID(),
                    name: "MCP",
                    endpoint: "",
                    version: "",
                  },
                ])
              }
            >
              Add row
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Name + endpoint required per row. Chain sync keeps rows whose names are not present on-chain.
          </p>
          <div className="space-y-2">
            {svcRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rows — add one or save to clear all services.</p>
            ) : (
              svcRows.map((row, idx) => (
                <div key={row.key} className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end border border-border/60 rounded-md p-2">
                  <div className="sm:col-span-3 grid gap-1">
                    <Label className="text-[10px]">Name (e.g. MCP, A2A, WEB)</Label>
                    <Input
                      className="h-8 text-xs font-mono uppercase"
                      value={row.name}
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase().slice(0, 32);
                        setSvcRows((rows) => rows.map((r, i) => (i === idx ? { ...r, name: v } : r)));
                      }}
                      placeholder="MCP"
                    />
                  </div>
                  <div className="sm:col-span-7 grid gap-1">
                    <Label className="text-[10px]">Endpoint URL</Label>
                    <Input
                      className="h-8 text-xs font-mono"
                      value={row.endpoint}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSvcRows((rows) => rows.map((r, i) => (i === idx ? { ...r, endpoint: v } : r)));
                      }}
                      placeholder="https://…"
                    />
                  </div>
                  <div className="sm:col-span-2 flex gap-1">
                    <div className="grid gap-1 flex-1 min-w-0">
                      <Label className="text-[10px]">Ver.</Label>
                      <Input
                        className="h-8 text-xs"
                        value={row.version}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSvcRows((rows) => rows.map((r, i) => (i === idx ? { ...r, version: v } : r)));
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 text-destructive"
                      onClick={() => setSvcRows((rows) => rows.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          On-chain id {agent.agentId} · chain {agent.chain.shortName} ({agent.chainId}) — not editable here.
        </p>
        <div className="flex flex-col gap-3 border border-border rounded-md p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="va-ver"
              checked={isVerified}
              onCheckedChange={(c: boolean) => setIsVerified(c === true)}
            />
            <Label htmlFor="va-ver" className="font-normal cursor-pointer">
              Verified
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="va-prem"
              checked={isPremiumVerified}
              onCheckedChange={(c: boolean) => setIsPremiumVerified(c === true)}
            />
            <Label htmlFor="va-prem" className="font-normal cursor-pointer">
              Premium verified
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="va-active"
              checked={isActive}
              onCheckedChange={(c: boolean) => setIsActive(c === true)}
            />
            <Label htmlFor="va-active" className="font-normal cursor-pointer">
              Active
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="va-custom"
              checked={isCustomListed}
              onCheckedChange={(c: boolean) => setIsCustomListed(c === true)}
            />
            <Label htmlFor="va-custom" className="font-normal cursor-pointer">
              Custom listed
            </Label>
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs font-medium text-foreground">Work-Ready (Jobs)</p>
            <p className="text-[11px] text-muted-foreground">
              Approved or featured agents appear on <code>/jobs</code> and job matching.
            </p>
            <div className="flex items-center gap-2">
              <Label htmlFor="va-work-ready-status" className="text-xs text-muted-foreground shrink-0">
                Status
              </Label>
              <select
                id="va-work-ready-status"
                value={workReadyStatus}
                onChange={(e) => setWorkReadyStatus(e.target.value)}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="none">None</option>
                <option value="pending">Pending (internal)</option>
                <option value="approved">Approved (public)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="va-featured-work-ready"
                checked={featuredWorkReady}
                onCheckedChange={(c: boolean) => setFeaturedWorkReady(c === true)}
              />
              <Label htmlFor="va-featured-work-ready" className="font-normal cursor-pointer text-xs">
                Featured Work Ready on /jobs
              </Label>
            </div>
          </div>
        </div>
        {agent.isPremiumVerified && (
          <p className="text-[11px] text-muted-foreground rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1.5">
            <strong className="text-foreground/90">Premium verified:</strong> “Sync from chain” does not overwrite
            description, image, or stored metadata from the registry (KYA). Edit those fields here; use import/sync for
            on-chain agents that are not premium-locked.
          </p>
        )}
        {agent.metadata.length > 0 && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground/80">Metadata (read-only)</p>
            <ul className="max-h-24 overflow-y-auto font-mono space-y-0.5">
              {agent.metadata.map((m) => (
                <li key={m.id}>
                  {m.key}: {m.value.slice(0, 120)}
                  {m.value.length > 120 ? "…" : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
        <Button
          type="button"
          variant="outline"
          className="sm:mr-auto gap-2"
          disabled={agent.agentId < 0 || syncFromRegistry.isPending}
          title={
            agent.agentId < 0
              ? "Custom listings cannot sync from chain"
              : "Refresh name, owner, and registration from the identity registry"
          }
          onClick={() => syncFromRegistry.mutate()}
        >
          {syncFromRegistry.isPending ? (
            <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
          ) : (
            <RefreshCw className="size-4 shrink-0" aria-hidden />
          )}
          Sync from chain
        </Button>
        <div className="flex gap-2 w-full sm:w-auto justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => patch.mutate()} disabled={patch.isPending}>
            {patch.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </DialogFooter>
      {syncFromRegistry.isError && (
        <p className="text-sm text-destructive pt-2">{(syncFromRegistry.error as Error).message}</p>
      )}
      {patch.isError && (
        <p className="text-sm text-destructive pt-2">{(patch.error as Error).message}</p>
      )}
      <Dialog modal={false} open={referralDialogOpen} onOpenChange={setReferralDialogOpen}>
        <DialogContent
          className="z-[60] max-w-md w-[calc(100vw-1.5rem)] max-h-[min(88vh,620px)] overflow-y-auto"
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="size-4 text-amber-400" aria-hidden />
              Referral link
            </DialogTitle>
            <DialogDescription className="sr-only">
              Edit public referral destination and promo text for this agent listing.
            </DialogDescription>
            <p className="text-xs text-muted-foreground font-normal">
              {agent.name} · {agent.chain.shortName} · #{agent.agentId}
            </p>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1">
              <Label htmlFor="adm-ref-code">Short link slug</Label>
              <Input
                id="adm-ref-code"
                className="text-xs h-9 font-mono lowercase"
                value={refCode}
                onChange={(e) => setRefCode(e.target.value.toLowerCase().slice(0, PUBLIC_REFERRAL_CODE_FIELD_MAX))}
                maxLength={PUBLIC_REFERRAL_CODE_FIELD_MAX}
                placeholder="Slug or paste full https://… referral URL"
              />
              <p className="text-[10px] text-muted-foreground leading-snug">
                This becomes <span className="font-mono">/ag-ref/&lt;slug&gt;</span> on AgentRanking. You can paste a full
                Synapse URL here — we take the last path segment as the slug and set destination automatically. Put a
                different outbound link in <span className="font-medium">Destination</span> when needed.
              </p>
              {refCode.trim() ? (
                <p className="text-[10px] font-mono text-amber-400/90 break-all">
                  {publicReferralShareAbsoluteUrl(refCode.trim().toLowerCase())}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="adm-ref-dest">Destination</Label>
              <Input
                id="adm-ref-dest"
                className="text-xs h-9"
                value={refDest}
                onChange={(e) => setRefDest(e.target.value.slice(0, PUBLIC_REFERRAL_DEST_MAX))}
                maxLength={PUBLIC_REFERRAL_DEST_MAX}
                placeholder="Leave empty for profile, or any path / URL / free text (max 500 chars)"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="adm-ref-info">Promo text</Label>
              <Input
                id="adm-ref-info"
                className="text-xs h-9"
                value={refInfo}
                onChange={(e) => setRefInfo(e.target.value.slice(0, PUBLIC_REFERRAL_INFO_MAX))}
                maxLength={PUBLIC_REFERRAL_INFO_MAX}
                placeholder='e.g. "40% Bonus on $SAP!"'
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setReferralDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => referralMutation.mutate()} disabled={referralMutation.isPending}>
              {referralMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save referral"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog modal={false} open={mcpDialogOpen} onOpenChange={setMcpDialogOpen}>
        <DialogContent
          className="z-[60] max-w-2xl w-[calc(100vw-1.5rem)] max-h-[min(88vh,820px)] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
          showCloseButton
        >
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0 border-b border-border">
            <DialogTitle>MCP listings</DialogTitle>
            <DialogDescription className="sr-only">
              Manage MCP marketplace offers for this agent.
            </DialogDescription>
            <p className="text-xs text-muted-foreground font-normal leading-snug">
              {agent.name} · {agent.chain.shortName} · on-chain #{agent.agentId}
            </p>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <DashboardMcpOffersEditor
              apiKind="admin"
              agentDbId={agent.id}
              profilePath={agent.profilePath}
              services={agent.services.map((s) => ({
                id: s.id,
                name: s.name,
                endpoint: s.endpoint,
              }))}
              onOffersMutated={() => {
                void qc.invalidateQueries({ queryKey: ["admin-verified-agent", agent.id] });
                void qc.invalidateQueries({ queryKey: ["admin-verified-agents"] });
                void qc.invalidateQueries({ queryKey: ["agent-mcp-offers"] });
                void qc.invalidateQueries({
                  queryKey: ["agent", String(agent.chainId), String(agent.agentId)],
                });
                showToast("MCP listings updated. Public profile cache refreshed.");
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
