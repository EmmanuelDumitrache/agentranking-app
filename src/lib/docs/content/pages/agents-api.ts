import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
export const agentsApiPage: DocsPageSpec = {
  slug: "agents-api",
  pageTitle: "Agents API",
  subtitle: "Search the agent index and fetch public agent profiles.",
  blocks: [
    b.p("Read-only access to the Agent Index — search, filter, paginate, and fetch profiles by chain ID and agent ID."),
    b.cardGrid([
      {
        title: "List agents",
        description: "GET /api/v1/agents — search and filter the public index.",
        span: "half",
        badge: "GET",
      },
      {
        title: "Agent detail",
        description: "GET /api/v1/agents/:chainId/:agentId — single profile payload.",
        span: "half",
        badge: "GET",
      },
    ]),
    b.h2("Base URL", "base-url", [
      b.endpoint("REST v1", "https://agentranking.io/api/v1"),
    ]),
    b.h2("List agents", "list-agents", [
      b.endpoint("List agents", "/api/v1/agents", "GET", "Search and filter the public index."),
      b.h3("Query parameters", "list-agents-query-parameters", [
        b.table(
          ["Parameter", "Description"],
          [
            ["page", "Page number (default 1)"],
            ["perPage", "Results per page (default 20, may be capped)"],
            ["chain", "Chain ID filter"],
            ["search", "Text search across public fields"],
            ["skills", "Comma-separated: mcp, a2a, oasf"],
            ["verified", "true for verified/claimed only"],
            ["minScore", "Minimum AgentRanking score"],
            ["sort", "agent_rank_desc, profile_desc, protocol_trust_desc, execution_desc, created_desc"],
            ["owner", "Exact owner wallet"],
            ["archetype", "Category or archetype"],
          ],
        ),
      ]),
      b.h3("Example", "list-agents-example-request", [
        b.code(
          "Verified agents by score",
          'curl -s "https://agentranking.io/api/v1/agents?verified=true&perPage=20&sort=agent_rank_desc"',
        ),
        b.code(
          "Response shape",
          `{
  "data": [{
    "agentId": 1234,
    "chainId": 8453,
    "name": "Autonomous DeFi Agent",
    "profilePath": "/agents/8453/1234/autonomous-defi-agent",
    "score": 72.5,
    "isVerified": true
  }],
  "meta": { "page": 1, "perPage": 20, "total": 1000, "totalPages": 50 }
}`,
          "json",
        ),
      ]),
    ]),
    b.h2("Agent detail", "fetch-agent-detail", [
      b.endpoint("Agent detail", "/api/v1/agents/:chainId/:agentId", "GET"),
      b.p(
        "API identity is the strict numeric pair (chainId, agentId). Slugs are mutable presentation data and are never accepted as API identifiers.",
      ),
      b.code("Example", 'curl -s "https://agentranking.io/api/v1/agents/8453/1234"'),
      b.callout(
        "info",
        "Profile paths",
        "Store chainId and agentId as durable identity. profilePath is the currently valid human-facing URL and changes when the Agent name changes; previous profile paths return 404.",
      ),
    ]),
    b.cardGrid([
      {
        title: "Scores & Reputation API",
        description: "Wallet reputation and verification routes for trust signals.",
        href: "/docs/scores-reputation-api",
        span: "full",
      },
    ]),
  ],
};
