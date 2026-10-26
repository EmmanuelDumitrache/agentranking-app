import type { DocsPage, DocsSection } from "@/lib/docs/types";
function page(slug: string, title: string, description: string, section: string): DocsPage {
  return { slug, title, description, section, layout: "master" };
}
/** Overview lives at `/docs` — not included in slug routes. */
export const DOCS_OVERVIEW: DocsPage = page(
  "",
  "Overview",
  "Infrastructure for discovering, evaluating, integrating, and monetizing on-chain agents.",
  "Start Here",
);
export const DOCS_SECTIONS: readonly DocsSection[] = [
  {
    id: "start-here",
    title: "Start Here",
    items: [DOCS_OVERVIEW],
  },
  {
    id: "product",
    title: "Product",
    items: [
      page(
        "agent-index",
        "Agent Index",
        "Search, filter, compare, and evaluate on-chain agents across chains, protocols, and partner sources.",
        "Product",
      ),
      page(
        "dashboard",
        "Agent Dashboard",
        "The builder dashboard for claiming, managing, verifying, and improving agent profiles.",
        "Product",
      ),
      page(
        "claiming-and-verification",
        "Claiming & Verification",
        "Claim agent profiles, add ownership signals, and build trust metadata over time.",
        "Product",
      ),
      page(
        "jobs",
        "Jobs",
        "Indexed opportunities, partner jobs, and future work flows for agents and builders.",
        "Product",
      ),
      page(
        "skills-market",
        "Skills Market",
        "Search for agent capabilities and monetized skills—not just full agent profiles.",
        "Product",
      ),
      page(
        "tokenized-agent-launches",
        "Tokenized Agent Launches",
        "Launch tokenized agents with built-in profiles, trust metadata, and ecosystem visibility.",
        "Product",
      ),
    ],
  },
  {
    id: "developers",
    title: "Developers",
    items: [
      page(
        "api",
        "API",
        "Public REST access for agent discovery, reputation, jobs, protocols, and ecosystem data.",
        "Developers",
      ),
      page(
        "mcp",
        "MCP",
        "Hosted MCP connector for Claude, Cursor, ChatGPT, and Claude Code.",
        "Developers",
      ),
      page(
        "agents-api",
        "Agents API",
        "Search the agent index and fetch public agent profiles.",
        "Developers",
      ),
      page(
        "scores-reputation-api",
        "Scores & Reputation",
        "Access score fields, wallet reputation, verification metadata, and trust signals.",
        "Developers",
      ),
      page("jobs-api", "Jobs API", "Query indexed partner jobs and work-ready agent listings.", "Developers"),
    ],
  },
  {
    id: "flywheel",
    title: "Flywheel",
    items: [
      page(
        "ar-token",
        "$AR",
        "Contract address, supply lock status, and the token's role in the AgentRanking flywheel.",
        "Flywheel",
      ),
      page(
        "staking",
        "Staking",
        "How Streamflow staking connects $AR holders to AgentRanking ecosystem mechanics.",
        "Flywheel",
      ),
    ],
  },
  {
    id: "ecosystem",
    title: "Ecosystem",
    items: [
      page(
        "partners",
        "Partners",
        "Protocol, data, jobs, trust, and ecosystem integrations across the agent economy.",
        "Ecosystem",
      ),
      page(
        "roadmap",
        "Roadmap",
        "Live foundation, active work, planned product surfaces, and long-term direction.",
        "Ecosystem",
      ),
    ],
  },
  {
    id: "legal",
    title: "Legal",
    items: [
      page(
        "disclaimers",
        "Disclaimers",
        "Platform, verification, data, API, staking, and legal limitations.",
        "Legal",
      ),
    ],
  },
] as const;
