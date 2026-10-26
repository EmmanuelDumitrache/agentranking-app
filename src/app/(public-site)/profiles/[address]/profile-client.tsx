"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useTransientState } from "@/hooks/use-transient-state";
import { useState, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProfileFollow } from "@/hooks/use-profile-follow";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { cn, truncateAddress } from "@/lib/utils";
import {
  Bot, Globe, Edit2, Check, X, UserPlus, UserMinus,
  Cpu, Users, Calendar, ExternalLink, ArrowLeft,
  MessageSquare, Loader2, BadgeCheck, Copy, CheckCheck,
} from "lucide-react";
import { protocolTrustBand } from "@/lib/agent-rankable";
import type { BuilderReputationResult } from "@/lib/builder-reputation";
import { establishLaunchWalletSessionWithSigner } from "@/lib/launch-wallet-session/client";
interface AgentItem {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string | null;
  rank: number;
  score: number;
  agentRankScore: number;
  protocolTrustScore: number;
  totalFeedback: number;
  isActive: boolean;
  isVerified: boolean;
  isPremiumVerified?: boolean;
  x402Support?: boolean;
  sapVerified?: boolean;
  profilePath: string;
  chain: { shortName: string; color: string; icon: string };
  services?: Array<{ name: string }>;
}
interface FeedbackItem {
  id: number;
  value: number;
  displayScore: number;
  source: "site" | "onchain";
  tag1?: string | null;
  tag2?: string | null;
  comment: string;
  createdAt: string;
  agent: {
    id: number;
    agentId: number;
    chainId: number;
    name: string;
    profilePath: string;
    chain: { shortName: string; color: string; icon: string };
  };
}
export interface ProfileData {
  isHolderGolden?: boolean;
  profile: {
    username?: string | null;
    displayName?: string | null;
    bio?: string | null;
    avatarUrl?: string | null;
    twitterUrl?: string | null;
    githubUrl?: string | null;
    websiteUrl?: string | null;
    followersCount?: number;
    followingCount?: number;
    createdAt?: string;
  } | null;
  walletAddress: string;
  linkedAgents?: AgentItem[];
  ownedAgents: AgentItem[];
  feedbackGiven: FeedbackItem[];
  builderReputation?: BuilderReputationResult;
  profileVerified?: boolean;
  protocolTags?: string[];
  summary?: {
    linkedAgentCount: number;
    avgArScore: number;
    highestArScore: number;
    topAgentName: string | null;
    topAgentRank: number | null;
    totalReviews: number;
    protocolTags: string[];
  };
  generatedAt: string;
  stats: {
    agentsCount: number;
    feedbackCount: number;
    avgFeedbackGiven: number | null;
  };
}
function SignalScore({ score, source }: { score: number; source: "site" | "onchain" }) {
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div className="min-w-[5.5rem] rounded-lg border border-border bg-muted/20 px-2 py-1 text-right">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{source === "onchain" ? "On-chain" : "Site"} signal</p>
      <p className="font-mono text-sm font-semibold text-primary">{safeScore}/100</p>
    </div>
  );
}
interface EditFormState {
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  twitterUrl: string;
  githubUrl: string;
  websiteUrl: string;
}
export function ProfileClient({
  address,
  initialData,
  initialFollowerAddress,
  initialFollowing,
}: {
  address: string;
  initialData: ProfileData;
  initialFollowerAddress: string | null;
  initialFollowing: boolean;
}) {
  const { address: connectedAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const isOwner = connectedAddress?.toLowerCase() === address.toLowerCase();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    username: "",
    displayName: "",
    bio: "",
    avatarUrl: "",
    twitterUrl: "",
    githubUrl: "",
    websiteUrl: "",
  });
  const [copied, setCopied] = useTransientState(false, 2000);
  const { data, isLoading } = useQuery<ProfileData>({
    queryKey: ["profile", address],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/profiles/${encodeURIComponent(address)}`, { signal });
      if (!response.ok) throw new Error(`Failed to load profile (${response.status})`);
      const payload = (await response.json()) as Omit<ProfileData, "generatedAt"> &
        Partial<Pick<ProfileData, "generatedAt">>;
      return { ...payload, generatedAt: payload.generatedAt ?? new Date().toISOString() };
    },
    initialData,
    initialDataUpdatedAt: Date.parse(initialData.generatedAt),
    refetchOnMount: false,
  });
  const profile = data?.profile;
  const isHolderGolden = Boolean(data?.isHolderGolden);
  const linkedAgents = data?.linkedAgents ?? data?.ownedAgents ?? [];
  const builderRep = data?.builderReputation;
  const repLabel =
    builderRep?.status === "ok" ? builderRep.label : "Not enough signals yet";
  const copyWallet = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      /* ignore */
    }
  }, [address, setCopied]);
  const displayName = profile?.displayName || profile?.username || truncateAddress(address, 8);
  const {
    isFollowing,
    followLoading,
    isSelf: isFollowSelf,
    toggleFollow,
  } = useProfileFollow(address, {
    targetLabel: displayName,
    initialFollowerAddress,
    initialFollowing,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", address] });
    },
  });
  const startEdit = () => {
    setEditForm({
      username: profile?.username ?? "",
      displayName: profile?.displayName ?? "",
      bio: profile?.bio ?? "",
      avatarUrl: profile?.avatarUrl ?? "",
      twitterUrl: profile?.twitterUrl ?? "",
      githubUrl: profile?.githubUrl ?? "",
      websiteUrl: profile?.websiteUrl ?? "",
    });
    setSaveError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
  };
  const saveEdit = async () => {
    if (!connectedAddress) return;
    setSaving(true);
    setSaveError(null);
    try {
      const submit = () => fetch(`/api/profiles/${address}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ...editForm, callerAddress: connectedAddress }),
        });
      let res = await submit();
      let json = await res.json() as { error?: string; code?: string };
      if (!res.ok && json.code === "WALLET_SESSION_REQUIRED") {
        await establishLaunchWalletSessionWithSigner({
          chain: "evm",
          wallet: connectedAddress,
          signMessage: (message) => signMessageAsync({ message }),
        });
        res = await submit();
        json = await res.json() as { error?: string; code?: string };
      }
      if (!res.ok) {
        setSaveError(json.error ?? "Failed to save");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["profile", address] });
      setEditing(false);
    } catch {
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto animate-pulse space-y-4">
        <div className="h-24 bg-card rounded-xl border border-border" />
        <div className="h-48 bg-card rounded-xl border border-border" />
      </div>
    );
  }
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      {/* Back link */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/social" className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Social profiles
        </Link>
        <span className="text-muted-foreground/40">·</span>
        <Link href="/feedback" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
          Feedback registry
        </Link>
      </div>
      {/* Profile header card */}
      <div
        className={cn(
          "rounded-xl border bg-card p-4 mb-4",
          isHolderGolden ? "border-amber-500/35 bg-gradient-to-br from-amber-950/20 via-card to-card shadow-[0_0_24px_rgba(245,158,11,0.08)]" : "border-border",
        )}
      >
        {editing ? (
          /* Edit form */
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold">Edit Profile</h2>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancelEdit} disabled={saving}>
                  <X className="h-3.5 w-3.5 mr-1" /> Cancel
                </Button>
                <Button size="sm" className="h-7 px-2 text-xs" onClick={saveEdit} disabled={saving}>
                  <Check className="h-3.5 w-3.5 mr-1" /> {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block" htmlFor="edit-username">Username</label>
                <Input id="edit-username" value={editForm.username} onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))} placeholder="e.g. satoshi" className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block" htmlFor="edit-displayName">Display Name</label>
                <Input id="edit-displayName" value={editForm.displayName} onChange={(e) => setEditForm((f) => ({ ...f, displayName: e.target.value }))} placeholder="Your name" className="h-8 text-xs" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block" htmlFor="edit-bio">Bio</label>
              <Textarea id="edit-bio" value={editForm.bio} onChange={(e) => setEditForm((f) => ({ ...f, bio: e.target.value }))} placeholder="Tell us about yourself…" className="text-xs resize-none" rows={3} maxLength={300} />
              <p className="text-[10px] text-muted-foreground text-right mt-0.5">{editForm.bio.length}/300</p>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block" htmlFor="edit-avatarUrl">Avatar URL</label>
              <Input id="edit-avatarUrl" value={editForm.avatarUrl} onChange={(e) => setEditForm((f) => ({ ...f, avatarUrl: e.target.value }))} placeholder="https://..." className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block" htmlFor="edit-twitter">Twitter / X URL</label>
                <Input id="edit-twitter" value={editForm.twitterUrl} onChange={(e) => setEditForm((f) => ({ ...f, twitterUrl: e.target.value }))} placeholder="https://x.com/..." className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block" htmlFor="edit-github">GitHub URL</label>
                <Input id="edit-github" value={editForm.githubUrl} onChange={(e) => setEditForm((f) => ({ ...f, githubUrl: e.target.value }))} placeholder="https://github.com/..." className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block" htmlFor="edit-website">Website URL</label>
                <Input id="edit-website" value={editForm.websiteUrl} onChange={(e) => setEditForm((f) => ({ ...f, websiteUrl: e.target.value }))} placeholder="https://..." className="h-8 text-xs" />
              </div>
            </div>
          </div>
        ) : (
          /* Profile display */
          <div className="flex items-start gap-3">
            {profile?.avatarUrl ? (
              <RuntimeImage
                src={profile.avatarUrl}
                alt={displayName}
                className={cn(
                  "h-14 w-14 rounded-full object-cover shrink-0",
                  isHolderGolden ? "border-2 border-amber-400/60 shadow-[0_0_12px_rgba(251,191,36,0.25)]" : "border border-border",
                )}
              />
            ) : (
              <div
                className={cn(
                  "h-14 w-14 rounded-full bg-muted flex items-center justify-center shrink-0",
                  isHolderGolden ? "border-2 border-amber-400/60" : "border border-border",
                )}
              >
                <Bot className="h-7 w-7 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h1
                    className={cn("text-lg font-bold leading-tight", isHolderGolden && "font-extrabold")}
                    style={
                      isHolderGolden
                        ? {
                            background: "linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                          }
                        : undefined
                    }
                  >
                    {displayName}
                  </h1>
                  {isHolderGolden ? (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-amber-200 ring-1 ring-amber-400/40 shadow-[0_0_12px_rgba(251,191,36,0.15)]">
                      <BadgeCheck className="h-3 w-3 text-amber-300" /> Golden Enhanced Profile · Core Staker
                    </span>
                  ) : null}
                  {profile?.username && (
                    <p className="text-xs text-muted-foreground">@{profile.username}</p>
                  )}
                  <div className="mt-0.5 flex items-center gap-1">
                    <p className="font-mono text-xs text-muted-foreground">{truncateAddress(address, 10)}</p>
                    <button
                      type="button"
                      onClick={() => void copyWallet()}
                      className="inline-flex rounded p-0.5 text-muted-foreground hover:text-foreground"
                      title="Copy wallet address"
                    >
                      {copied ? (
                        <CheckCheck className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                  {data?.profileVerified ? (
                    <p className="mt-1 text-[10px] text-amber-400/90">Verified builder (agent or stake signals)</p>
                  ) : null}
                </div>
                {isOwner ? (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0" onClick={startEdit}>
                    <Edit2 className="h-3 w-3 mr-1" /> Edit
                  </Button>
                ) : !isFollowSelf ? (
                  <Button
                    size="sm"
                    variant={isFollowing ? "ghost" : "outline"}
                    className="h-7 px-3 text-xs shrink-0"
                    onClick={() => void toggleFollow()}
                    disabled={followLoading}
                  >
                    {followLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isFollowing ? (
                      <><UserMinus className="h-3 w-3 mr-1" /> Unfollow</>
                    ) : (
                      <><UserPlus className="h-3 w-3 mr-1" /> Follow</>
                    )}
                  </Button>
                ) : null}
              </div>
              {profile?.bio && (
                <p className="text-sm text-muted-foreground mt-1.5 leading-snug">{profile.bio}</p>
              )}
              {/* Stats row */}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">{profile?.followersCount ?? 0}</span> followers
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-medium text-foreground">{profile?.followingCount ?? 0}</span> following
                </span>
                <span className="flex items-center gap-1">
                  <Cpu className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">{data?.stats.agentsCount ?? 0}</span> agents
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">{data?.stats.feedbackCount ?? 0}</span> signals
                </span>
                {profile?.createdAt && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    Joined {new Date(profile.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                  </span>
                )}
              </div>
              {/* Social links */}
              {(profile?.twitterUrl || profile?.githubUrl || profile?.websiteUrl) && (
                <div className="flex items-center gap-2 mt-2">
                  {profile.twitterUrl && (
                    <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                      Twitter
                    </a>
                  )}
                  {profile.githubUrl && (
                    <a href={profile.githubUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>
                      GitHub
                    </a>
                  )}
                  {profile.websiteUrl && (
                    <a href={profile.websiteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <Globe className="h-3.5 w-3.5" /> Website
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Tabs */}
      <Tabs defaultValue="agents">
        <TabsList className="h-8 text-xs mb-3">
          <TabsTrigger value="agents" className="text-xs h-7 px-3">
            Linked agents ({data?.stats.agentsCount ?? 0})
          </TabsTrigger>
          <TabsTrigger value="feedback" className="text-xs h-7 px-3">
            Signals ({data?.stats.feedbackCount ?? 0})
          </TabsTrigger>
          <TabsTrigger value="overview" className="text-xs h-7 px-3">
            Overview
          </TabsTrigger>
        </TabsList>
        {/* Agents tab */}
        <TabsContent value="agents">
          {!linkedAgents.length ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              <p>No linked agents yet.</p>
              <p className="mt-2 text-xs text-muted-foreground/80">
                Claim or verify an agent to build your profile reputation.
              </p>
              <Button asChild size="sm" className="mt-4 rounded-full">
                <Link href="/dashboard">Open Agent Dashboard</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {linkedAgents.map((agent) => (
                <Link
                  key={agent.id}
                  href={agent.profilePath}
                  className="group rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted/15"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold group-hover:text-primary">{agent.name}</p>
                        {agent.isVerified && <BadgeCheck className="h-3.5 w-3.5 text-amber-400" />}
                        <AgentListChainCell chainId={agent.chainId} chain={agent.chain} icon={agent.chain.icon} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {agent.rank > 0 ? (
                          <span className="rounded-full border border-border bg-muted/20 px-2 py-0.5">
                            Rank #{agent.rank}
                          </span>
                        ) : null}
                        <span className="rounded-full border border-border bg-muted/20 px-2 py-0.5">
                          AR {agent.agentRankScore ?? 0}
                        </span>
                        <span className="rounded-full border border-border bg-muted/20 px-2 py-0.5">
                          Trust {protocolTrustBand(agent.protocolTrustScore ?? 0)}
                        </span>
                        {agent.sapVerified ? (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
                            SAP
                          </span>
                        ) : null}
                        {agent.x402Support ? (
                          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-300">
                            x402
                          </span>
                        ) : null}
                        {agent.isVerified || agent.isPremiumVerified ? (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-400">
                            Verified
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
        {/* Feedback tab */}
        <TabsContent value="feedback">
          {!data?.feedbackGiven?.length ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No feedback signals submitted yet.
            </div>
          ) : (
            <div className="space-y-3">
              {data.feedbackGiven.map((fb) => (
                <div key={fb.id} className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-muted/15">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Link
                          href={fb.agent.profilePath}
                          className="text-xs font-medium hover:text-primary transition-colors"
                        >
                          {fb.agent.name}
                        </Link>
                        <AgentListChainCell
                          chainId={fb.agent.chainId}
                          chain={fb.agent.chain}
                          icon={fb.agent.chain.icon}
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(fb.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {(fb.tag1 || fb.tag2) && (
                        <div className="mb-1.5 flex flex-wrap gap-1">
                          {[fb.tag1, fb.tag2].filter(Boolean).map((tag) => (
                            <span key={tag} className="rounded-full border border-border bg-muted/20 px-2 py-0.5 text-[10px] text-muted-foreground">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {fb.comment && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{fb.comment}</p>
                      )}
                    </div>
                    <div className="shrink-0 pt-0.5">
                      <SignalScore score={fb.displayScore} source={fb.source} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        {/* Overview tab */}
        <TabsContent value="overview">
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Builder reputation</h3>
              <p className="mt-1 text-lg font-bold text-primary">{repLabel}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Derived from the quality, verification, metadata, and activity of agents linked to this profile.
                This is an ecosystem score for discovery — not proof of honesty or financial advice.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Profile stats
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                  <p className="text-xl font-bold">{data?.summary?.linkedAgentCount ?? data?.stats.agentsCount ?? 0}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Linked agents</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                  <p className="text-xl font-bold">
                    {(data?.summary?.avgArScore ?? 0) > 0 ? data?.summary?.avgArScore : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Avg AR Score</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                  <p className="text-xl font-bold">
                    {data?.summary?.highestArScore ? data.summary.highestArScore : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Highest AR</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                  <p className="text-xl font-bold">{data?.summary?.totalReviews ?? 0}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Reviews (agents)</p>
                </div>
              </div>
              {data?.summary?.topAgentName ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Top ranked linked agent:{" "}
                  <span className="font-medium text-foreground">{data.summary.topAgentName}</span>
                  {data.summary.topAgentRank ? ` (#${data.summary.topAgentRank})` : ""}
                </p>
              ) : null}
              {(data?.protocolTags?.length ?? 0) > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {data!.protocolTags!.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent activity
              </h3>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
                  Activity feed coming soon — claimed agents, verifications, and reviews will appear here.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Signals sent</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                  <p className="text-xl font-bold">{data?.stats.feedbackCount ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Feedback signals</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
                  {data?.stats.avgFeedbackGiven != null ? (
                    <>
                      <p className="text-xl font-bold text-primary">{data.stats.avgFeedbackGiven.toFixed(0)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Avg signal /100</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xl font-bold text-muted-foreground">—</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Avg signal /100</p>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Wallet</h3>
              <p className="text-xs font-mono text-muted-foreground break-all">{address}</p>
            </div>
            {profile?.createdAt && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Member Since</h3>
                <p className="text-sm">{new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
