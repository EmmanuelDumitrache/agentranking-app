"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Eye,
  EyeOff,
  HelpCircle,
  LogOut,
  Send,
  Settings,
} from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { buildSignOutCallbackUrl } from "@/lib/app-auth-routes";
import type { DashboardAgentSummary } from "@/lib/dashboard/types";
import type { AppAccountSummary } from "@/lib/app-account-summary";
import {
  parseDashboardAgentDbIdFromPath,
} from "@/lib/dashboard/navigation";
import {
  agentSwitchHref,
  resolveActiveAgentDbId,
  writeStoredAgentId,
} from "@/lib/dashboard/active-agent";
import { useStoredAgentId } from "@/hooks/use-stored-agent-id";
import { DashboardAgentAddMenu } from "@/components/dashboard/agent-add-menu";
import { DashboardWorkspaceNav } from "@/components/dashboard/dashboard-workspace-nav";
import { DashboardDevBuildBadge } from "@/components/dashboard/dashboard-nav-preview-access";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { AgentRankingWordmark } from "@/components/layout/agent-ranking-wordmark";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { RegisteredTick } from "@/components/shared/registered-badge";
import { isDashboardAgentVerified } from "@/lib/dashboard/agent-verification-display";
import { isDashboardAgentSolanaRegistered } from "@/lib/dashboard/agent-registration-display";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { showToast } from "@/components/ui/toast-simple";
import { WhatsNewButton } from "@/components/dashboard/whats-new-button";
import { AccountProfileDialog } from "@/components/dashboard/account-profile-dialog";
import { useSourceDraft } from "@/hooks/use-source-draft";
const SIDEBAR_NAME_PRIVACY_KEY = "dashboard:hide-account-name";
type Props = {
  readonly ownedAgents: DashboardAgentSummary[];
  readonly selectedAgentDbId: number | null;
  readonly maxAgents?: number;
  readonly accountSummary: Pick<AppAccountSummary, "displayName" | "avatarUrl">;
  readonly accountIsVerified: boolean;
  readonly onAgentSwitch?: (agent: Pick<DashboardAgentSummary, "id" | "name">) => void;
};
export function DashboardSidebar({ ownedAgents, selectedAgentDbId, maxAgents = 3, accountSummary, accountIsVerified, onAgentSwitch }: Props) {
  const initialDisplayName = accountSummary?.displayName ?? "Account";
  const pathname = usePathname() ?? "";
  const pathAgentId = parseDashboardAgentDbIdFromPath(pathname);
  const storedAgentId = useStoredAgentId(ownedAgents);
  const { data: session } = useSession();
  const isDeveloper = session?.user?.isDeveloper === true;
  const [guideOpen, setGuideOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [displayName, setDisplayName] = useSourceDraft(
    initialDisplayName,
    initialDisplayName,
  );
  const initialAvatarUrl =
    accountSummary.avatarUrl ?? session?.user?.image ?? null;
  const [avatarUrl, setAvatarUrl] = useSourceDraft(
    initialAvatarUrl,
    initialAvatarUrl,
  );
  const [nameHidden, setNameHidden] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setNameHidden(localStorage.getItem(SIDEBAR_NAME_PRIVACY_KEY) === "1");
      } catch {
        // Privacy mode still works for this session when storage is unavailable.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const toggleNamePrivacy = useCallback(() => {
    const next = !nameHidden;
    setNameHidden(next);
    try {
      localStorage.setItem(SIDEBAR_NAME_PRIVACY_KEY, next ? "1" : "0");
    } catch {
      // Keep the in-memory setting when storage is unavailable.
    }
    showToast(next ? "Account name hidden." : "Account name visible.", "info");
  }, [nameHidden]);
  useEffect(() => {
    if (pathAgentId != null) {
      writeStoredAgentId(pathAgentId);
    }
  }, [pathAgentId]);
  // URL → last selected → SSR fallback. Never let a stale SSR id beat localStorage
  // on account pages (Settings) or soft navigations.
  const activeAgentId = useMemo(
    () =>
      resolveActiveAgentDbId({
        pathAgentId,
        storedAgentId,
        selectedAgentDbId,
      }),
    [pathAgentId, storedAgentId, selectedAgentDbId],
  );
  return (
    <aside className="ui-sidebar ui-sidebar--docked ui-youtube-sidebar hidden w-[var(--app-sidebar-width,272px)] shrink-0 md:flex md:flex-col">
      <div className="ui-sidebar-header flex items-center gap-2">
        <Link href="/dashboard" className="inline-flex min-w-0 flex-1">
          <AgentRankingWordmark className="gap-2" iconClassName="h-7 w-7" textClassName="text-sm" />
        </Link>
        {isDeveloper ? <DashboardDevBuildBadge /> : null}
      </div>
      <div className="ui-sidebar-scroll flex min-h-0 flex-1 flex-col px-3 py-3">
        <div className="ui-youtube-sidebar-agents shrink-0 space-y-1">
          <div className="flex items-center justify-between pl-2">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                Agents
              </span>
              <span
                className={
                  ownedAgents.length >= maxAgents
                    ? "text-[10px] tabular-nums text-amber-500/90"
                    : "text-muted-foreground text-[10px] tabular-nums"
                }
              >
                {ownedAgents.length}/{maxAgents}
              </span>
            </div>
            <DashboardAgentAddMenu agentCount={ownedAgents.length} maxAgents={maxAgents} />
          </div>
          {ownedAgents.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1 text-xs leading-relaxed">
              No agents yet — tap <span className="text-foreground">+</span> to create one.
            </p>
          ) : (
            <div className="space-y-0.5">
              {ownedAgents.map((agent) => {
                const href = agentSwitchHref(pathname, agent.id);
                const selected = activeAgentId === agent.id;
                return (
                  <Link
                    key={agent.id}
                    href={href}
                    onClick={() => {
                      writeStoredAgentId(agent.id);
                      if (activeAgentId === agent.id) return;
                      onAgentSwitch?.(agent);
                      showToast(`Switched to ${agent.name}`, "info");
                    }}
                    className={cn(
                      "ui-youtube-agent-row flex items-center gap-3 text-sm",
                      selected
                        ? "ui-youtube-agent-row--active text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-current={selected ? "page" : undefined}
                  >
                    <AgentAvatar image={agent.image} name={agent.name} size="sm" className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-medium text-[13px]">{agent.name}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {isDashboardAgentVerified(agent, accountIsVerified) ? (
                        <VerifiedTick size="sm" />
                      ) : null}
                      {isDashboardAgentSolanaRegistered(agent) ? (
                        <RegisteredTick size="sm" />
                      ) : null}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <nav className="ui-youtube-sidebar-nav mt-3 space-y-0.5" aria-label="Workspace">
          <DashboardWorkspaceNav
            activeAgentId={activeAgentId}
            pathname={pathname}
            isDeveloper={isDeveloper}
          />
        </nav>
        {/* Guide me + What's new — pinned above the footer */}
        <div className="ui-youtube-sidebar-utilities mt-auto flex flex-row flex-wrap items-center justify-center gap-1 pb-2">
          <WhatsNewButton />
          <Popover open={guideOpen} onOpenChange={setGuideOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Guide me
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="center" className="w-64 p-4">
              <p className="text-sm font-medium">Creator workspace</p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Create an agent, launch a token on Solana and other chains, and
                earn creator fees. Fund your agent wallet, verify your identity,
                and track performance from this dashboard.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        {/* Footer — account, social links, logout */}
        <div className="ui-youtube-sidebar-footer pt-2">
          {/* Account row */}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <AgentAvatar
              image={avatarUrl}
              name={nameHidden ? "Account" : displayName}
              size="sm"
              className="shrink-0"
            />
            <span
              className="min-w-0 flex-1 truncate text-[13px] font-medium"
              aria-label={nameHidden ? "Account name hidden" : undefined}
            >
              {nameHidden ? "••••••••" : displayName}
            </span>
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={toggleNamePrivacy}
              aria-label={nameHidden ? "Show account name" : "Hide account name"}
              title={nameHidden ? "Show account name" : "Hide account name"}
            >
              {nameHidden ? (
                <EyeOff className="size-3.5" aria-hidden />
              ) : (
                <Eye className="size-3.5" aria-hidden />
              )}
            </button>
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setProfileOpen(true)}
              aria-label="Edit account profile"
              title="Edit account profile"
            >
              <Settings className="size-3.5" aria-hidden />
            </button>
          </div>
          {/* Social links */}
          <div className="flex items-center justify-between px-2 py-1">
            <a
              href="https://x.com/agentranking"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X / Twitter"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className="text-[15px] font-bold leading-none">𝕏</span>
            </a>
            <a
              href="https://t.me/agentranking"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Send className="h-3.5 w-3.5" />
            </a>
            <Link
              href="/docs"
              aria-label="Docs"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </Link>
          </div>
          {/* Logout */}
          <div className="border-t border-border/60 pt-2">
            <LogoutButton />
          </div>
        </div>
      </div>
      <AccountProfileDialog
        open={profileOpen}
        initialName={displayName}
        initialAvatar={avatarUrl}
        onOpenChange={setProfileOpen}
        onUpdated={(profile) => {
          setDisplayName(profile.displayName);
          setAvatarUrl(profile.avatarUrl || null);
        }}
      />
    </aside>
  );
}
function LogoutButton() {
  const handleLogout = useCallback(() => {
    signOut({ callbackUrl: buildSignOutCallbackUrl("/auth/login") });
  }, []);
  return (
    <button
      onClick={handleLogout}
      className="ui-nav-link w-full text-left"
      type="button"
    >
      <LogOut className="ui-nav-icon" aria-hidden />
      <span>Log out</span>
    </button>
  );
}
