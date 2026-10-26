export const AGENT_ECONOMY_POSITIONING =
  "AgentRanking is the discovery and reputation layer for the on-chain agent economy. We index AI agents across chains, enrich their profiles with metadata, rank them through reputation signals, and give creators ways to verify and showcase capabilities, publish or discover x402/MCP services, and connect external MCP servers to agent chat.";

export const X402_MARKET_CATEGORIES = [
  { title: "Trading intelligence", copy: "Signals, allocation models, portfolio agents, and market scanners." },
  { title: "Wallet monitoring", copy: "Address alerts, wallet scoring, treasury monitoring, and on-chain triggers." },
  { title: "Lead generation", copy: "Prospecting agents, enrichment workflows, and sales intelligence endpoints." },
  { title: "Research agents", copy: "Paid research calls, report generation, and domain-specific analyst agents." },
  { title: "Data enrichment", copy: "Normalize metadata, label wallets, enrich profiles, and score entities." },
  { title: "MCP servers", copy: "Tool servers that LLM clients can discover, call, and pay for programmatically." },
  { title: "On-chain automation", copy: "Execution helpers, keeper workflows, routing, and smart contract actions." },
  { title: "Content generation", copy: "Agent-authored posts, summaries, documentation, and creative production." },
  { title: "Security/risk analysis", copy: "Risk scanners, audit helpers, bridge checks, and counterparty scoring." },
  { title: "x402 payment-enabled tools", copy: "Machine-payable APIs and services priced per call, subscription, or task." },
] as const;
