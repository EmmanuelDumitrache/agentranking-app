"use client";
import { useCallback, useMemo, useState } from "react";
import { History, ImagePlus, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { showToast } from "@/components/ui/toast-simple";
import { DashboardMarkdownTextarea } from "@/components/dashboard/shared/markdown-textarea";
import { DashboardSocialLinksFields } from "@/components/dashboard/agents/social-links-fields";
import { useSourceDraft } from "@/hooks/use-source-draft";
import {
  detectedOfficialLinkTypes,
  officialLinksRecordFromResolved,
  seedOfficialLinksForEditor,
  type OfficialLinkMetadataRow,
  type OfficialLinkServiceRow,
  type OfficialLinkType,
  type ResolvedOfficialLink,
} from "@/lib/dashboard/official-links";
import {
  DASHBOARD_PROFILE_SOCIAL_DEFINITIONS,
  putDashboardOfficialLinks,
} from "@/lib/dashboard/social-links-save";
import type { VersionManifest } from "@/lib/agent-version-manifest";
const ARCHETYPES = [
  { value: "", label: "— None —" },
  { value: "trading", label: "Trading" },
  { value: "arbitrage", label: "Arbitrage" },
  { value: "sniper", label: "Sniper" },
  { value: "yield", label: "Yield" },
  { value: "builder", label: "Builder" },
  { value: "analytics", label: "Analytics" },
  { value: "bridge", label: "Bridge" },
  { value: "copy_trader", label: "Copy Trader" },
  { value: "social", label: "Social" },
  { value: "mev", label: "MEV" },
];
type Props = Readonly<{
  agentDbId: number;
  name: string;
  image: string;
  description: string;
  archetype: string;
  tokenAddress: string;
  initialMetadata?: OfficialLinkMetadataRow[];
  initialServices?: OfficialLinkServiceRow[];
  initialResolvedLinks?: ResolvedOfficialLink[];
  initialSavedLinkTypes?: string[];
  initialVersionManifest: VersionManifest;
  onSaved: () => void;
}>;
async function cropFileToSquare(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image cropping is not supported in this browser");
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, 512, 512);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, file.type === "image/png" ? "image/png" : "image/webp", 0.9),
  );
  if (!blob) throw new Error("Could not crop image");
  const extension = file.type === "image/png" ? "png" : "webp";
  return new File([blob], file.name.replace(/\.[^.]+$/, `.${extension}`), {
    type: blob.type,
  });
}
async function uploadAgentImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload/agent-image", {
    method: "POST",
    body: formData,
  });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? "Image upload failed");
  return data.url;
}
export function DashboardAgentEditPanel({
  agentDbId,
  name,
  image: initialImage,
  description: initialDescription,
  archetype: initialArchetype,
  tokenAddress: initialToken,
  initialMetadata = [],
  initialServices = [],
  initialResolvedLinks = [],
  initialSavedLinkTypes = [],
  initialVersionManifest,
  onSaved,
}: Props) {
  const [displayName, setDisplayName] = useSourceDraft(name, name);
  const [image, setImage] = useSourceDraft(initialImage, initialImage);
  const [description, setDescription] = useSourceDraft(initialDescription, initialDescription);
  const [archetype, setArchetype] = useSourceDraft(initialArchetype, initialArchetype);
  const [tokenAddress, setTokenAddress] = useSourceDraft(initialToken, initialToken);
  const seededLinks = useMemo(
    () =>
      initialResolvedLinks.length > 0
        ? officialLinksRecordFromResolved(initialResolvedLinks)
        : seedOfficialLinksForEditor(initialMetadata, initialServices),
    [initialMetadata, initialResolvedLinks, initialServices],
  );
  const seededDetectedTypes = useMemo<ReadonlySet<OfficialLinkType>>(
    () =>
      detectedOfficialLinkTypes(
        initialMetadata,
        initialServices,
        initialSavedLinkTypes.map((linkType) => ({ linkType, url: "" })),
      ),
    [initialMetadata, initialSavedLinkTypes, initialServices],
  );
  const [links, setLinks] = useSourceDraft<Record<OfficialLinkType, string>>(agentDbId, seededLinks);
  const [detectedTypes, setDetectedTypes] = useSourceDraft<ReadonlySet<OfficialLinkType>>(
    agentDbId,
    seededDetectedTypes,
  );
  const [linksLoaded, setLinksLoaded] = useSourceDraft(agentDbId, true);
  const [versionManifest, setVersionManifest] = useSourceDraft(
    `${agentDbId}:${initialVersionManifest.current.entryId}`,
    initialVersionManifest,
  );
  const [versionLabel, setVersionLabel] = useSourceDraft(
    `${agentDbId}:${initialVersionManifest.current.entryId}:label`,
    initialVersionManifest.current.label,
  );
  const [releaseNotes, setReleaseNotes] = useSourceDraft(
    `${agentDbId}:${initialVersionManifest.current.entryId}:notes`,
    initialVersionManifest.current.releaseNotes,
  );
  const [trafficNote, setTrafficNote] = useSourceDraft(
    `${agentDbId}:${initialVersionManifest.current.entryId}:traffic`,
    initialVersionManifest.current.trafficNote,
  );
  const [savingVersion, setSavingVersion] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const loadLinks = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/links`);
      const data = (await res.json()) as {
        links?: Array<{ linkType: string; url: string; lockedByVerifiedOwner?: boolean }>;
        savedLinkTypes?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load links");
      const savedRows = data.links ?? [];
      const savedTypeSet = new Set(data.savedLinkTypes ?? []);
      const next = officialLinksRecordFromResolved(
        savedRows.map((row) => ({
          linkType: row.linkType as OfficialLinkType,
          url: row.url ?? "",
          lockedByVerifiedOwner: row.lockedByVerifiedOwner ?? false,
        })),
      );
      setLinks(next);
      setDetectedTypes(
        detectedOfficialLinkTypes(
          initialMetadata,
          initialServices,
          Array.from(savedTypeSet).map((linkType) => ({ linkType, url: "" })),
        ),
      );
    } catch (e) {
      setLinks(seedOfficialLinksForEditor(initialMetadata, initialServices));
      setDetectedTypes(
        detectedOfficialLinkTypes(initialMetadata, initialServices, []),
      );
      showToast(e instanceof Error ? e.message : "Could not load social links", "error");
    } finally {
      setLinksLoaded(true);
    }
  }, [agentDbId, initialMetadata, initialServices, setDetectedTypes, setLinks, setLinksLoaded]);
  function setLink(linkType: OfficialLinkType, url: string) {
    setLinks((prev) => ({ ...prev, [linkType]: url }));
    setDetectedTypes((prev) => {
      if (!prev.has(linkType)) return prev;
      const next = new Set(prev);
      next.delete(linkType);
      return next;
    });
  }
  function clearLink(linkType: OfficialLinkType) {
    setLink(linkType, "");
  }
  async function handleImageChange(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setSaved(false);
    try {
      const cropped = await cropFileToSquare(file);
      const url = await uploadAgentImage(cropped);
      setImage(url);
      showToast("Image ready. Publish your profile to make it live.", "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Image upload failed";
      setError(message);
      showToast(message, "error");
    } finally {
      setUploading(false);
    }
  }
  async function saveVersion() {
    setSavingVersion(true);
    try {
      const response = await fetch(`/api/dashboard/agents/${agentDbId}/versioning`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: versionLabel,
          releaseNotes,
          trafficNote,
        }),
      });
      const payload = (await response.json()) as {
        manifest?: VersionManifest;
        error?: string;
      };
      if (!response.ok || !payload.manifest) {
        throw new Error(payload.error ?? "Could not save version");
      }
      setVersionManifest(payload.manifest);
      setVersionLabel(payload.manifest.current.label);
      setReleaseNotes(payload.manifest.current.releaseNotes);
      setTrafficNote(payload.manifest.current.trafficNote);
      showToast(`Version ${payload.manifest.current.label} published.`, "success");
      onSaved();
    } catch (versionError) {
      showToast(
        versionError instanceof Error ? versionError.message : "Could not save version",
        "error",
      );
    } finally {
      setSavingVersion(false);
    }
  }
  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const [profileRes] = await Promise.all([
        fetch(`/api/dashboard/agents/${agentDbId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: displayName,
            image,
            description,
            archetype,
            tokenAddress,
          }),
        }),
        putDashboardOfficialLinks(agentDbId, links, DASHBOARD_PROFILE_SOCIAL_DEFINITIONS),
      ]);
      const data = (await profileRes.json()) as { error?: string };
      if (!profileRes.ok) throw new Error(data.error ?? "Save failed");
      setSaved(true);
      setDetectedTypes(new Set());
      showToast("Agent profile published successfully.", "success");
      onSaved();
      void loadLinks();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed";
      setError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="ui-agent-profile-editor ui-overview-panel overflow-hidden rounded-xl">
      <div className="ui-overview-panel-header flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-base font-semibold text-foreground">Public profile</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Update the identity and information people see on AgentRanking.
          </p>
        </div>
        <Button
          size="sm"
          className="ui-agent-profile-primary-action"
          disabled={saving || uploading}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Publish profile
        </Button>
      </div>
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[220px_1fr]">
        <div className="ui-agent-profile-avatar-card rounded-xl p-4">
          <AgentAvatar image={image} name={displayName} size="lg" className="mx-auto h-20 w-20 rounded-2xl" />
          <p className="mt-3 text-center text-xs font-medium text-foreground">
            Profile image
          </p>
          <label className="ui-agent-profile-upload mt-3 inline-flex w-full cursor-pointer items-center justify-center rounded-lg px-3 py-2 text-xs font-medium transition-colors">
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5 mr-1.5" />
            )}
            {uploading ? "Uploading..." : "Upload image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => void handleImageChange(event.target.files?.[0])}
            />
          </label>
          <p className="mt-2 text-center text-[10px] leading-relaxed text-muted-foreground">
            PNG, JPEG, WebP, or GIF. Images are cropped to a square.
          </p>
        </div>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-muted-foreground">
              <span>Display name</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={120}
                placeholder="Agent name"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              <span>Archetype</span>
              <select
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={archetype}
                onChange={(event) => setArchetype(event.target.value)}
              >
                {ARCHETYPES.map((item) => (
                  <option key={item.value || "none"} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="block text-xs font-medium text-muted-foreground">
            <span>Description</span>
            <div className="mt-1">
              <DashboardMarkdownTextarea
                value={description}
                onChange={setDescription}
                maxLength={2000}
                placeholder="Describe what this agent does, who it is for, and any trust or usage notes."
              />
            </div>
          </div>
          <label className="block text-xs font-medium text-muted-foreground">
            <span>Token or contract address</span>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground"
              value={tokenAddress}
              onChange={(event) => setTokenAddress(event.target.value)}
              placeholder="0x... or Solana mint"
            />
          </label>
          <section className="ui-agent-profile-section space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Links</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Add the official destinations shown on the public profile. Detected
                links are pre-filled for review.
              </p>
            </div>
            {!linksLoaded ? (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Loading social links…
              </p>
            ) : (
              <DashboardSocialLinksFields
                definitions={DASHBOARD_PROFILE_SOCIAL_DEFINITIONS}
                links={links}
                disabled={saving || uploading}
                detectedTypes={detectedTypes}
                onChange={setLink}
                onClear={clearLink}
              />
            )}
          </section>
          <section className="ui-agent-profile-section space-y-3">
            <div className="flex items-start gap-2">
              <History className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-foreground">Versions</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Record releases and rollout notes while preserving previous versions.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-muted-foreground">
                <span>Current version</span>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={versionLabel}
                  maxLength={64}
                  onChange={(event) => setVersionLabel(event.target.value)}
                  placeholder="v1.0.0"
                />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                <span>Traffic note</span>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={trafficNote}
                  maxLength={500}
                  onChange={(event) => setTrafficNote(event.target.value)}
                  placeholder="Rollout or migration note"
                />
              </label>
            </div>
            <label className="block text-xs font-medium text-muted-foreground">
              <span>Release notes</span>
              <textarea
                className="mt-1 min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={releaseNotes}
                maxLength={2000}
                onChange={(event) => setReleaseNotes(event.target.value)}
                placeholder="What changed in this version?"
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                {versionManifest.history.length} archived version{versionManifest.history.length === 1 ? "" : "s"}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ui-agent-profile-secondary-action"
                disabled={savingVersion || !versionLabel.trim()}
                onClick={() => void saveVersion()}
              >
                {savingVersion ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Publish version
              </Button>
            </div>
            {versionManifest.history.length > 0 ? (
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/10 p-3">
                {versionManifest.history.map((entry) => (
                  <div key={entry.entryId} className="border-b border-border/40 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">{entry.label}</span>
                      <time className="text-[10px] text-muted-foreground" dateTime={entry.updatedAt}>
                        {new Date(entry.updatedAt).toLocaleDateString()}
                      </time>
                    </div>
                    {entry.releaseNotes ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{entry.releaseNotes}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          <div className="ui-agent-profile-footer flex flex-wrap items-center justify-between gap-3 pt-4">
            <div>
              {error ? <p className="text-xs text-red-400">{error}</p> : null}
              {saved ? <p className="text-xs text-emerald-400">Profile saved.</p> : null}
              {!error && !saved ? (
                <p className="text-xs text-muted-foreground">
                  Review your changes, then publish when ready.
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              className="ui-agent-profile-primary-action"
              disabled={saving || uploading}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Publish profile
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
