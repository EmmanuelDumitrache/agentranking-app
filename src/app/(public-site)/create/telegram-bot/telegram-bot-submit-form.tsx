"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useState, useRef, useMemo } from "react";
import {
  AlertTriangle, Loader2, Upload, User, Send, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { agentsArchetypeHref } from "@/lib/agents-archetype-filter";
const TG_BLUE = "#229ED9";
function TelegramIcon({ className, style }: { readonly className?: string; readonly style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.17 13.404l-2.97-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.007.13.988.155z" />
    </svg>
  );
}
export function TelegramBotSubmitForm() {
  const [form, setForm] = useState({
    name: "",
    description: "",
    botUsername: "",
    botType: "standalone" as "standalone" | "managed",
    managerBotUsername: "",
  });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    { ok: true; agentId: number; chainId: number; name: string; profilePath: string } | { ok: false; error: string } | null
  >(null);
  function updateField<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }
  const spawnUrl = useMemo(() => {
    if (form.botType !== "managed" || !form.managerBotUsername.trim() || !form.botUsername.trim()) return "";
    const manager = form.managerBotUsername.trim().replace(/^@/, "");
    const username = form.botUsername.trim().replace(/^@/, "");
    const displayName = form.name.trim() || username;
    return `https://t.me/newbot/${manager}/${username}?name=${encodeURIComponent(displayName)}`;
  }, [form.botType, form.managerBotUsername, form.botUsername, form.name]);
  async function handleImageUpload(file: File) {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) { setImageError("Use PNG, JPG, WebP, or GIF."); return; }
    if (file.size > 1 * 1024 * 1024) { setImageError("Max 1MB."); return; }
    setImageError(null);
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ads/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setImageError(data.error ?? "Upload failed"); return; }
      setImageUrl(data.url);
    } catch { setImageError("Upload failed. Try again."); }
    finally { setImageUploading(false); }
  }
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.name.trim() || !form.description.trim() || !form.botUsername.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        chainId: 9999,
        archetype: "telegram",
        image: imageUrl ?? "",
        telegramBotUsername: form.botUsername.trim().replace(/^@/, ""),
        telegramBotType: form.botType,
        services: [{ name: "TELEGRAM", endpoint: `t.me/${form.botUsername.trim().replace(/^@/, "")}` }],
      };
      if (form.botType === "managed" && form.managerBotUsername.trim()) {
        payload.telegramManagerBotUsername = form.managerBotUsername.trim().replace(/^@/, "");
        if (spawnUrl) payload.telegramSpawnUrl = spawnUrl;
      }
      const res = await fetch("/api/custom-listing/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({
          ok: true,
          agentId: data.agentId,
          chainId: data.chainId,
          name: form.name.trim(),
          profilePath: data.profilePath,
        });
      } else {
        setResult({ ok: false, error: data.error ?? "Failed to submit" });
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }
  if (result?.ok) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: `${TG_BLUE}30`, background: `${TG_BLUE}08` }}>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: `${TG_BLUE}20` }}>
            <TelegramIcon className="h-6 w-6" style={{ color: TG_BLUE }} />
          </div>
          <h2 className="text-lg font-bold mb-2">Telegram Bot Listed!</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Your Telegram bot has been added to AgentRanking. It appears in the{" "}
            <Link href={agentsArchetypeHref("telegram")} className="underline" style={{ color: TG_BLUE }}>Telegram directory</Link>{" "}
            and is visible to all users.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button asChild className="rounded-full" style={{ background: TG_BLUE, borderColor: TG_BLUE }}>
              <Link href={result.profilePath}>View Bot Page</Link>
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setResult(null);
                setForm({ name: "", description: "", botUsername: "", botType: "standalone", managerBotUsername: "" });
                setImageUrl(null);
              }}
            >
              Submit Another
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-xl mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border" style={{ borderColor: `${TG_BLUE}40`, background: `${TG_BLUE}15` }}>
            <TelegramIcon className="h-5 w-5" style={{ color: TG_BLUE }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Submit Telegram Bot</h1>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${TG_BLUE}15`, color: TG_BLUE }}>Free</span>
            </div>
            <p className="text-xs text-muted-foreground">List your Telegram bot or managed agent on AgentRanking</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3 flex gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[#229ED9]" />
          <span>
            Telegram now supports <strong>Managed Bots</strong> — bots users can spawn from a manager bot via a direct link.
            List yours here so the community can discover and spawn it.
          </span>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Profile Picture */}
        <div>
          <label htmlFor="tg-image" className="text-xs font-medium text-muted-foreground mb-2 block">
            Bot Icon <span className="opacity-50">(optional, max 1MB)</span>
          </label>
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              {imageUrl ? (
                <RuntimeImage src={imageUrl} alt="Bot icon preview" className="h-16 w-16 rounded-xl object-cover border-2 border-border" />
              ) : (
                <div className="h-16 w-16 rounded-xl border-2 border-dashed border-border flex items-center justify-center bg-muted/20">
                  <User className="h-6 w-6 text-muted-foreground/40" />
                </div>
              )}
            </div>
            <div className="flex-1">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                id="tg-image"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full text-xs"
                onClick={() => imageInputRef.current?.click()}
                disabled={imageUploading}
              >
                {imageUploading ? (
                  <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Uploading…</>
                ) : (
                  <><Upload className="h-3 w-3 mr-1.5" />{imageUrl ? "Replace" : "Upload Icon"}</>
                )}
              </Button>
              {imageError && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{imageError}</p>}
              {!imageError && <p className="text-[10px] text-muted-foreground/60 mt-1">PNG, JPG, WebP · Square · 400×400px recommended</p>}
            </div>
          </div>
        </div>
        {/* Bot Username */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="tg-username">
            Bot Username <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">@</span>
            <input
              id="tg-username"
              type="text"
              required
              maxLength={64}
              placeholder="mybot"
              value={form.botUsername}
              onChange={(e) => updateField("botUsername", e.target.value.replace(/^@/, ""))}
              className="w-full rounded-lg border border-border bg-background pl-7 pr-3 py-2 text-sm"
            />
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">Your bot&apos;s Telegram @username, without the @</p>
        </div>
        {/* Display Name */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="tg-name">
            Display Name <span className="text-red-400">*</span>
          </label>
          <input
            id="tg-name"
            type="text"
            required
            maxLength={80}
            placeholder="My Telegram Bot"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        {/* Description */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="tg-desc">
            Description <span className="text-red-400">*</span>
          </label>
          <textarea
            id="tg-desc"
            required
            maxLength={500}
            rows={3}
            placeholder="What does your Telegram bot do? What tasks can it perform?"
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
          />
        </div>
        {/* Bot Type */}
        <fieldset>
          <legend className="text-xs font-medium text-muted-foreground mb-2 block">
            Bot Type <span className="text-red-400">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(["standalone", "managed"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => updateField("botType", type)}
                className="rounded-lg border px-3 py-3 text-left transition-colors"
                style={
                  form.botType === type
                    ? { borderColor: `${TG_BLUE}60`, background: `${TG_BLUE}10` }
                    : {}
                }
              >
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center"
                    style={
                      form.botType === type
                        ? { borderColor: TG_BLUE }
                        : { borderColor: "var(--border)" }
                    }
                  >
                    {form.botType === type && (
                      <div className="h-2 w-2 rounded-full" style={{ background: TG_BLUE }} />
                    )}
                  </div>
                  <span className="text-xs font-medium capitalize">{type}</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  {type === "standalone"
                    ? "A regular bot users can start directly via t.me"
                    : "A bot spawned from a manager bot with a deep link"}
                </p>
              </button>
            ))}
          </div>
        </fieldset>
        {/* Manager Bot (only for managed) */}
        {form.botType === "managed" && (
          <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: `${TG_BLUE}30`, background: `${TG_BLUE}05` }}>
            <p className="text-xs font-semibold" style={{ color: TG_BLUE }}>Managed Bot Configuration</p>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="tg-manager">
                Manager Bot Username <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">@</span>
                <input
                  id="tg-manager"
                  type="text"
                  required={form.botType === "managed"}
                  maxLength={64}
                  placeholder="managerbotname"
                  value={form.managerBotUsername}
                  onChange={(e) => updateField("managerBotUsername", e.target.value.replace(/^@/, ""))}
                  className="w-full rounded-lg border border-border bg-background pl-7 pr-3 py-2 text-sm"
                />
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">The parent manager bot that creates sub-bots</p>
            </div>
              {spawnUrl && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Auto-generated Spawn URL
                </p>
                <div className="rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-muted-foreground break-all">
                  {spawnUrl}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  This deep link lets users spawn the bot directly from Telegram
                </p>
              </div>
            )}
          </div>
        )}
        {result && !result.ok && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex gap-2 text-xs text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {result.error}
          </div>
        )}
        <Button
          type="submit"
          className="w-full rounded-full font-medium"
          style={{ background: TG_BLUE, borderColor: TG_BLUE }}
          disabled={
            submitting ||
            !form.name.trim() ||
            !form.description.trim() ||
            !form.botUsername.trim() ||
            (form.botType === "managed" && !form.managerBotUsername.trim())
          }
        >
          {submitting ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting…</>
          ) : (
            <><Send className="h-4 w-4 mr-2" />List Telegram Bot →</>
          )}
        </Button>
      </form>
      {/* Footer note */}
      <div className="mt-6 rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">What happens next?</p>
        <p>· Your bot appears immediately in the <Link href={agentsArchetypeHref("telegram")} className="underline hover:text-foreground" style={{ color: TG_BLUE }}>Telegram directory</Link></p>
        <p>· Visitors can discover your bot and spawn it directly from the listing page</p>
        <p>· Listings are free · 1 per IP per 24 hours · appear as Unverified</p>
        <p>· <Link href="/verified" className="underline hover:text-foreground">Verify your agent</Link> to remove the badge and unlock ranking boosts</p>
      </div>
    </div>
  );
}
