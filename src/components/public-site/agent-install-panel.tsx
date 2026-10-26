"use client";

import Link from "next/link";
import { CopyCommandButton } from "@/components/public-site/copy-command-button";
import { PublicSitePanel } from "@/components/public-site/public-site-ui";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import type { AgentInstallInfo } from "@/lib/public-site/agent-install-command";

type Props = {
  readonly install: AgentInstallInfo;
};

export function AgentInstallPanel({ install }: Props) {
  const ready = install.readiness === "mcp_ready" && Boolean(install.endpoint);

  return (
    <PublicSitePanel className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Install
      </h3>
      {ready ? (
        <>
          <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/20">
            <div className="flex items-start gap-2 p-3">
              <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-foreground/90">
                {install.claudeCommand}
              </pre>
              <CopyCommandButton
                value={install.claudeCommand}
                label="Copy"
                className="shrink-0"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Add this agent&apos;s MCP server to Cursor or Claude Code.
          </p>
          <CopyCommandButton
            value={install.cursorJson}
            label="Copy Cursor JSON"
            primary
            className="w-full justify-center"
          />
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            No installable MCP endpoint was found on this profile.
          </p>
          <p className="text-xs text-muted-foreground">
            You can still connect AgentRanking&apos;s directory MCP to search and compare agents.
          </p>
          <Link href={publicSiteRoutes.mcp} className="ui-public-site-accent text-xs font-semibold">
            Open AgentRanking MCP →
          </Link>
        </>
      )}
    </PublicSitePanel>
  );
}
