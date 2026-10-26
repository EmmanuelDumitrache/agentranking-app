"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, HelpCircle, LogOut, Send, X } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { buildSignOutCallbackUrl } from "@/lib/app-auth-routes";
import type { DashboardAgentSummary } from "@/lib/dashboard/types";
import type { AppAccountSummary } from "@/lib/app-account-summary";
import { parseDashboardAgentDbIdFromPath } from "@/lib/dashboard/navigation";
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
import { VerifiedTick } from "@/components/shared/verified-badge";
import { RegisteredTick } from "@/components/shared/registered-badge";
import { isDashboardAgentVerified } from "@/lib/dashboard/agent-verification-display";
import { isDashboardAgentSolanaRegistered } from "@/lib/dashboard/agent-registration-display";
import { cn } from "@/lib/utils";
import { AgentRankingWordmark } from "@/components/layout/agent-ranking-wordmark";
import { showToast } from "@/components/ui/toast-simple";
import { WhatsNewButton } from "@/components/dashboard/whats-new-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Props = {
  readonly ownedAgents: DashboardAgentSummary[];
  readonly selectedAgentDbId: number | null;
  readonly maxAgents?: number;
  readonly accountSummary: AppAccountSummary;
  readonly accountIsVerified: boolean;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAgentSwitch?: (agent: Pick<DashboardAgentSummary, "id" | "name">) => void;
};

export function DashboardMobileNav({
  ownedAgents,
  selectedAgentDbId,
  maxAgents = 3,
  accountSummary,
  accountIsVerified,
  open,
  onClose,
  onAgentSwitch,
}: Props) {
  const pathname = usePathname() ?? "";
  const pathAgentId = parseDashboardAgentDbIdFromPath(pathname);
  const storedAgentId = useStoredAgentId(ownedAgents);
  const { data: session } = useSession();
  const isDeveloper = session?.user?.isDeveloper === true;
  const [guideOpen, setGuideOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const displayName = accountSummary?.displayName ?? "Account";

  useEffect(() => {
    if (pathAgentId != null) {
      writeStoredAgentId(pathAgentId);
    }
  }, [pathAgentId]);

  const activeAgentId = useMemo(
    () =>
      resolveActiveAgentDbId({
        pathAgentId,
        storedAgentId,
        selectedAgentDbId,
      }),
    [pathAgentId, storedAgentId, selectedAgentDbId],
  );

  const handleLogout = useCallback(() => {
    signOut({ callbackUrl: buildSignOutCallbackUrl("/auth/login") });
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ui-mobile-nav-drawer fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dashboard-mobile-nav-title"
    >
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="ui-mobile-nav-sheet fixed inset-y-0 left-0 z-50 flex w-[min(100vw-3rem,272px)] flex-col bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/dashboard" onClick={onClose}>
              <AgentRankingWordmark size="compact" />
            </Link>
            {isDeveloper ? <DashboardDevBuildBadge /> : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted/50"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p id="dashboard-mobile-nav-title" className="sr-only">
          Dashboard navigation
        </p>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between gap-2 px-2">
              <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                Agents
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={
                    ownedAgents.length >= maxAgents
                      ? "text-[11px] tabular-nums text-amber-500/90"
                      : "text-muted-foreground text-[11px] tabular-nums"
                  }
                >
                  {ownedAgents.length}/{maxAgents}
                </span>
                <DashboardAgentAddMenu
                  agentCount={ownedAgents.length}
                  maxAgents={maxAgents}
                  onNavigate={onClose}
                />
              </div>
            </div>
            {ownedAgents.map((agent) => {
              const href = agentSwitchHref(pathname, agent.id);
              const selected = activeAgentId === agent.id;
              return (
                <Link
                  key={agent.id}
                  href={href}
                  onClick={() => {
                    writeStoredAgentId(agent.id);
                    const switching = activeAgentId !== agent.id;
                    if (switching) {
                      onAgentSwitch?.(agent);
                      showToast(`Switched to ${agent.name}`, "info");
                    }
                    onClose();
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2 py-2.5 text-[15px] transition-colors",
                    selected
                      ? "bg-primary/10 text-foreground ring-1 ring-primary/20"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <AgentAvatar image={agent.image} name={agent.name} size="sm" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span>
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
          <nav className="space-y-1 border-t border-border/60 pt-3" aria-label="Workspace">
            <DashboardWorkspaceNav
              activeAgentId={activeAgentId}
              pathname={pathname}
              onNavigate={onClose}
              variant="mobile"
              isDeveloper={isDeveloper}
            />
          </nav>
        </div>
        <div className="flex flex-col items-center gap-2 border-t border-border/60 px-3 pb-2 pt-2">
          <WhatsNewButton side="top" />
          <Popover open={guideOpen} onOpenChange={setGuideOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Guide me
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-64 p-4">
              <p className="text-sm font-medium">Creator workspace</p>
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                Create an agent, launch a token, earn creator fees. Fund your agent wallet,
                verify identity, and track performance.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <div className="border-t border-border/60 p-3">
          <div className="mb-2 flex items-center gap-2 px-2 py-1.5">
            <AgentAvatar
              image={accountSummary.avatarUrl ?? session?.user?.image ?? null}
              name={displayName}
              size="sm"
              className="shrink-0"
            />
            <span className="truncate text-[13px] font-medium text-foreground">
              {displayName}
            </span>
          </div>
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
              onClick={onClose}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </Link>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-[15px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            type="button"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden />
            <span>Log out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
