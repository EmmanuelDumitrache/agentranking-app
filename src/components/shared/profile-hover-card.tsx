"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { truncateAddress } from "@/lib/utils";
import { Bot, Users, Cpu, ExternalLink, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
interface ProfileData {
  profile: {
    username?: string | null;
    displayName?: string | null;
    bio?: string;
    avatarUrl?: string;
    twitterUrl?: string;
    githubUrl?: string;
    websiteUrl?: string;
    followersCount?: number;
    followingCount?: number;
    createdAt?: string;
  } | null;
  walletAddress: string;
  stats: {
    agentsCount: number;
    feedbackCount: number;
    avgFeedbackGiven: number | null;
  };
}
function DefaultAvatar({ size = 40 }: { size?: number }) {
  return (
    <div
      className="rounded-full bg-muted flex items-center justify-center shrink-0 border border-border"
      style={{ width: size, height: size }}
    >
      <Bot className="text-muted-foreground" style={{ width: size * 0.5, height: size * 0.5 }} />
    </div>
  );
}
function ProfileCardContent({ address }: { address: string }) {
  const { data, isLoading } = useQuery<ProfileData>({
    queryKey: ["profile", address],
    queryFn: () => fetch(`/api/profiles/${address}`).then((r) => r.json()),
    staleTime: 60_000,
  });
  if (isLoading) {
    return (
      <div className="p-3 space-y-2 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-muted" />
          <div className="space-y-1 flex-1">
            <div className="h-3 bg-muted rounded w-24" />
            <div className="h-2.5 bg-muted rounded w-32" />
          </div>
        </div>
        <div className="h-2.5 bg-muted rounded w-full" />
        <div className="h-2.5 bg-muted rounded w-2/3" />
      </div>
    );
  }
  const profile = data?.profile;
  const stats = data?.stats;
  const displayName = profile?.displayName || profile?.username || truncateAddress(address, 6);
  const avatarUrl = profile?.avatarUrl;
  return (
    <div className="p-3 w-64">
      {/* Header */}
      <div className="flex items-start gap-2.5 mb-2">
        {avatarUrl ? (
          <RuntimeImage
            src={avatarUrl}
            alt={displayName}
            className="h-9 w-9 rounded-full object-cover border border-border shrink-0"
          />
        ) : (
          <DefaultAvatar size={36} />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">{displayName}</p>
          {profile?.username && (
            <p className="text-[10px] text-muted-foreground">@{profile.username}</p>
          )}
          <p className="text-[10px] text-muted-foreground font-mono">{truncateAddress(address, 8)}</p>
        </div>
      </div>
      {/* Bio */}
      {profile?.bio && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{profile.bio}</p>
      )}
      {/* Stats row */}
      <div className="flex items-center gap-3 mb-2.5 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Users className="h-3 w-3" />
          <span className="font-medium text-foreground">{profile?.followersCount ?? 0}</span>
          <span>followers</span>
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Cpu className="h-3 w-3" />
          <span className="font-medium text-foreground">{stats?.agentsCount ?? 0}</span>
          <span>agents</span>
        </span>
      </div>
      {/* Social links */}
      {(profile?.twitterUrl || profile?.githubUrl || profile?.websiteUrl) && (
        <div className="flex items-center gap-2 mb-2.5">
          {profile.twitterUrl && (
            <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" title="Twitter / X">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
            </a>
          )}
          {profile.githubUrl && (
            <a href={profile.githubUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" title="GitHub">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>
            </a>
          )}
          {profile.websiteUrl && (
            <a href={profile.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" title="Website">
              <Globe className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}
      {/* View profile button */}
      <Button asChild size="sm" variant="outline" className="w-full h-7 text-xs gap-1">
        <Link href={`/profiles/${address}`}>
          View Profile
          <ExternalLink className="h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}
interface ProfileHoverCardProps {
  address: string;
  children: React.ReactNode;
  className?: string;
}
export function ProfileHoverCard({ address, children, className }: ProfileHoverCardProps) {
  const [open, setOpen] = useState(false);
  const [cardPos, setCardPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleOpen = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    openTimerRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const cardWidth = 256;
        const left = Math.min(rect.left + window.scrollX, window.innerWidth + window.scrollX - cardWidth - 8);
        setCardPos({ top: rect.bottom + window.scrollY + 4, left: Math.max(8, left) });
      }
      setOpen(true);
    }, 200);
  }, []);
  const scheduleClose = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpen(false), 150);
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);
  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        className={className}
      >
        {children}
      </span>
      {open && (
        <div
          ref={cardRef}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ position: "absolute", top: cardPos.top, left: cardPos.left, zIndex: 9999 }}
          className="rounded-xl border border-border bg-card shadow-xl shadow-black/30 overflow-hidden"
        >
          <ProfileCardContent address={address} />
        </div>
      )}
    </>
  );
}
