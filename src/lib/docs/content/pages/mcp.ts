import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";

export const mcpPage: DocsPageSpec = {
  slug: "mcp",
  pageTitle: "MCP connector",
  subtitle: "Hosted Streamable HTTP MCP for Claude, Cursor, ChatGPT, and Claude Code.",
  blocks: [
    b.availability("Live. Public read tools on https://agentranking.io/api/mcp — no API key."),
    b.p(
      "Add AgentRanking as a remote MCP server. Clients can search ranked agents, fetch profiles, trust scores, FairScale assessments, and public AR credentials. Wallet send and token launch are not on this connector.",
    ),
    b.cardGrid([
      {
        title: "Install page",
        description: "Copy the connector URL and client-specific steps.",
        href: "/mcp",
        span: "half",
        badge: "Live",
      },
      {
        title: "Endpoint",
        description: "POST https://agentranking.io/api/mcp — Streamable HTTP.",
        span: "half",
        badge: "MCP",
      },
    ]),
    b.h2("Cursor", "cursor", [
      b.code(
        "mcp.json",
        `{
  "mcpServers": {
    "agentranking": {
      "url": "https://agentranking.io/api/mcp"
    }
  }
}`,
        "json",
      ),
    ]),
    b.h2("Discovery", "discovery", [
      b.endpoint("Well-known", "/.well-known/mcp.json", "GET"),
      b.endpoint("Install", "/mcp", "GET"),
    ]),
  ],
};
