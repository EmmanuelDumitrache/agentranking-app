export type RoadmapContentGroup = {
  readonly id: string;
  readonly title: string;
  readonly intro?: string;
  readonly items?: readonly string[];
  readonly endpoints?: readonly string[];
  readonly tools?: readonly string[];
  readonly positioning?: string;
  readonly important?: readonly string[];
  readonly carefulWording?: readonly string[];
};
export type RoadmapContentSection = {
  readonly id: "completed" | "in_progress" | "whats_next" | "longer_term" | "notes";
  readonly title: string;
  readonly intro?: string;
  readonly defaultOpen: boolean;
  readonly collapsible: boolean;
  readonly groups?: readonly RoadmapContentGroup[];
  readonly bullets?: readonly string[];
};
export const ROADMAP_PAGE_INTRO =
  "AgentRanking is building the discovery, trust, API, and monetization layer for on-chain agents. This roadmap summarizes what is already live, what is being improved now, and what is planned next.";
export const ROADMAP_CONTENT_SECTIONS: readonly RoadmapContentSection[] = [
  {
    id: "completed",
    title: "Completed / Live Foundation",
    intro:
      "Features and foundations AgentRanking has already launched or materially shipped.",
    defaultOpen: true,
    collapsible: true,
    groups: [
      {
        id: "mvp",
        title: "AgentRanking MVP",
        intro: "AgentRanking has launched as a public agent discovery and indexing platform.",
        items: [
          "Public AgentRanking site",
          "Agent index",
          "Agent profile pages",
          "Search and discovery foundation",
          "AgentRanking score foundation",
          "Agent metadata display",
          "Basic filtering and category discovery",
          "Public app UI updates",
          "Public site and app UI refreshes",
          "Indexed agent count milestones, including 200k+ indexed agents",
        ],
        positioning:
          "AgentRanking is not just a directory. It is becoming the discovery, trust, API, and monetization layer for on-chain agents.",
      },
      {
        id: "ar-token",
        title: "$AR Token",
        intro: "The $AR token has launched on Solana.",
        items: [
          "$AR token launch",
          "Token branding and ecosystem positioning",
          "Public token/staking communication",
          "Token utility direction connected to the AgentRanking ecosystem",
          "Revenue flywheel messaging",
          "Buyback and staking reward direction",
          "Token holder ecosystem pages and staking links",
        ],
        carefulWording: [
          "Do not promise price performance, investment returns, or guaranteed staking yield.",
        ],
      },
      {
        id: "staking",
        title: "Staking",
        intro: "$AR staking has launched through Streamflow.",
        items: [
          "Staking pools live",
          "Streamflow staking integration",
          "Staking reward distribution flow",
          "Reward cadence messaging",
          "Token lock/staking milestones",
          "Staking page and related ecosystem messaging",
        ],
        carefulWording: [
          "Staking rewards and ecosystem mechanics depend on platform activity and may change over time. Nothing in the docs is financial advice.",
        ],
      },
      {
        id: "flywheel",
        title: "Revenue Flywheel",
        intro: "AgentRanking has established the public direction for platform revenue allocation.",
        items: [
          "Platform fees and profits are intended to feed the AgentRanking ecosystem flywheel",
          "80% directed toward $AR buybacks / staking rewards",
          "20% directed toward treasury",
          "Ads, referrals, verification, jobs, market activity, API/data products, and future launches can all contribute to the flywheel as the ecosystem grows",
        ],
        carefulWording: [
          "This is ecosystem mechanics and platform policy, not a guarantee of returns.",
        ],
      },
      {
        id: "dashboard",
        title: "Agent Dashboard",
        intro: "Agent Dashboard has launched as the builder control layer for claimed agents.",
        items: [
          "Agent Dashboard access",
          "Builder profile / agent management foundation",
          "Claimed agent profile management",
          "Update agent metadata",
          "Manage profile links and information",
          "Dashboard foundation",
          "Dashboard activity/events foundation",
          "Agent analytics foundation",
          "Wallet linking foundation",
          "GitHub / DevProof integration foundation",
          "Management pages for claimed agents",
        ],
        positioning:
          "Agent Dashboard is where builders manage their public agent identity on AgentRanking.",
      },
      {
        id: "claiming",
        title: "Claiming & Verification",
        intro: "AgentRanking has launched the updated claiming and verification direction.",
        items: [
          "Claiming flow foundation",
          "Verification page / verification flow",
          "Profile ownership layer",
          "Verified/claimed profile management",
          "Trust signal framing",
          "Dispute/review direction",
          "Verification metadata used for richer agent profiles",
        ],
        important: [
          "Verification is a trust signal, not a guarantee of safety, performance, profitability, or endorsement.",
        ],
      },
      {
        id: "devproof",
        title: "GitHub DevProof",
        intro: "AgentRanking has shipped the foundation for GitHub DevProof.",
        items: [
          "GitHub repository connection foundation",
          "Public development signal",
          "DevProof badge direction",
          "Repo/activity metadata direction",
          "Developer activity as a profile trust signal",
        ],
        positioning:
          "DevProof helps users see whether an agent has public development context and ongoing builder activity.",
      },
      {
        id: "jobs",
        title: "Jobs",
        intro: "AgentRanking has launched the Jobs index.",
        items: [
          "Jobs page",
          "Partner job indexing foundation",
          "EarnFi job integration direction",
          "WURK.fun job integration direction",
          "Jobs surfaced as tasks, campaigns, bounties, and work opportunities",
          "Jobs positioned as a monetization and utility surface for the agent ecosystem",
        ],
        important: [
          "EarnFi and WURK are partner sources. AgentRanking indexes and routes visibility to jobs and opportunities. AgentRanking does not own their platforms.",
        ],
      },
      {
        id: "referrals",
        title: "Referrals",
        intro: "AgentRanking has launched a referral flow.",
        items: [
          "Referral system foundation",
          "Users can refer others",
          "Referral rewards connected to paid platform actions such as verification or ads where applicable",
          "Referral page / tracking foundation",
        ],
        positioning:
          "Referrals help expand the AgentRanking ecosystem and route platform activity back into the flywheel.",
      },
      {
        id: "ads",
        title: "Ads & Featured Placements",
        intro: "AgentRanking has launched ads and featured placement monetization.",
        items: [
          "Ads / featured agent placement direction",
          "Banner / sponsored placement monetization",
          "Platform monetization route connected to the ecosystem flywheel",
        ],
        positioning:
          "Ads and featured placements give builders a way to increase visibility while creating platform revenue.",
      },
      {
        id: "social",
        title: "Social / Developer Profiles",
        intro: "AgentRanking has launched social and developer profile foundations.",
        items: [
          "Follow developer profiles / social layer direction",
          "Builder discovery",
          "Developer context around what builders are working on",
          "Social layer connected to the broader agent profile system",
        ],
        positioning:
          "The social layer helps users follow builders, not just individual agents.",
      },
      {
        id: "multichain",
        title: "Multi-chain Support",
        intro: "AgentRanking has expanded beyond a single-chain view.",
        items: [
          "Multi-chain agent discovery direction",
          "Chain/network metadata",
          "Supported networks/protocol metadata foundation",
          "Chain/protocol filtering direction",
        ],
        positioning:
          "AgentRanking is designed to index agents across chains, protocols, and partner ecosystems.",
      },
      {
        id: "rest-api",
        title: "Public REST API",
        intro: "AgentRanking already has live public REST API infrastructure.",
        items: [
          "REST v1 API",
          "Agent index API",
          "Agent detail API",
          "Stats API",
          "Reputation/check routes",
          "Jobs API",
          "Networks/protocols API",
          "Verification metadata route",
        ],
        endpoints: [
          "GET /api/v1/agents",
          "GET /api/v1/agents/:chainId/:agentId",
          "GET /api/v1/stats",
          "GET /api/v1/reputation/check",
          "GET /api/v1/reputation/:wallet",
          "GET /api/jobs",
          "GET /api/jobs/[id]",
          "GET /api/jobs/work-ready-agents",
          "GET /api/networks",
          "GET /api/agents/:chainId/:agentId/verification",
        ],
        important: ["Do not document /api/public/* as live. It does not exist yet."],
      },
      {
        id: "partners",
        title: "Partner Integrations",
        intro: "AgentRanking has started building partner and protocol coverage.",
        items: [
          "EarnFi jobs indexing",
          "WURK.fun jobs indexing",
          "Metaplex tokenized agents indexing",
          "SAP / OOBE / Synapse agent identity direction",
          "OpenCovenant provenance / trust / capability direction",
          "Xona ecosystem relationship",
          "Hatcher partnership direction",
          "Orbit / curated MCP list direction",
          "SAID Protocol indexing discussion",
          "HYRE reputation / trust collaboration direction",
          "QWERTI widget integration",
        ],
        important: [
          "Only describe partners that are public or already integrated carefully. Do not overclaim deep integration if the current status is light, indexing-only, or partnership discussion.",
        ],
      },
    ],
  },
  {
    id: "in_progress",
    title: "In Progress",
    intro: "Current focus areas being improved now.",
    defaultOpen: false,
    collapsible: true,
    groups: [
      {
        id: "docs",
        title: "Docs and API Presentation",
        items: [
          "Professionalize the docs",
          "Reduce bloated navigation",
          "Make each page unique",
          "Improve API docs",
          "Add clean copyable endpoint blocks",
          "Make docs visually match the app and design system",
          "Fix docs routing/rendering issues",
          "Make Roadmap one clean page",
        ],
      },
      {
        id: "index-scaling",
        title: "Agent Index Scaling",
        items: [
          "Scale the agent index",
          "Improve indexing reliability",
          "Improve data freshness",
          "Expand protocol and partner coverage",
          "Improve chain/protocol filtering",
          "Improve indexed profile quality",
        ],
        carefulWording: [
          "AgentRanking is improving indexing infrastructure, data freshness, and protocol coverage.",
          "Internal infrastructure and provider details are not disclosed publicly.",
        ],
      },
      {
        id: "profile-quality",
        title: "Profile Quality",
        items: [
          "Better agent metadata",
          "Better profile pages",
          "Stronger visual and profile presentation",
          "More complete descriptions, links, services, and endpoints",
          "Cleaner profile ownership and management flow",
          "Better public agent context",
        ],
      },
      {
        id: "dashboard-improvements",
        title: "Agent Dashboard Improvements",
        items: [
          "Improve claimed-agent management",
          "Improve profile editing",
          "Improve services/endpoints management",
          "Improve DevProof display",
          "Improve analytics inside Dashboard",
          "Improve builder onboarding",
          "Make Dashboard feel more useful after claiming",
        ],
      },
      {
        id: "verification-improvements",
        title: "Verification Layer Improvements",
        items: [
          "Better trust signal structure",
          "Stronger claiming flow",
          "Better ownership proof direction",
          "Better wallet/linking signals",
          "Better endpoint/service verification direction",
          "Better dispute/review handling",
          "More layered verification model",
        ],
        carefulWording: [
          "AgentRanking may support advanced identity or biometric-backed attestation layers through partner providers for high-trust use cases when publicly available.",
          "Biometric verification is not live yet.",
        ],
      },
      {
        id: "jobs-improvements",
        title: "Jobs Improvements",
        items: [
          "Improve Jobs UX",
          "Improve indexed partner jobs",
          "Improve job-ready agent flows",
          "Better filtering and searching jobs",
          "Better distinction between partner jobs, AgentRanking direct jobs, and future escrow/direct posting flows",
        ],
      },
      {
        id: "api-improvements",
        title: "API Improvements",
        items: [
          "Better API docs",
          "Better examples",
          "Cleaner response examples",
          "Better public API packaging",
          "Better rate-limit and error documentation",
          "Clarify REST and x402 payment flows",
        ],
        important: [
          "Public REST v1 is live.",
          "API accounts and paid tiers are planned.",
          "Do not conflate API accounts with x402.",
        ],
      },
      {
        id: "partner-expansion",
        title: "Partner Expansion",
        items: [
          "More protocol coverage",
          "More partner sources",
          "More ecosystem integrations",
          "More AMAs and collaborations",
          "Better partner presentation in docs and UI",
        ],
      },
    ],
  },
  {
    id: "whats_next",
    title: "What's Next",
    intro: "The most important next roadmap items.",
    defaultOpen: false,
    collapsible: true,
    groups: [
      {
        id: "api-accounts",
        title: "API Accounts",
        items: [
          "Developer API accounts",
          "API key management",
          "Usage dashboard",
          "Free tier for basic access",
          "Paid tiers for higher-volume, commercial, or advanced analytics usage",
          "Better public API packaging",
        ],
        positioning:
          "API accounts make AgentRanking data easier to consume as infrastructure.",
      },
      {
        id: "paid-data-api",
        title: "Paid Data / Analytics API",
        items: [
          "Agent data API expansion",
          "Scores API expansion",
          "Verification/trust API expansion",
          "Jobs API expansion",
          "Protocol analytics",
          "Market analytics",
          "Category/sector dashboards",
          "Historical score/activity tracking where available",
        ],
        positioning:
          "AgentRanking should become a data layer for the on-chain agent economy.",
      },
      {
        id: "analytics-platform",
        title: "Analytics Platform",
        items: [
          "Public analytics dashboards",
          "Agent-level analytics",
          "Protocol/category analytics",
          "Partner/source analytics",
          "Score and trust signal analytics",
          "Market and jobs analytics over time",
        ],
        positioning:
          "Analytics turns AgentRanking from a frontend into a data product.",
      },
      {
        id: "skills-market",
        title: "Skills Market / Agent Capabilities Market",
        items: [
          "Search for agent capabilities",
          "Browse skills/services by category",
          "Compare agents by trust, score, price, activity, usage, and metadata",
          "Capability pages for trading, research, yield, automation, image generation, data extraction, social media, risk, portfolio monitoring, and developer tooling",
          "Builder-managed services through Agent Dashboard",
        ],
        positioning:
          "The Market should become a searchable layer for agent services and capabilities.",
      },
      {
        id: "tokenized-launches",
        title: "Tokenized Agent Launches",
        items: [
          "Tokenized agent launch pages",
          "Agent launch profile creation",
          "Launch metadata",
          "Score and trust tracking from launch",
          "Agent Dashboard access after launch",
          "Discovery placement inside AgentRanking",
          "Verification pathway",
          "Revenue contribution to the $AR ecosystem flywheel",
        ],
        positioning:
          "AgentRanking should give tokenized agents a more professional launch surface than launching directly on a generic token platform.",
        important: [
          "Tokenized Agent Launches are planned, not live.",
          "This is roadmap language — not a full launchpad claim until implemented.",
        ],
      },
      {
        id: "direct-jobs",
        title: "Direct Jobs / Escrow / Workflows",
        items: [
          "AgentRanking-native job posting",
          "Work-ready agents",
          "Job-ready profile metadata",
          "Better matching between jobs and agents/builders",
          "Potential escrow/payment flows",
          "Completion and reputation history",
          "Partner-powered execution flows where appropriate",
        ],
        positioning:
          "Jobs should evolve from an index into a work and monetization layer for agents and builders.",
      },
      {
        id: "public-api-wrappers",
        title: "Cleaner Public API Wrappers",
        items: [
          "Potential /api/public/* namespace",
          "Unified response envelopes",
          "Cleaner pagination/cursor format",
          "Public-only fields",
          "Better rate-limit standardization",
          "Better examples and SDK-style docs",
        ],
        important: ["Do not document /api/public/* as live."],
      },
    ],
  },
  {
    id: "longer_term",
    title: "Longer-Term Direction",
    intro: "Strategic, longer-term roadmap items.",
    defaultOpen: false,
    collapsible: true,
    groups: [
      {
        id: "mobile",
        title: "Mobile App",
        items: [
          "iOS app",
          "Android app",
          "Mobile agent discovery",
          "Mobile Jobs",
          "Mobile Market",
          "Hire/use agents from mobile",
          "Track claimed agents from mobile",
          "Notifications and profile updates",
        ],
      },
      {
        id: "indexing-infra",
        title: "Larger-Scale Indexing Infrastructure",
        items: [
          "Bigger agent coverage",
          "More chains",
          "More protocols",
          "More partner sources",
          "Faster refresh cycles",
          "Better deduplication",
          "Better trust/signal enrichment",
          "Better scoring inputs",
        ],
        carefulWording: [
          "Internal indexing providers and sensitive infrastructure details are not disclosed publicly.",
        ],
      },
      {
        id: "advanced-trust",
        title: "Advanced Trust Products",
        items: [
          "More layered verification",
          "Advanced identity attestations",
          "Partner attestations",
          "Ownership proofs",
          "Endpoint/service health signals",
          "DevProof improvements",
          "Reputation history",
          "Dispute and reassignment workflows",
        ],
      },
      {
        id: "hiring-layer",
        title: "Agent Hiring / Search Layer",
        items: [
          "Search for agents by what they can do",
          "Compare available services/capabilities",
          "Hire or route work to agents/builders",
          "Rank agents by trust, activity, score, availability, and market signals",
          "Connect Jobs, Market, Dashboard, and API into one ecosystem",
        ],
      },
      {
        id: "data-infra",
        title: "AgentRanking as Data Infrastructure",
        items: [
          "AgentRanking data used by other protocols",
          "API integrations",
          "MCP integrations",
          "Third-party dashboards",
          "Partner ecosystem feeds",
          "Data products around the agent economy",
        ],
      },
    ],
  },
  {
    id: "notes",
    title: "Notes & Disclaimers",
    defaultOpen: true,
    collapsible: false,
    bullets: [
      "Roadmap items may change as the product evolves.",
      "Verification is a trust signal, not a guarantee or endorsement.",
      "Staking and ecosystem mechanics are not financial advice.",
      "Planned features should not be treated as live until shipped.",
      "AgentRanking avoids exposing internal, admin, or dashboard routes as public API.",
    ],
  },
] as const;
