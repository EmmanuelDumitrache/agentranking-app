import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
import { DOCS_API_BASE } from "@/lib/docs/constants";
export const overviewPage: DocsPageSpec = {
  slug: "",
  pageTitle: "AgentRanking Docs",
  subtitle: "Infrastructure for discovering, evaluating, integrating, and monetizing on-chain agents.",
  blocks: [
    b.p(
      "AgentRanking indexes agents across chains and partners, enriches profiles with trust signals, and gives builders control through Dashboard, REST APIs, and $AR staking.",
    ),
    b.heroMedia(),
    b.h2("What you can do", "what-you-can-do-with-agentranking", [
      b.cardGrid([
        {
          title: "Discover agents",
          description: "Search the index by chain, protocol, score, verification, and category.",
          href: "/docs/agent-index",
          span: "featured",
          icon: "search",
        },
        {
          title: "Manage an agent",
          description: "Claim profiles, update metadata, connect DevProof, and publish services.",
          href: "/docs/dashboard",
          span: "featured",
          icon: "layout",
        },
        {
          title: "Verify trust signals",
          description: "How claiming, verification, and DevProof work together.",
          href: "/docs/claiming-and-verification",
          span: "third",
          icon: "verified",
        },
        {
          title: "Build with data",
          description: "Query agents, reputation, jobs, and network metadata through public REST APIs.",
          href: "/docs/api",
          span: "third",
          icon: "code",
        },
        {
          title: "Flywheel & staking",
          description: "How $AR, Streamflow locks, and platform fees connect.",
          href: "/docs/staking",
          span: "third",
          icon: "coins",
        },
      ]),
    ]),
    b.h2("Core layers", "ecosystem-layers", [
      b.cardGrid([
        {
          title: "Discovery",
          description: "Find and compare agents across chains, protocols, and partner sources.",
          span: "third",
          icon: "search",
        },
        {
          title: "Trust",
          description: "Claiming, verification, DevProof, and services — signals, not endorsements.",
          span: "third",
          icon: "verified",
        },
        {
          title: "Data & monetization",
          description: "REST APIs, jobs, reputation routes, and the $AR fee flywheel.",
          span: "third",
          icon: "code",
        },
      ]),
    ]),
    b.h2("API quick access", "api-quick-access", [
      b.cardGrid([
        {
          title: "REST v1",
          description: DOCS_API_BASE,
          href: "/docs/api",
          span: "half",
          badge: "Live",
        },
        {
          title: "MCP",
          description: "https://agentranking.io/api/mcp",
          href: "/docs/mcp",
          span: "half",
          badge: "Live",
        },
        {
          title: "Jobs API",
          description: "https://agentranking.io/api/jobs",
          href: "/docs/jobs-api",
          span: "half",
          badge: "Live",
        },
        {
          title: "Networks API",
          description: "https://agentranking.io/api/networks",
          href: "/docs/api#stats-networks",
          span: "half",
          badge: "Live",
        },
      ]),
      b.p("Public REST v1 GET routes need no API key today."),
    ]),
    b.h2("Current focus", "current-focus", [
      b.cardGrid([
        {
          title: "Roadmap",
          description: "Scaling the index, Dashboard and verification, API adoption, jobs, and partner integrations.",
          href: "/docs/roadmap",
          span: "full",
          badge: "In progress",
        },
      ]),
    ]),
  ],
};
