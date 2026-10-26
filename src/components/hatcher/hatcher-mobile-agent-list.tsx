"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  MessageCircle,
  Radio,
  Server,
  User,
} from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { cn } from "@/lib/utils";
import { HATCHER_DISCOVERY_SCORE_LABEL } from "@/lib/hatcher/config";
import { hatcherProfilePath } from "@/lib/hatcher/paths";
import type { HatcherDashboardAgentRow } from "@/lib/hatcher/dashboard-types";
import { HATCHER_LOGO_SRC } from "@/lib/hatcher/urls";
function formatStatus(status: string | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "active" || s === "running") return "Active";
  if (s === "sleeping" || s === "dormant") return "Sleeping";
  return status ?? "—";
}
function statusDotClass(status: string | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "active" || s === "running") return "bg-emerald-400";
  return "bg-muted-foreground/50";
}
function MobileCta({
  href,
  label,
  icon: Icon,
}: {
  readonly href: string;
  readonly label: string;
  readonly icon: typeof ExternalLink;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600/90 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-emerald-500"
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </a>
  );
}
export function HatcherMobileAgentList({
  agents,
  emptyMessage = "No agents match your filters.",
}: {
  readonly agents: HatcherDashboardAgentRow[];
  readonly emptyMessage?: string;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (agents.length === 0) {
    return (
      <p className="md:hidden rounded-lg border border-border/60 bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }
  return (
    <ul className="md:hidden space-y-1.5">
      {agents.map((row) => {
        const snap = row.hatcher.hatcher;
        const href = hatcherProfilePath(row.agentId, row.name);
        const open = openId === row.id;
        const links = snap?.links;
        const passportOk =
          (snap?.passportSnapshot) != null &&
          typeof (snap?.passportSnapshot) === "object";
        const mcpOk =
          snap?.mcpManifestSnapshot != null &&
          typeof snap?.mcpManifestSnapshot === "object";
        const passportUrl = links?.passport;
        const mcpUrl = links?.mcpManifest;
        return (
          <li key={row.id} className="rounded-lg border border-emerald-500/20 bg-card/50 overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-2">
              <Link href={href} className="flex min-w-0 flex-1 items-center gap-2">
                <AgentAvatar image={row.image} name={row.name} size="sm" className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium leading-tight">
                    <span
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(snap?.status))}
                      aria-hidden
                    />
                    {row.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {formatStatus(snap?.status)} · {snap?.framework ?? "—"} · {snap?.messageCount ?? 0} msgs
                  </p>
                  {row.description?.trim() ? (
                    <p className="text-[10px] text-muted-foreground/80 line-clamp-2 mt-0.5 leading-snug">
                      {row.description.trim()}
                    </p>
                  ) : null}
                </div>
              </Link>
              <span className="shrink-0 text-[10px] font-semibold text-emerald-400 tabular-nums">
                {row.hatcher.partnerScore}
              </span>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : row.id)}
                className="shrink-0 p-1 text-muted-foreground"
                aria-expanded={open}
                aria-label={open ? "Collapse" : "Expand links"}
              >
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
            {open ? (
              <div className="border-t border-border/40 px-2 pb-2 pt-1.5 space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  {HATCHER_DISCOVERY_SCORE_LABEL}: {row.hatcher.partnerScore}/100
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {links?.profile ? (
                    <MobileCta href={links.profile} label="Open Profile" icon={User} />
                  ) : null}
                  {links?.chat ? (
                    <MobileCta href={links.chat} label="Open Chat" icon={MessageCircle} />
                  ) : null}
                  {links?.room ? <MobileCta href={links.room} label="Open Room" icon={Radio} /> : null}
                  {passportOk && passportUrl ? (
                    <MobileCta href={passportUrl} label="Passport JSON" icon={FileText} />
                  ) : null}
                  {mcpOk && mcpUrl ? (
                    <MobileCta href={mcpUrl} label="MCP Manifest" icon={Server} />
                  ) : null}
                  <Link
                    href={href}
                    className="inline-flex items-center justify-center rounded-md border border-emerald-500/40 px-2 py-1.5 text-[10px] font-medium text-emerald-400"
                  >
                    AgentRanking →
                  </Link>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
      <li className="flex items-center justify-center gap-1.5 py-2 opacity-60">
        <Image src={HATCHER_LOGO_SRC} alt="" width={14} height={14} className="h-3.5 w-3.5" unoptimized />
        <span className="text-[10px] text-muted-foreground">Hatcher Indexed · Partner source</span>
      </li>
    </ul>
  );
}
