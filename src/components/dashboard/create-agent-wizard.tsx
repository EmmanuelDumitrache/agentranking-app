"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Coins,
  ImagePlus,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/toast-simple";
import { writeStoredAgentId } from "@/lib/dashboard/active-agent";
import { cn } from "@/lib/utils";
import type { DashboardAgentCreationConfigDto } from "@/lib/dashboard/account-creation.server";

const STEPS = [
  { id: "profile", title: "Agent profile", hint: "Name your agent and describe what it does." },
  { id: "branding", title: "Avatar & branding", hint: "Upload an image or generate a themed robot avatar with AI." },
  { id: "links", title: "Links & proof", hint: "Optional social links and proof of ownership." },
  { id: "token", title: "Deployment choice", hint: "Create the agent only or jump to token launch." },
  { id: "review", title: "Review & create", hint: "Confirm everything before your agent goes live." },
] as const;

type WizardStepId = (typeof STEPS)[number]["id"];

type WizardState = {
  name: string;
  description: string;
  persona: string;
  tags: string;
  image: string;
  website: string;
  twitter: string;
  telegram: string;
  github: string;
};

const INITIAL: WizardState = {
  name: "",
  description: "",
  persona: "",
  tags: "",
  image: "",
  website: "",
  twitter: "",
  telegram: "",
  github: "",
};

type DeploymentChoice = "agent" | "token";

function parseApiError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return fallback;
}

function FieldHint({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-[#aaa]">{children}</p>;
}

function CharCount({
  current,
  max,
}: {
  readonly current: number;
  readonly max: number;
}) {
  return (
    <span className="text-[11px] tabular-nums text-[#8f8f8f]">
      {current}/{max}
    </span>
  );
}

function ReviewRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#303030] py-2.5 last:border-b-0">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-[#8f8f8f]">
        {label}
      </dt>
      <dd className="min-w-0 text-right text-sm text-[#f1f1f1]">{value}</dd>
    </div>
  );
}

type Props = {
  readonly creationConfig: DashboardAgentCreationConfigDto;
  readonly onComplete?: () => void;
};

