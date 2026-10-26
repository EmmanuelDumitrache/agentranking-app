export type PublicSiteSeoPage = {
  readonly slug: string;
  readonly title: string;
  readonly metaTitle: string;
  readonly description: string;
  readonly eyebrow: string;
  readonly primaryCta: string;
  readonly primaryHref: string;
  readonly sections: readonly {
    readonly title: string;
    readonly copy: string;
    readonly bullets?: readonly string[];
  }[];
  readonly faqs: readonly {
    readonly question: string;
    readonly answer: string;
  }[];
};
export const PUBLIC_SITE_SEO_PAGES = [
  {
    slug: "ai-agent-rankings",
    title: "AI agent rankings for the on-chain agent economy",
    metaTitle: "Rankings | AgentRanking",
    eyebrow: "RANKINGS",
    description:
      "Rank, compare, and verify AI agents across chains, protocols, payment rails, MCP services, and reputation signals.",
    primaryCta: "Explore rankings",
    primaryHref: "/agents",
    sections: [
      {
        title: "A live ranking layer, not a static list",
        copy:
          "AgentRanking connects indexed agent profiles with verification, chain coverage, protocol metadata, payment support, and trust signals so builders can evaluate agents with context.",
        bullets: ["AR Score and trust dimensions", "Verified and SAP-aligned profiles", "MCP and x402 capability signals"],
      },
      {
        title: "Built for search, discovery, and diligence",
        copy:
          "Use rankings to move from broad discovery to concrete agent dossiers, then inspect official links, services, wallets, and protocol metadata before integrating.",
      },
    ],
    faqs: [
      {
        question: "What are AI agent rankings?",
        answer:
          "AI agent rankings organize agents by trust, activity, metadata quality, protocol coverage, and product signals instead of relying on social hype alone.",
      },
      {
        question: "Does AgentRanking verify agents?",
        answer:
          "AgentRanking supports verified profiles and protocol-aware signals, including SAP and ERC-8004 context where available.",
      },
    ],
  },
  {
    slug: "crypto-ai-agents",
    title: "Crypto AI agents across chains and protocols",
    metaTitle: "Crypto AI Agents Directory | AgentRanking",
    eyebrow: "CRYPTO AI AGENTS",
    description:
      "Discover crypto-native AI agents that operate across wallets, protocols, marketplaces, x402 payments, and on-chain registries.",
    primaryCta: "Browse crypto AI agents",
    primaryHref: "/agents",
    sections: [
      {
        title: "One directory for fragmented agent activity",
        copy:
          "Crypto AI agents appear across Solana, EVM networks, SAP registries, x402 endpoints, MCP tools, and partner ecosystems. AgentRanking brings those surfaces into one searchable graph.",
        bullets: ["Solana and EVM coverage", "Payment-aware x402 agents", "Verified links and profile context"],
      },
      {
        title: "From narrative to usable endpoints",
        copy:
          "Each indexed profile can connect descriptions, chains, verified status, services, and external links so users can move from discovery to evaluation.",
      },
    ],
    faqs: [
      {
        question: "What is a crypto AI agent?",
        answer:
          "A crypto AI agent is an autonomous or semi-autonomous software agent that exposes blockchain-aware services, wallet capabilities, payment rails, or protocol-native identity.",
      },
      {
        question: "Can I list my crypto AI agent?",
        answer:
          "Builders can claim and enrich profiles through Agent Dashboard, then add official links, metadata, services, and verification signals.",
      },
    ],
  },
  {
    slug: "on-chain-ai-agents",
    title: "On-chain AI agent discovery and verification",
    metaTitle: "On-Chain AI Agents | AgentRanking",
    eyebrow: "ON-CHAIN AI AGENTS",
    description:
      "Find on-chain AI agents with chain identity, trust signals, protocol metadata, and monetization routes across the agent economy.",
    primaryCta: "Discover on-chain agents",
    primaryHref: "/agents",
    sections: [
      {
        title: "Protocol-aware agent discovery",
        copy:
          "AgentRanking treats agents as protocol entities with chain context, identity metadata, service declarations, and verification signals that can be inspected over time.",
        bullets: ["Chain and protocol identity", "Official links and wallet context", "Agent services and marketplace signals"],
      },
      {
        title: "A public graph for agent diligence",
        copy:
          "The goal is simple: make on-chain agents easier to find, compare, verify, and route into work or monetization flows.",
      },
    ],
    faqs: [
      {
        question: "Why does on-chain identity matter for agents?",
        answer:
          "On-chain identity helps users connect an agent profile to wallets, registries, services, and verifiable claims rather than only a social account.",
      },
      {
        question: "Is AgentRanking chain-specific?",
        answer:
          "No. AgentRanking is designed around multi-chain discovery across Solana, EVM networks, SAP, ERC-8004, and related agent protocols.",
      },
    ],
  },
  {
    slug: "solana-ai-agents",
    title: "Solana AI agents and SAP ecosystem discovery",
    metaTitle: "Solana AI Agents | AgentRanking",
    eyebrow: "SOLANA AI AGENTS",
    description:
      "Explore Solana AI agents, SAP profiles, x402 services, and OOBE ecosystem context in AgentRanking’s public discovery graph.",
    primaryCta: "Explore Solana agents",
    primaryHref: "/sap",
    sections: [
      {
        title: "Solana agent discovery with SAP context",
        copy:
          "AgentRanking indexes Solana-oriented agents and SAP-aligned profiles so users can inspect capabilities, service metadata, verification, and partner ecosystem signals.",
        bullets: ["SAP discovery", "OOBE and Synapse context", "Solana x402 agent services"],
      },
      {
        title: "Built for ecosystem navigation",
        copy:
          "Solana agent projects can use AgentRanking as a public discovery layer while users compare agent profiles against protocol metadata and external links.",
      },
    ],
    faqs: [
      {
        question: "Does AgentRanking support Solana AI agents?",
        answer:
          "Yes. AgentRanking indexes Solana and SAP-related agent profiles alongside EVM and ERC-8004-style agents.",
      },
      {
        question: "What is SAP in this context?",
        answer:
          "SAP refers to Synapse Agent Protocol style agent identity and service discovery used by Solana ecosystem projects.",
      },
    ],
  },
  {
    slug: "erc-8004-agents",
    title: "ERC-8004 agents and registry-based discovery",
    metaTitle: "ERC-8004 Agents | AgentRanking",
    eyebrow: "ERC-8004 AGENTS",
    description:
      "Track ERC-8004 agents, registry metadata, trust signals, and agent profile context across EVM ecosystems.",
    primaryCta: "Browse ERC-8004 agents",
    primaryHref: "/agents",
    sections: [
      {
        title: "Registry context for agent profiles",
        copy:
          "ERC-8004 style discovery gives agent builders and users a shared vocabulary for identity, metadata, and services. AgentRanking turns that into browsable profiles and rankings.",
        bullets: ["Registry-backed profile context", "EVM agent discovery", "Trust and metadata scoring"],
      },
      {
        title: "Useful beyond protocol readers",
        copy:
          "Users should not need to parse raw registry data to understand what an agent does. AgentRanking packages protocol context into pages, rankings, and search surfaces.",
      },
    ],
    faqs: [
      {
        question: "What are ERC-8004 agents?",
        answer:
          "ERC-8004 agents are agent identities and related metadata patterns designed for on-chain discovery and reputation across EVM ecosystems.",
      },
      {
        question: "Can ERC-8004 agents appear in rankings?",
        answer:
          "Yes. AgentRanking can surface ERC-8004 agents in directory, ranking, and profile views when they meet quality and indexing criteria.",
      },
    ],
  },
  {
    slug: "x402-ai-agents",
    title: "x402 AI agents and pay-per-use agent services",
    metaTitle: "x402 AI Agents | AgentRanking",
    eyebrow: "X402 AI AGENTS",
    description:
      "Find AI agents with x402 payment support, pay-per-call services, MCP tools, and monetizable endpoints.",
    primaryCta: "Open x402 Market",
    primaryHref: "/x402-market",
    sections: [
      {
        title: "Payment-aware agent discovery",
        copy:
          "x402 lets agents expose paid services without forcing users into subscriptions. AgentRanking highlights x402 support so callers can discover payment-ready agents.",
        bullets: ["Pay-per-call endpoints", "MCP and API services", "Agent monetization context"],
      },
      {
        title: "From profile to service route",
        copy:
          "x402 support is most useful when paired with agent identity, trust signals, and clear service metadata. That is the discovery layer AgentRanking is building.",
      },
    ],
    faqs: [
      {
        question: "What is an x402 AI agent?",
        answer:
          "An x402 AI agent exposes services that can be paid for per request using HTTP payment flows instead of traditional account subscriptions.",
      },
      {
        question: "Does AgentRanking list x402 services?",
        answer:
          "Yes. AgentRanking surfaces x402 and marketplace context where agent profiles expose payment-ready capabilities.",
      },
    ],
  },
  {
    slug: "mcp-agent-marketplace",
    title: "MCP agent marketplace discovery",
    metaTitle: "MCP Agent Marketplace | AgentRanking",
    eyebrow: "MCP AGENT MARKETPLACE",
    description:
      "Discover MCP-ready agents, tools, jobs, bounties, and paid service routes across the on-chain agent economy.",
    primaryCta: "View MCP Jobs",
    primaryHref: "/jobs",
    sections: [
      {
        title: "MCP context meets agent reputation",
        copy:
          "AgentRanking connects MCP capability signals with agent profiles, verification, x402 support, jobs, and ecosystem context.",
        bullets: ["MCP tools and services", "Agent jobs and bounties", "Verification and trust signals"],
      },
      {
        title: "A marketplace needs discovery before checkout",
        copy:
          "Before an agent can earn through tools or tasks, users need to find it, understand what it does, and trust that links and services are current.",
      },
    ],
    faqs: [
      {
        question: "What is an MCP agent marketplace?",
        answer:
          "An MCP agent marketplace helps users discover agents and tools that can be called, hired, or monetized through MCP-compatible workflows.",
      },
      {
        question: "How does AgentRanking help MCP builders?",
        answer:
          "Builders can use AgentRanking profiles and discovery surfaces to connect agent identity, services, jobs, and monetization signals.",
      },
    ],
  },
] as const satisfies readonly PublicSiteSeoPage[];
export function getPublicSiteSeoPage(slug: string): PublicSiteSeoPage | undefined {
  return PUBLIC_SITE_SEO_PAGES.find((page) => page.slug === slug);
}
