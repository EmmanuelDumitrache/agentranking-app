"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Coins,
  ImagePlus,
  Loader2,
  ShieldCheck,
  Sparkles,
  User,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BoxLoader } from "@/components/ui/box-loader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AgentRankingWordmark } from "@/components/layout/agent-ranking-wordmark";
import { showToast } from "@/components/ui/toast-simple";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/image-utils";
import { OnboardingStepHeader } from "@/components/dashboard/onboarding-step-header";

/** Solid surfaces — match dashboard panels (no glass / no see-through dither). */
const PANEL =
  "ui-onboarding-youtube__panel ui-overview-panel rounded-xl border border-[#303030] bg-[#181818] shadow-none";
const PANEL_INSET = "rounded-lg border border-[#303030] bg-[#212121]";
const FIELD =
  "border-[#303030] bg-[#212121] text-[#f1f1f1] placeholder:text-[#777] focus-visible:border-[#555]";
const BTN_SECONDARY =
  "ui-onboarding-youtube__button h-11 flex-1 rounded-full border border-[#303030] bg-[#212121] text-[#f1f1f1] hover:bg-[#303030]";
const BTN_PRIMARY =
  "ui-onboarding-youtube__button h-11 flex-1 rounded-full bg-[#f1f1f1] text-[#0f0f0f] hover:bg-white disabled:bg-[#aaa] disabled:text-[#212121]";