export function DashboardCreateAgentWizard({ creationConfig, onComplete }: Props) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<WizardState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generatingAvatar, setGeneratingAvatar] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [deploymentChoice, setDeploymentChoice] = useState<DeploymentChoice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const step = STEPS[stepIndex]!;
  const progress = ((stepIndex + 1) / STEPS.length) * 100;
  const tagList = useMemo(
    () =>
      form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    [form.tags],
  );

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function canAdvance(): boolean {
    if (step.id === "profile") {
      const name = form.name.trim();
      return name.length >= 2 && name.length <= 80;
    }
    if (step.id === "token") {
      return deploymentChoice !== null;
    }
    return true;
  }

  const avatarBusy = uploading || generatingAvatar;

  const onPickAvatar = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Upload a PNG, JPEG, WebP, or GIF image.", "error");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/agent-image", { method: "POST", body: fd });
      const payload = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !payload.url) {
        throw new Error(payload.error ?? "Upload failed");
      }
      update("image", payload.url);
      showToast("Avatar updated.", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not upload image";
      setError(message);
      showToast(message, "error");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleGenerateAvatar = useCallback(async () => {
    if (generatingAvatar) return;
    const agentName = form.name.trim();
    if (!agentName) {
      showToast("Enter an agent name on the profile step first.", "error");
      return;
    }
    setGeneratingAvatar(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/agents/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName,
          persona: form.persona.trim() || form.description.trim(),
        }),
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !payload.url) {
        throw new Error(payload.error ?? "Could not generate avatar");
      }
      update("image", payload.url);
      showToast("AI avatar ready.", "success");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not generate avatar. Try again or upload your own.";
      setError(message);
      showToast(message, "error");
    } finally {
      setGeneratingAvatar(false);
    }
  }, [form.description, form.name, form.persona, generatingAvatar]);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      if (avatarBusy) return;
      const file = event.dataTransfer.files?.[0];
      if (file) void onPickAvatar(file);
    },
    [avatarBusy, onPickAvatar],
  );

  async function onCreate() {
    if (!creationConfig.canCreate) {
      setError(`Agent limit reached (${creationConfig.maxAgents}).`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          persona: form.persona.trim(),
          image: form.image.trim(),
          website: form.website.trim(),
          twitter: form.twitter.trim(),
          telegram: form.telegram.trim(),
          github: form.github.trim(),
          tags: tagList,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = parseApiError(payload, "Could not create agent");
        setError(message);
        showToast(message, "error");
        return;
      }
      const agentId = (payload as { agent?: { id?: number } })?.agent?.id;
      if (!agentId) {
        const message =
          "Agent was created but the response was incomplete. Refresh and check your agents list.";
        setError(message);
        showToast(message, "error");
        return;
      }
      writeStoredAgentId(agentId);
      showToast(`${form.name.trim()} created successfully.`, "success");
      onComplete?.();
      if (deploymentChoice === "token") {
        const params = new URLSearchParams();
        if (form.name) params.set("prefillName", form.name.slice(0, 32));
        if (form.tags) {
          const sym = form.tags.split(",")[0]?.trim().slice(0, 10).toUpperCase() || "";
          if (sym) params.set("prefillSymbol", sym);
        }
        if (form.description) params.set("prefillDescription", form.description.slice(0, 200));
        if (form.image) params.set("prefillImage", form.image);
        const qs = params.toString();
        router.push(`/dashboard/agents/${agentId}/launchpad${qs ? `?${qs}` : ""}`);
      } else {
        router.push(`/dashboard/agents/${agentId}`);
      }
      router.refresh();
    } catch (err) {
      console.error("[create-agent]", err);
      const message = "Network error — check your connection and try again.";
      setError(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  }

  function onNext() {
    if (!canAdvance()) {
      if (step.id === "profile") {
        showToast("Enter an agent name (2–80 characters).", "error");
      } else if (step.id === "token") {
        showToast("Choose how you want to deploy your agent.", "error");
      }
      return;
    }
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((index) => index + 1);
      return;
    }
    void onCreate();
  }

  function onBack() {
    if (stepIndex > 0) setStepIndex((index) => index - 1);
  }

  function renderStepContent(stepId: WizardStepId) {
    switch (stepId) {
      case "profile":
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="name">Agent name *</Label>
                <CharCount current={form.name.length} max={80} />
              </div>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                maxLength={80}
                placeholder="Nova AI"
                autoFocus
              />
              <FieldHint>Pick a memorable name — this appears in the sidebar and public profile.</FieldHint>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="description">Short description</Label>
                <CharCount current={form.description.length} max={2000} />
              </div>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="What does this agent do?"
              />
              <FieldHint>One or two sentences for listings, search, and your overview page.</FieldHint>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="persona">Persona / goals</Label>
                <CharCount current={form.persona.length} max={1000} />
              </div>
              <Textarea
                id="persona"
                value={form.persona}
                onChange={(e) => update("persona", e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Tone, audience, and what success looks like for this agent."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Category / tags</Label>
              <Input
                id="tags"
                value={form.tags}
                onChange={(e) => update("tags", e.target.value)}
                placeholder="trading, research, mcp"
              />
              <FieldHint>Comma-separated. The first tag can become your token symbol later.</FieldHint>
            </div>
          </div>
        );
      case "branding":
        return (
          <div className="space-y-5">
            <div
              className={cn(
                "ui-create-agent-dropzone relative flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
                dragActive && "border-[#717171] bg-[#212121]",
                avatarBusy && "pointer-events-none opacity-70",
                !dragActive && "border-[#303030] bg-[#0f0f0f]",
              )}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!avatarBusy) setDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!avatarBusy) setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDragActive(false);
              }}
              onDrop={handleDrop}
            >
              <AgentAvatar
                image={form.image}
                name={form.name || "Agent"}
                size="lg"
                className="!size-20 rounded-2xl"
              />
              {generatingAvatar ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#0f0f0f]/80">
                  <Loader2 className="size-8 animate-spin text-[#f1f1f1]" aria-hidden />
                  <span className="text-xs font-medium text-[#aaa]">Generating avatar…</span>
                </div>
              ) : null}
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {uploading ? "Uploading…" : "Drag and drop an image"}
                </p>
                <p className="text-xs text-[#aaa]">PNG, JPEG, WebP, or GIF</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={avatarBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  ) : (
                    <ImagePlus className="mr-2 size-4" aria-hidden />
                  )}
                  Choose file
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={avatarBusy}
                  onClick={() => void handleGenerateAvatar()}
                >
                  {generatingAvatar ? (
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="mr-2 size-4" aria-hidden />
                  )}
                  {form.image ? "Generate new" : "Generate with AI"}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                disabled={avatarBusy}
                onChange={(e) => void onPickAvatar(e.target.files?.[0] ?? null)}
              />
            </div>
            <FieldHint>
              AI makes a themed robot-style AgentRanking avatar from your agent name and persona.
              You can continue without an avatar and add one later from the profile page.
            </FieldHint>
          </div>
        );
      case "links":
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={form.website}
                onChange={(e) => update("website", e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="twitter">X / Twitter</Label>
                <Input
                  id="twitter"
                  value={form.twitter}
                  onChange={(e) => update("twitter", e.target.value)}
                  placeholder="@handle"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telegram">Telegram</Label>
                <Input
                  id="telegram"
                  value={form.telegram}
                  onChange={(e) => update("telegram", e.target.value)}
                  placeholder="@handle"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="github">GitHub</Label>
              <Input
                id="github"
                value={form.github}
                onChange={(e) => update("github", e.target.value)}
                placeholder="org/repo or username"
              />
            </div>
            <div className="flex gap-3 rounded-xl border border-[#303030] bg-[#0f0f0f] p-4">
              <Wallet className="mt-0.5 size-4 shrink-0 text-[#aaa]" aria-hidden />
              <p className="text-xs leading-relaxed text-[#aaa]">
                A dedicated Solana agent wallet is generated automatically when you create the
                agent. You will see the public address on Overview and Wallet — private keys stay
                encrypted server-side.
              </p>
            </div>
          </div>
        );
      case "token":
        return (
          <div
            className="grid gap-3 sm:grid-cols-2"
            role="radiogroup"
            aria-label="Deployment choice"
          >
            <button
              type="button"
              role="radio"
              aria-checked={deploymentChoice === "agent"}
              className={cn(
                "ui-create-agent-choice relative cursor-pointer rounded-xl border p-4 text-left transition-all",
                deploymentChoice === "agent"
                  ? "border-[#f1f1f1] bg-[#212121] ring-1 ring-[#f1f1f1]"
                  : "border-[#303030] bg-[#181818] hover:border-[#717171] hover:bg-[#212121]",
              )}
              onClick={() => setDeploymentChoice("agent")}
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#303030] text-[#f1f1f1]">
                  <Bot className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">Create agent only</p>
                    {deploymentChoice === "agent" ? (
                      <Check className="ml-auto size-4 shrink-0 text-[#f1f1f1]" aria-hidden />
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-[#aaa]">
                    Land on Overview after creation. Register on chain and launch a token whenever
                    you are ready.
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={deploymentChoice === "token"}
              className={cn(
                "ui-create-agent-choice relative cursor-pointer rounded-xl border p-4 text-left transition-all",
                deploymentChoice === "token"
                  ? "border-[#f1f1f1] bg-[#212121] ring-1 ring-[#f1f1f1]"
                  : "border-[#303030] bg-[#181818] hover:border-[#717171] hover:bg-[#212121]",
              )}
              onClick={() => setDeploymentChoice("token")}
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#303030] text-[#f1f1f1]">
                  <Coins className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">Agent + prepare token</p>
                    {deploymentChoice === "token" ? (
                      <Check className="ml-auto size-4 shrink-0 text-[#f1f1f1]" aria-hidden />
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-[#aaa]">
                    Go straight to the launchpad with your name, description, and image prefilled.
                  </p>
                </div>
              </div>
            </button>
          </div>
        );
      case "review":
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-4 rounded-xl border border-[#303030] bg-[#0f0f0f] p-4">
              <AgentAvatar
                image={form.image}
                name={form.name}
                size="lg"
                className="!size-16 rounded-2xl"
              />
              <div className="min-w-0 space-y-1">
                <p className="text-lg font-semibold">{form.name || "Untitled agent"}</p>
                <p className="text-sm text-[#aaa]">
                  {form.description || "No description yet."}
                </p>
                {tagList.length > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {tagList.map((tag) => (
                      <Badge key={tag} variant="secondary" className="font-normal">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <dl className="rounded-xl border border-[#303030] bg-[#181818] px-4">
              {form.persona ? (
                <ReviewRow label="Persona" value={form.persona} />
              ) : null}
              {form.website ? <ReviewRow label="Website" value={form.website} /> : null}
              {form.twitter ? <ReviewRow label="X / Twitter" value={form.twitter} /> : null}
              {form.telegram ? <ReviewRow label="Telegram" value={form.telegram} /> : null}
              {form.github ? <ReviewRow label="GitHub" value={form.github} /> : null}
              <ReviewRow
                label="Branding"
                value={form.image ? "Avatar ready" : "No avatar — add later in profile"}
              />
              <ReviewRow
                label="After create"
                value={
                  deploymentChoice === "token"
                    ? "Open launchpad with prefilled token details"
                    : "Open agent overview"
                }
              />
              <ReviewRow
                label="Account verification"
                value={
                  creationConfig.accountIsVerified ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <ShieldCheck className="size-3.5" aria-hidden />
                      Verified
                    </span>
                  ) : (
                    "Not verified — agents can still be created"
                  )
                }
              />
              <ReviewRow
                label="On-chain registration"
                value="Not registered yet — available from Overview after creation"
              />
              <ReviewRow
                label="Agent wallet"
                value="Generated automatically on create"
              />
            </dl>
          </div>
        );
      default: {
        const _exhaustive: never = stepId;
        return _exhaustive;
      }
    }
  }

  return (
    <div className="ui-onboarding-youtube ui-create-agent-page ui-dashboard-overview mx-auto w-full max-w-3xl space-y-4 px-4 py-6 text-[#f1f1f1] sm:px-6">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity px-4 py-3.5 sm:px-5">
          <p className="text-xs font-medium uppercase tracking-wide text-[#8f8f8f]">
            Step {stepIndex + 1} of {STEPS.length}
          </p>
          <h1 className="mt-1">{step.title}</h1>
          <p className="mt-1 text-sm text-[#aaa]">{step.hint}</p>
        </div>
        <div className="h-1 w-full overflow-hidden bg-[#272727]">
          <div
            className="h-full rounded-full bg-[#f1f1f1] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="ui-onboarding-youtube__panel ui-overview-panel space-y-5 rounded-xl p-4 sm:p-5">
        {renderStepContent(step.id)}

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#303030] pt-4">
          <Button type="button" variant="ghost" onClick={onComplete} asChild={!onComplete}>
            {onComplete ? (
              "Cancel"
            ) : (
              <Link href="/dashboard">Cancel</Link>
            )}
          </Button>
          <div className="flex gap-2">
            {stepIndex > 0 ? (
              <Button type="button" variant="secondary" onClick={onBack} disabled={loading}>
                <ArrowLeft className="mr-2 size-4" aria-hidden />
                Back
              </Button>
            ) : null}
            <Button
              type="button"
              className="rounded-full bg-[#f1f1f1] text-[#0f0f0f] hover:bg-white"
              onClick={onNext}
              disabled={
                loading ||
                avatarBusy ||
                !canAdvance() ||
                (step.id === "review" && !creationConfig.canCreate)
              }
            >
              {loading ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              ) : step.id === "review" ? (
                <Check className="mr-2 size-4" aria-hidden />
              ) : (
                <ArrowRight className="mr-2 size-4" aria-hidden />
              )}
              {step.id === "review" ? (loading ? "Creating…" : "Create agent") : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
