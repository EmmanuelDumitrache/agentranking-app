"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { McpFlowDiagram } from "@/components/public-site/mcp-flow-diagram";
import { CopyCommandButton } from "@/components/public-site/copy-command-button";
import { PUBLIC_MCP_TOOLS } from "@/lib/public-mcp/catalog";
import {
  PUBLIC_MCP_CANONICAL_ORIGIN,
  PUBLIC_MCP_SERVER_VERSION,
  publicMcpEndpointUrl,
} from "@/lib/public-mcp/config";
import { cn } from "@/lib/utils";
import styles from "@/components/public-site/public-feature-page.module.css";
import mcpStyles from "@/components/public-site/mcp-connector.module.css";

type ClientId = "claude" | "cursor" | "chatgpt" | "code";

const CLIENTS: readonly { id: ClientId; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "cursor", label: "Cursor" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "code", label: "Claude Code" },
];

const TOOL_GROUPS: readonly {
  readonly label: string;
  readonly names: readonly string[];
}[] = [
  { label: "Directory", names: ["search_agents", "get_agent", "get_top_agents"] },
  {
    label: "Trust",
    names: [
      "get_trust_scores",
      "get_agent_reputation",
      "get_verified_status",
      "get_agent_risk",
      "get_agent_passport",
      "check_card_eligibility",
    ],
  },
  { label: "Identity", names: ["get_agent_credential", "get_fairscale_assessment"] },
];

function cursorConfig(endpoint: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        agentranking: {
          url: endpoint,
        },
      },
    },
    null,
    2,
  );
}