const TOTAL_STEPS = 4;
type OnboardingData = {
  agentName: string;
  persona: string;
  avatarUrl: string;
  avatarSkipped: boolean;
  wantsToken: boolean;
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string;
  twitter: string;
  telegram: string;
};
const EMPTY_DATA: OnboardingData = {
  agentName: "",
  persona: "",
  avatarUrl: "",
  avatarSkipped: false,
  wantsToken: false,
  tokenName: "",
  tokenSymbol: "",
  tokenDescription: "",
  twitter: "",
  telegram: "",
};
/* ─── Step header config ─────────────────────────────────────────── */
const STEP_HEADERS: Record<number, { title: string; subtitle: string }> = {
  1: {
    title: "Welcome",
    subtitle: "Create your first agent and get an on-chain wallet in a few steps.",
  },
  2: { title: "Agent Profile", subtitle: "Give your agent a name and describe what it does. You can edit this later." },
  3: { title: "Choose Avatar", subtitle: "Upload an image, generate a themed robot avatar with AI, or skip and add one later." },
  4: { title: "Token Launch", subtitle: "Choose whether to launch a token for this agent, or create it agent-only." },
};
type CreationPhase = "saving" | "wallet" | "preparing" | "redirecting";
const CREATION_STEPS: { phase: CreationPhase; label: string }[] = [
  { phase: "saving", label: "Saving profile" },
  { phase: "wallet", label: "Generating agent wallet" },
  { phase: "preparing", label: "Preparing workspace" },
  { phase: "redirecting", label: "Redirecting to dashboard" },
];
const CREATION_STEPS_TOKEN: { phase: CreationPhase; label: string }[] = [
  { phase: "saving", label: "Saving profile" },
  { phase: "wallet", label: "Generating agent wallet" },
  { phase: "preparing", label: "Preparing token draft" },
  { phase: "redirecting", label: "Opening Token page" },
];
/* ─── Transition screen ──────────────────────────────────────────── */
function CreationTransitionScreen({
  wantsToken,
  phase,
}: {
  wantsToken: boolean;
  phase: CreationPhase;
}) {
  const order = wantsToken ? CREATION_STEPS_TOKEN : CREATION_STEPS;
  const phaseIdx = order.findIndex((s) => s.phase === phase);
  return (
    <div className="ui-onboarding-youtube flex min-h-[70vh] items-center justify-center px-4 text-[#f1f1f1]">
      <div className={cn(PANEL, "w-full max-w-sm p-8 text-center")}>
        <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center">
          <BoxLoader />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-[#f1f1f1]">
          Setting you up
        </h2>
        <p className="mt-1.5 text-sm text-[#aaa]">
          {wantsToken
            ? "Creating your agent and preparing the token draft…"
            : "Creating your agent workspace…"}
        </p>
        <ul className="mt-8 space-y-2">
          {order.map((step, i) => {
            const done = i < phaseIdx;
            const active = i === phaseIdx;
            return (
              <li
                key={step.phase}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors",
                  active
                    ? "border border-[#303030] bg-[#212121]"
                    : done
                      ? "bg-[#212121]/70 opacity-80"
                      : "bg-[#181818] opacity-45",
                )}
              >
                {done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#aaa]" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#f1f1f1]" />
                ) : (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#555] text-[10px] text-[#777]">
                    {i + 1}
                  </span>
                )}
                <span className={cn(active ? "font-medium text-[#f1f1f1]" : "text-[#aaa]")}>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
/* ─── Main wizard ────────────────────────────────────────────────── */
export function DashboardOnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>(EMPTY_DATA);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generatingAvatar, setGeneratingAvatar] = useState(false);
  const [avatarPreviewKey, setAvatarPreviewKey] = useState(0);
  const [creationPhase, setCreationPhase] = useState<CreationPhase | null>(null);
  const update = useCallback(
    (patch: Partial<OnboardingData>) => setData((d) => ({ ...d, ...patch })),
    [],
  );
  const handleAvatarUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload/agent-image", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error("Upload failed");
        const json = await res.json();
        update({ avatarUrl: json.url ?? json.imageUrl ?? "", avatarSkipped: false });
      } catch {
        showToast("Could not upload avatar. You can skip and add one later.", "error");
      } finally {
        setUploading(false);
      }
    },
    [update],
  );
  const handleGenerateAvatar = useCallback(async () => {
    if (generatingAvatar) return;
    setGeneratingAvatar(true);
    try {
      const res = await fetch("/api/dashboard/agents/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: data.agentName.trim(),
          persona: data.persona.trim(),
        }),
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || "Generate failed");
      }
      if (!json.url) throw new Error("No image returned");
      update({ avatarUrl: json.url, avatarSkipped: false });
      setAvatarPreviewKey((k) => k + 1);
      showToast("New AI avatar ready");
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not generate avatar. Try again or upload your own.";
      showToast(message, "error");
    } finally {
      setGeneratingAvatar(false);
    }
  }, [data.agentName, data.persona, generatingAvatar, update]);
  const handleSkipAvatar = useCallback(() => {
    update({ avatarSkipped: true });
    setStep(4);
  }, [update]);
  const handleCreate = useCallback(async () => {
    setCreating(true);
    setCreationPhase("saving");
    try {
      const body: Record<string, unknown> = {
        name: data.agentName.trim(),
        persona: data.persona.trim() || undefined,
        image: data.avatarUrl || undefined,
      };
      if (data.wantsToken) {
        body.twitter = data.twitter.trim() || undefined;
        body.telegram = data.telegram.trim() || undefined;
      }
      setCreationPhase("wallet");
      const res = await fetch("/api/dashboard/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Could not create agent", "error");
        setCreating(false);
        setCreationPhase(null);
        return;
      }
      setCreationPhase("preparing");
      await new Promise((r) => setTimeout(r, 800));
      setCreationPhase("redirecting");
      showToast("Agent created! Solana and EVM wallets are ready.", "success");
      const listed = Boolean(json.registration?.listed);
      if (data.wantsToken && listed) {
        const params = new URLSearchParams();
        const prefillName = data.tokenName?.trim() || data.agentName.trim();
        const prefillSymbol = data.tokenSymbol?.trim() || "";
        const prefillDesc = data.tokenDescription?.trim() || data.persona.trim();
        if (prefillName) params.set("prefillName", prefillName);
        if (prefillSymbol) params.set("prefillSymbol", prefillSymbol);
        if (prefillDesc) params.set("prefillDescription", prefillDesc);
        if (data.avatarUrl) params.set("prefillImage", data.avatarUrl);
        const qs = params.toString();
        router.push(`/dashboard/agents/${json.agent.id}/launchpad${qs ? `?${qs}` : ""}`);
      } else {
        router.push(`/dashboard/agents/${json.agent.id}/register`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not create agent", "error");
      setCreating(false);
      setCreationPhase(null);
    }
  }, [data, router]);
  const canNext = useMemo(() => {
    if (step === 1) return true;
    if (step === 2) return data.agentName.trim().length > 0;
    return true;
  }, [step, data.agentName]);
  const header = STEP_HEADERS[step] ?? STEP_HEADERS[1];
  if (creationPhase != null) {
    return (
      <CreationTransitionScreen wantsToken={data.wantsToken} phase={creationPhase} />
    );
  }
  return (
    <div className="ui-onboarding-youtube mx-auto flex w-full max-w-lg flex-col items-center justify-center px-4 py-10 text-[#f1f1f1] sm:px-6 sm:py-12">
      {/* Step header */}
      <div className="w-full">
        <OnboardingStepHeader
          step={step}
          total={TOTAL_STEPS}
          title={header.title}
          subtitle={header.subtitle}
        />
      </div>
      {/* Step card */}
      <div className="mt-6 w-full">
        <div className={cn(PANEL, "w-full p-6 sm:p-8")}>
          {step === 1 && <Step1 onNext={() => setStep(2)} />}
          {step === 2 && (
            <Step2
              name={data.agentName}
              persona={data.persona}
              onChange={update}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
              canNext={canNext}
            />
          )}
          {step === 3 && (
            <Step3
              avatarUrl={data.avatarUrl}
              avatarPreviewKey={avatarPreviewKey}
              uploading={uploading}
              generating={generatingAvatar}
              onUpload={handleAvatarUpload}
              onGenerate={() => void handleGenerateAvatar()}
              onChange={update}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
              onSkip={handleSkipAvatar}
            />
          )}
          {step === 4 && (
            <Step4
              data={data}
              onChange={update}
              onBack={() => setStep(3)}
              onCreate={handleCreate}
              creating={creating}
            />
          )}
        </div>
      </div>
    </div>
  );
}
/* ─── Step 1 — Welcome ────────────────────────────────────────────── */
function Step1({ onNext }: { onNext: () => void }) {
  const highlights = [
    {
      icon: <User className="h-4 w-4" />,
      title: "Agent identity",
      description: "Name, persona, and avatar",
    },
    {
      icon: <ShieldCheck className="h-4 w-4" />,
      title: "Private KYC verification",
      description: "Prove your identity through your agent — privately and anonymously",
    },
    {
      icon: <Coins className="h-4 w-4" />,
      title: "Tokenize your agent",
      description: "Launch a token on Solana and other supported chains",
    },
    {
      icon: <Zap className="h-4 w-4" />,
      title: "Creator fees",
      description: "Earn when your token is traded",
    },
  ] as const;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center text-center">
        <AgentRankingWordmark
          className="mb-3"
          size="sidebar"
          textClassName="text-[#f1f1f1]"
        />
        <p className="max-w-[18rem] text-sm leading-relaxed text-[#aaa]">
          Create your first agent, get a wallet, and launch when you’re ready.
        </p>
      </div>

      <ul className="mt-8 divide-y divide-[#303030] border-y border-[#303030]">
        {highlights.map((item) => (
          <li key={item.title} className="flex items-start gap-3 py-3.5 text-left">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#303030] bg-[#212121] text-[#f1f1f1]">
              {item.icon}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-medium text-[#f1f1f1]">{item.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[#aaa]">
                {item.description}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-center text-xs text-[#aaa]">
        3 free agents included with your account
      </p>

      <Button
        className={cn(BTN_PRIMARY, "mt-4 w-full text-sm font-medium")}
        onClick={onNext}
      >
        Get started
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
/* ─── Step 2 — Agent Profile ──────────────────────────────────────── */
function Step2({
  name,
  persona,
  onChange,
  onBack,
  onNext,
  canNext,
}: {
  name: string;
  persona: string;
  onChange: (p: Partial<OnboardingData>) => void;
  onBack: () => void;
  onNext: () => void;
  canNext: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agentName" className="text-sm font-medium text-[#f1f1f1]">
            Agent name <span className="text-red-300">*</span>
          </Label>
          <Input
            id="agentName"
            placeholder="e.g. TradingBot 3000"
            value={name}
            onChange={(e) => onChange({ agentName: e.target.value })}
            maxLength={80}
            autoFocus
            className={FIELD}
          />
          <p className="text-xs text-[#aaa]">{name.length}/80 characters</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="persona" className="text-sm font-medium text-[#f1f1f1]">
            Persona / description
          </Label>
          <Textarea
            id="persona"
            placeholder="Describe what your agent does..."
            value={persona}
            onChange={(e) => onChange({ persona: e.target.value })}
            maxLength={1000}
            rows={3}
            className={cn("resize-none", FIELD)}
          />
          <p className="text-xs text-[#aaa]">Optional — {persona.length}/1000</p>
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className={BTN_SECONDARY}
          onClick={onBack}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          className={cn(BTN_PRIMARY, "text-sm font-medium")}
          onClick={onNext}
          disabled={!canNext}
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
/* ─── Step 3 — Avatar ─────────────────────────────────────────────── */
function Step3({
  avatarUrl,
  avatarPreviewKey,
  uploading,
  generating,
  onUpload,
  onGenerate,
  onChange,
  onBack,
  onNext,
  onSkip,
}: {
  avatarUrl: string;
  avatarPreviewKey: number;
  uploading: boolean;
  generating: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onGenerate: () => void;
  onChange: (p: Partial<OnboardingData>) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const busy = uploading || generating;
  const previewSrc = resolveImageUrl(avatarUrl);
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-36 w-36 overflow-hidden rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-950">
          {previewSrc ? (
            <RuntimeImage
              key={avatarPreviewKey}
              src={previewSrc}
              alt="Avatar"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImagePlus className="h-10 w-10 text-zinc-600" />
            </div>
          )}
          {generating ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/75">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-200" />
              <span className="text-[11px] font-medium text-zinc-300">
                {avatarUrl ? "Generating new…" : "Generating…"}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <label className={busy ? "pointer-events-none opacity-60" : "cursor-pointer"}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onUpload}
              className="hidden"
              disabled={busy}
            />
            <span className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800">
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <ImagePlus className="h-4 w-4" />
                  Upload image
                </>
              )}
            </span>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={onGenerate}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-60"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {avatarUrl ? "Generate new" : "Generate with AI"}
              </>
            )}
          </button>
        </div>
        <p className="max-w-xs text-center text-xs text-zinc-500">
          AI makes a themed robot-style AgentRanking avatar from your agent name and persona.
          Click again anytime for a new one.
        </p>
        {avatarUrl && (
          <button
            type="button"
            onClick={() => onChange({ avatarUrl: "", avatarSkipped: false })}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            disabled={busy}
          >
            Remove
          </button>
        )}
      </div>
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className={BTN_SECONDARY}
          onClick={onBack}
          disabled={busy}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          variant="outline"
          className={BTN_SECONDARY}
          onClick={onSkip}
          disabled={busy}
        >
          Skip for now
        </Button>
        <Button
          className={cn(BTN_PRIMARY, "text-sm font-medium")}
          onClick={onNext}
          disabled={!avatarUrl || busy}
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
/* ─── Step 4 — Token Choice ───────────────────────────────────────── */
function Step4({
  data,
  onChange,
  onBack,
  onCreate,
  creating,
}: {
  data: OnboardingData;
  onChange: (p: Partial<OnboardingData>) => void;
  onBack: () => void;
  onCreate: () => void;
  creating: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3">
        <button
          type="button"
          onClick={() => onChange({ wantsToken: false })}
          className={cn(
            "ui-onboarding-youtube__choice rounded-xl border p-4 text-left transition-all",
            !data.wantsToken
              ? "border-[#f1f1f1] bg-[#212121]"
              : "border-[#303030] bg-[#181818] hover:border-[#555] hover:bg-[#212121]",
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                !data.wantsToken
                  ? "border-[#f1f1f1] bg-[#f1f1f1]"
                  : "border-[#555] bg-[#212121]",
              )}
            >
              {!data.wantsToken && (
                <div className="h-2.5 w-2.5 rounded-full bg-[#0f0f0f]" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-[#f1f1f1]">Create agent only</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[#aaa]">
                No token. Just the agent with its own wallet.
              </p>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onChange({ wantsToken: true })}
          className={cn(
            "ui-onboarding-youtube__choice rounded-xl border p-4 text-left transition-all",
            data.wantsToken
              ? "border-[#f1f1f1] bg-[#212121]"
              : "border-[#303030] bg-[#181818] hover:border-[#555] hover:bg-[#212121]",
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                data.wantsToken
                  ? "border-[#f1f1f1] bg-[#f1f1f1]"
                  : "border-[#555] bg-[#212121]",
              )}
            >
              {data.wantsToken && (
                <div className="h-2.5 w-2.5 rounded-full bg-[#0f0f0f]" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-[#f1f1f1]">Tokenize agent</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[#aaa]">
                Launch a Pump.fun token linked to this agent. Uses the agent&apos;s wallet and
                requires SOL for Solana network costs.
              </p>
            </div>
          </div>
        </button>
      </div>
      {data.wantsToken && (
        <div className={cn(PANEL_INSET, "space-y-4 p-4")}>
          <p className="text-sm font-medium text-[#f1f1f1]">Token details (pre-fill)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-[#aaa]">Token name</Label>
              <Input
                placeholder={data.agentName || "e.g. Agent Token"}
                value={data.tokenName}
                onChange={(e) => onChange({ tokenName: e.target.value })}
                className={FIELD}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-[#aaa]">Token symbol</Label>
              <Input
                placeholder="e.g. AGENT"
                value={data.tokenSymbol}
                onChange={(e) => onChange({ tokenSymbol: e.target.value.toUpperCase() })}
                maxLength={10}
                className={FIELD}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-[#aaa]">Description</Label>
            <Textarea
              placeholder="Brief description of the token..."
              value={data.tokenDescription}
              onChange={(e) => onChange({ tokenDescription: e.target.value })}
              rows={2}
              className={cn("resize-none", FIELD)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-[#aaa]">X / Twitter</Label>
              <Input
                placeholder="Optional"
                value={data.twitter}
                onChange={(e) => onChange({ twitter: e.target.value })}
                className={FIELD}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-[#aaa]">Telegram</Label>
              <Input
                placeholder="Optional"
                value={data.telegram}
                onChange={(e) => onChange({ telegram: e.target.value })}
                className={FIELD}
              />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-[#aaa]">
            Token launch uses the agent&apos;s wallet and requires SOL for Solana/Pump.fun network
            costs. You will review everything before launching.
          </p>
        </div>
      )}
      <div className={cn(PANEL_INSET, "px-4 py-3")}>
        <p className="text-sm font-medium text-[#f1f1f1]">Review</p>
        <ul className="mt-2 space-y-1.5">
          <li className="flex items-center gap-2 text-xs text-[#aaa]">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#777]" />
            Name:{" "}
            {data.agentName ? (
              <span className="text-[#f1f1f1]">{data.agentName}</span>
            ) : (
              <span className="text-red-300">Required</span>
            )}
          </li>
          <li className="flex items-center gap-2 text-xs text-[#aaa]">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#777]" />
            Avatar:{" "}
            <span className="text-[#f1f1f1]">
              {data.avatarUrl ? "Set" : data.avatarSkipped ? "Skipped" : "None"}
            </span>
          </li>
          <li className="flex items-center gap-2 text-xs text-[#aaa]">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#777]" />
            Token:{" "}
            <span className="text-[#f1f1f1]">
              {data.wantsToken ? "Yes — will redirect to Token page" : "No token"}
            </span>
          </li>
          <li className="flex items-center gap-2 text-xs text-[#aaa]">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#777]" />
            Wallet: <span className="text-[#f1f1f1]">Auto-generated on creation</span>
          </li>
        </ul>
      </div>
      <div className="flex gap-3 pt-2">
        <Button
          variant="outline"
          className={BTN_SECONDARY}
          onClick={onBack}
          disabled={creating}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          className={cn(BTN_PRIMARY, "inline-flex items-center justify-center gap-2 text-sm font-medium")}
          onClick={onCreate}
          disabled={creating || !data.agentName.trim()}
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {creating
            ? "Creating agent…"
            : data.wantsToken
              ? "Create agent & continue to Token"
              : "Create agent"}
          {!creating ? <ArrowRight className="h-4 w-4" /> : null}
        </Button>
      </div>
    </div>
  );
}
