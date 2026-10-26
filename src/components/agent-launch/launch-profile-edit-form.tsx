"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SerializedAgentLaunch } from "@/components/agent-launch/types";
import { AgentLaunchPageShell } from "@/components/agent-launch/agent-launch-page-shell";
import { LaunchModeSwitch } from "@/components/agent-launch/launch-mode-switch";
import { resolveLaunchDisplayProfile } from "@/lib/agent-launch/launch-profile";
type Props = {
  launch: SerializedAgentLaunch;
};
export function LaunchProfileEditForm({ launch: initialLaunch }: Props) {
  const [launch, setLaunch] = useState(initialLaunch);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [displayName, setDisplayName] = useState(launch.profileDisplayName ?? "");
  const [shortDescription, setShortDescription] = useState(launch.profileShortDescription ?? "");
  const [longDescription, setLongDescription] = useState(launch.profileLongDescription ?? "");
  const [avatarUrl, setAvatarUrl] = useState(launch.profileAvatarUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(launch.profileBannerUrl ?? "");
  const [website, setWebsite] = useState(launch.profileWebsite ?? "");
  const [twitter, setTwitter] = useState(launch.profileTwitter ?? "");
  const [telegram, setTelegram] = useState(launch.profileTelegram ?? "");
  const [github, setGithub] = useState(launch.profileGithub ?? "");
  const [tags, setTags] = useState((launch.profileTags ?? []).join(", "));
  const profile = resolveLaunchDisplayProfile(launch);
  const save = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/agent-launch/launches/${launch.id}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileDisplayName: displayName || null,
          profileShortDescription: shortDescription || null,
          profileLongDescription: longDescription || null,
          profileAvatarUrl: avatarUrl || null,
          profileBannerUrl: bannerUrl || null,
          profileWebsite: website || null,
          profileTwitter: twitter || null,
          profileTelegram: telegram || null,
          profileGithub: github || null,
          profileTags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save profile");
      setLaunch(data.launch);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  }, [
    launch.id,
    displayName,
    shortDescription,
    longDescription,
    avatarUrl,
    bannerUrl,
    website,
    twitter,
    telegram,
    github,
    tags,
  ]);
  return (
    <AgentLaunchPageShell>
      <LaunchModeSwitch />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Edit launch profile</h1>
        <p className="text-muted-foreground text-sm">
          Update display metadata for {profile.displayName}. This page edits profile fields only —
          not on-chain launch proof or fee configuration.
        </p>
      </div>
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
        Immutable launch proof, mint, wallets, txs, and fee routing cannot be edited.
      </div>
      <div className="grid max-w-2xl gap-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="shortDescription">Short description</Label>
          <Textarea
            id="shortDescription"
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="longDescription">Long description</Label>
          <Textarea
            id="longDescription"
            value={longDescription}
            onChange={(e) => setLongDescription(e.target.value)}
            rows={4}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="avatarUrl">Avatar URL</Label>
          <Input id="avatarUrl" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bannerUrl">Banner URL</Label>
          <Input id="bannerUrl" value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="website">Website</Label>
          <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="twitter">X / Twitter</Label>
          <Input id="twitter" value={twitter} onChange={(e) => setTwitter(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="telegram">Telegram</Label>
          <Input id="telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="github">GitHub</Label>
          <Input id="github" value={github} onChange={(e) => setGithub(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {saved ? <p className="text-sm text-emerald-600 dark:text-emerald-400">Profile saved.</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void save()} disabled={loading}>
            {loading ? "Saving…" : "Save profile"}
          </Button>
          {launch.mint ? (
            <Button variant="outline" asChild>
              <Link href={`/tokens/${launch.mint}`}>Back to launch page</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </AgentLaunchPageShell>
  );
}