function clientSteps(client: ClientId, endpoint: string, cursorJson: string) {
  switch (client) {
    case "claude":
      return (
        <ol className="m-0 space-y-0 p-0">
          {[
            "Copy the connector URL.",
            "Open Claude → Customize → Connectors (Settings → Connectors on some accounts) → Add custom connector.",
            "Paste the URL. These tools are public — there is no login step yet.",
            "In a chat, click + near the message box, open Connectors, and switch AgentRanking on.",
          ].map((text, index) => (
            <li
              key={text}
              className="flex gap-4 border-b border-white/[0.07] py-3.5 last:border-b-0"
            >
              <span className="font-mono text-[11px] font-semibold text-white/35">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="text-[13px] leading-relaxed text-white/75">{text}</span>
            </li>
          ))}
        </ol>
      );
    case "cursor":
      return (
        <div className="space-y-3">
          <p className="m-0 text-[13px] leading-relaxed text-white/70">
            Cursor Settings → MCP, or merge this into ~/.cursor/mcp.json, then reload MCP.
          </p>
          <pre className="overflow-x-auto rounded-xl border border-white/[0.08] bg-black/40 p-3.5 font-mono text-[11px] leading-relaxed text-white/80">
            {cursorJson}
          </pre>
          <CopyCommandButton value={cursorJson} label="Copy JSON" />
        </div>
      );
    case "chatgpt":
      return (
        <ol className="m-0 space-y-0 p-0">
          {[
            "Copy the connector URL.",
            "In ChatGPT, open Settings → Apps / Connectors and add a custom MCP server.",
            "Paste the URL. Enable AgentRanking when you want registry tools in that chat.",
          ].map((text, index) => (
            <li
              key={text}
              className="flex gap-4 border-b border-white/[0.07] py-3.5 last:border-b-0"
            >
              <span className="font-mono text-[11px] font-semibold text-white/35">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="text-[13px] leading-relaxed text-white/75">{text}</span>
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <div className="space-y-3">
          <p className="m-0 text-[13px] leading-relaxed text-white/70">Claude Code:</p>
          <pre className="overflow-x-auto rounded-xl border border-white/[0.08] bg-black/40 p-3.5 font-mono text-[11px] text-white/80">
            {`claude mcp add --transport http agentranking ${endpoint}`}
          </pre>
          <p className="m-0 text-[13px] leading-relaxed text-white/55">
            VS Code uses the same JSON as Cursor in your user MCP config.
          </p>
          <Link
            href="/docs/mcp"
            className="inline-flex items-center gap-1 text-[12px] text-white/50 no-underline hover:text-white"
          >
            Longer docs
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      );
    default: {
      const exhaustive: never = client;
      return exhaustive;
    }
  }
}

export function McpConnectorPage({ origin }: { readonly origin: string }) {
  const endpoint = publicMcpEndpointUrl(origin);
  const liveEndpoint = publicMcpEndpointUrl(PUBLIC_MCP_CANONICAL_ORIGIN);
  const showingLocal = endpoint !== liveEndpoint;
  const [client, setClient] = useState<ClientId>("claude");
  const cursorJson = cursorConfig(endpoint);
  return (
    <div className={cn("relative -mx-4 pb-16 sm:-mx-6 md:pb-20", mcpStyles.page)}>
      <section className="relative overflow-hidden px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-10 md:pt-12">
        <div
          className={cn(mcpStyles.heroGlow, styles.heroGradientDrift)}
          aria-hidden
        />
        <div className={mcpStyles.gridMask} aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="landing-v3-eyebrow">MCP connector</p>
            <h1 className="landing-v3-h2 mt-3 max-w-[18ch]">
              One URL. Ranked agents in your AI client.
            </h1>
            <p className="landing-v3-lead">
              Paste AgentRanking into Claude, Cursor, ChatGPT, or Claude Code. The model searches
              the registry, reads trust, FairScale, and public AR credentials. No API key.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-white/45">
              <span className="font-mono tabular-nums text-white/80">{PUBLIC_MCP_TOOLS.length} tools</span>
              <span aria-hidden>·</span>
              <span>0 resources</span>
              <span aria-hidden>·</span>
              <span>0 prompts</span>
              <span aria-hidden>·</span>
              <span>catalog v{PUBLIC_MCP_SERVER_VERSION}</span>
            </div>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <CopyCommandButton value={endpoint} label="Copy connector URL" primary />
              <Link href="/docs/mcp" className="landing-v3-btn-ghost no-underline">
                Read the docs
              </Link>
            </div>
          </div>
          <McpFlowDiagram />
        </div>
      </section>

      <div className="relative mx-auto max-w-6xl space-y-10 px-4 sm:px-6">
        <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
          <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                Connector URL
              </p>
              <p className="mt-1 m-0 font-mono text-[13px] text-white/90 break-all">{endpoint}</p>
            </div>
            <CopyCommandButton value={endpoint} label="Copy" />
          </div>
          <p className="m-0 px-4 py-3 text-[11px] text-white/40 sm:px-5">
            Streamable HTTP · public read tools · no sign-in
            {showingLocal ? ` · live is ${liveEndpoint}` : null}
          </p>
        </section>

        <section>
          <p className="landing-v3-eyebrow mb-3">Install</p>
          <div className="flex flex-wrap gap-1.5">
            {CLIENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[13px] font-medium tracking-tight transition-colors",
                  client === item.id
                    ? "bg-foreground text-background"
                    : "text-white/45 hover:text-white",
                )}
                onClick={() => setClient(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 sm:px-5">
            {clientSteps(client, endpoint, cursorJson)}
          </div>
        </section>

        <section>
          <p className="landing-v3-eyebrow mb-2">Tool catalog</p>
          <h2 className="m-0 text-[22px] font-semibold tracking-tight text-white">
            What the URL actually exposes
          </h2>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {TOOL_GROUPS.map((group) => (
              <div
                key={group.label}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4"
              >
                <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  {group.label}
                </p>
                <ul className="mt-3 m-0 space-y-2 p-0">
                  {group.names.map((name) => {
                    const tool = PUBLIC_MCP_TOOLS.find((item) => item.name === name);
                    return (
                      <li key={name} className="border-t border-white/[0.06] pt-2 first:border-t-0 first:pt-0">
                        <code className="font-mono text-[11px] text-white/90">{name}</code>
                        {tool ? (
                          <p className="mt-1 m-0 text-[11px] leading-snug text-white/45">
                            {tool.description}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          {[
            ["No key to copy", "Public registry tools. You do not paste an API key."],
            ["Public data only", "Search, trust, FairScale, AR credentials. No send, no launch, no login yet."],
            ["Same as the site", "Rankings and verification flags match agentranking.io. No PII."],
          ].map(([title, copy]) => (
            <div key={title} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
              <p className="m-0 text-[13px] font-semibold text-white">{title}</p>
              <p className="mt-1.5 m-0 text-[12px] leading-relaxed text-white/50">{copy}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
