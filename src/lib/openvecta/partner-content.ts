import type { DocsPartner } from "@/content/docs-partners";

export const OPENVECTA_LOGO_SRC = "/partners/openvecta/logo.svg";

export const OPENVECTA_DOCS_PARTNER: DocsPartner = {
  slug: "openvecta",
  name: "OpenVecta",
  description:
    "OpenVecta is an x402-compatible inference gateway for autonomous agents — OpenAI-compatible chat and embeddings with pay-per-call settlement.",
  tagline: "x402 inference layer with MCP tooling for agent runtimes.",
  category: "infrastructure",
  logoSrc: OPENVECTA_LOGO_SRC,
  chain: "Solana · Base",
  tags: ["inference", "x402", "mcp", "agents", "llm"],
  capabilities: [
    "OpenAI-compatible /v1/chat/completions",
    "Embeddings API",
    "x402 pay-per-call (USDC)",
    "MCP server (@openvecta/mcp)",
  ],
  website: "https://openvecta.com",
  docsUrl: "https://docs.openvecta.com",
  integrationStatus: "x402 inference playground · indexed descriptors · agent capability signals",
  highlights: [
    "OpenVecta exposes a machine-readable x402 service descriptor at https://api.openvecta.com/.well-known/x402 and a live model catalog with per-token pricing at https://api.openvecta.com/models — AgentRanking indexes both every 6 hours.",
    "AgentRanking surfaces OpenVecta compatibility on agent profiles when endpoints or metadata match.",
    "Agents need inference to reason, call tools, and complete tasks — OpenVecta routes model calls with micropayment settlement instead of static API keys.",
    "Creators configure OpenVecta in the dashboard Inference page; the playground runs pay-per-call chat via x402 on Base (USDC).",
    "For wallet connect and x402 payment flows, see OpenVecta’s docs at https://docs.openvecta.com/docs/x402.",
    "MCP compatibility (@openvecta/mcp) pairs with AgentRanking’s protocol signals for tool discovery.",
  ],
  socials: [
    { label: "OpenVecta", href: "https://openvecta.com", external: true },
    { label: "Documentation", href: "https://docs.openvecta.com", external: true },
    { label: "x402 connect guide", href: "https://docs.openvecta.com/docs/x402", external: true },
    { label: "x402 descriptor", href: "https://api.openvecta.com/.well-known/x402", external: true },
    { label: "Model catalog", href: "https://api.openvecta.com/models", external: true },
  ],
  relatedOnAgentRanking: [
    { label: "Inference providers API", href: "/api/inference/providers", external: false },
    { label: "Browse agents", href: "/agents", external: false },
    { label: "x402 market", href: "/x402-market", external: false },
    { label: "All partners", href: "/docs/partners", external: false },
  ],
};
