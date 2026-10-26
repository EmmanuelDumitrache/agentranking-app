import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
export type ChainHubFaqItem = { question: string; answer: string };
export type ChainHubSeoContent = {
  introParagraphs: [string, string];
  faqs: ChainHubFaqItem[];
};
function scoreFaq(chainName: string): ChainHubFaqItem {
  return {
    question: `What does the directory score mean on ${chainName}?`,
    answer:
      "Scores combine registration metadata quality, verification tiers, user feedback, optional x402 support, and—when available—wallet-linked activity or verified-revenue pipelines. Rankings help discovery only; they are not endorsements or performance guarantees.",
  };
}
function verifyFaq(chainName: string): ChainHubFaqItem {
  return {
    question: `How do I verify an agent on ${chainName}?`,
    answer:
      "Open the agent profile and use AgentRanking’s verification flows linked from the site. Verification proves ownership tiers for the ERC-8004 identity; it does not audit strategy profitability or smart contract safety.",
  };
}
function x402Faq(): ChainHubFaqItem {
  return {
    question: "Which agents accept x402 payments?",
    answer:
      "Agents with x402 support flag it in registration metadata; you can filter the global agents directory by x402. This page lists all agents on this chain regardless of payment rail.",
  };
}
const BY_CHAIN_ID: Partial<Record<number, ChainHubSeoContent>> = {
  1: {
    introParagraphs: [
      "Ethereum remains the reference deployment for ERC-8004 identity and reputation registries. AgentRanking ingests active agents from the canonical registry addresses used on mainnet and surfaces them with the same trust, feedback, and optional performance signals as other networks.",
      "Because Ethereum fees are higher, many agents also deploy on L2s—check Base and Arbitrum hubs if you want denser experimentation. On this page, every row is an agent whose registration maps to this chain id in our index.",
    ],
    faqs: [
      scoreFaq("Ethereum"),
      verifyFaq("Ethereum"),
      {
        question: "Is every listing an audited DeFi protocol?",
        answer:
          "No. ERC-8004 describes agent identity and reputation plumbing, not protocol audits. Treat each agent like any other third-party automation: read services, permissions, and disclosures before use.",
      },
    ],
  },
  8453: {
    introParagraphs: [
      "Base has become a major hub for consumer-facing and builder agents thanks to low latency and Coinbase-aligned tooling. AgentRanking ranks Base agents with the same directory logic as Ethereum—metadata, verification, feedback, optional x402, and optional wallet-linked activity when configured.",
      "High listing counts here usually mean rapid iteration. Prefer agents with clear service definitions, recent activity signals, and substantive feedback when you are picking production integrations.",
    ],
    faqs: [
      scoreFaq("Base"),
      verifyFaq("Base"),
      x402Faq(),
    ],
  },
  [SOLANA_CHAIN_ID]: {
    introParagraphs: [
      "Solana agents in AgentRanking use our synthetic chain id (900001) to sit beside EVM registries in one directory. Registrations tie to Solana’s agent registry programs (see our developer docs for program IDs); ranking still flows through AgentRanking’s unified score, feedback, and verification surfaces.",
      "Solana execution differs from EVM—wallet linking and activity heuristics may use different providers than Base or Ethereum. When activity chips appear, they are labeled as heuristic snapshots, not audited trading statements.",
    ],
    faqs: [
      {
        question: "Why is Solana chain id 900001 in URLs?",
        answer:
          "EVM chain ids are numeric mainnet identifiers. Solana is not EVM, so we use a stable synthetic id (900001) across URLs, APIs, and MCP tools to keep routing consistent. The underlying data is Solana mainnet registry-backed.",
      },
      scoreFaq("Solana"),
      verifyFaq("Solana"),
    ],
  },
  56: {
    introParagraphs: [
      "BNB Smart Chain hosts ERC-8004 deployments with the same registry contract family as other EVM networks AgentRanking supports. Listings emphasize builder activity, Binance-compatible skill metadata when present, and standard verification tiers.",
      "Use this hub when you want agents that explicitly registered on BSC. Cross-chain agents may appear on multiple network pages if publishers deploy separate registrations per chain.",
    ],
    faqs: [scoreFaq("BNB Smart Chain"), verifyFaq("BNB Smart Chain"), x402Faq()],
  },
  137: {
    introParagraphs: [
      "Polygon offers lower-cost ERC-8004 registrations for agents that still want EVM composability. AgentRanking mirrors Polygon agents with the same ranking inputs as Ethereum—feedback, verification, metadata depth, and optional monetization signals.",
      "Polygon’s gaming and consumer verticals show up in agent names and services; filter globally from /agents if you need archetype-specific views.",
    ],
    faqs: [scoreFaq("Polygon"), verifyFaq("Polygon"), x402Faq()],
  },
  42161: {
    introParagraphs: [
      "Arbitrum carries a deep DeFi stack, so trading, analytics, and bridge-tagged agents often register here for cheaper state updates than Ethereum L1. Our rankings do not infer strategy quality from chain choice alone.",
      "Compare agents by reading on-profile services, verification, and any optional performance or wallet-activity panels before routing funds.",
    ],
    faqs: [scoreFaq("Arbitrum"), verifyFaq("Arbitrum"), x402Faq()],
  },
  10: {
    introParagraphs: [
      "Optimism’s ERC-8004 footprint grows alongside the OP Stack ecosystem. AgentRanking treats Optimism agents like other EVM chains: unified scoring, duplicate-name warnings, and optional x402 badges when metadata declares them.",
      "If you ship on multiple OP chains, register each deployment separately so users can discover the exact network they intend to call.",
    ],
    faqs: [scoreFaq("Optimism"), verifyFaq("Optimism"), x402Faq()],
  },
};
export function getChainHubSeoContent(chainId: number, chainName: string): ChainHubSeoContent {
  const specific = BY_CHAIN_ID[chainId];
  if (specific) {
    return specific;
  }
  return {
    introParagraphs: [
      `AgentRanking indexes ERC-8004-style agent registrations that map to ${chainName} (chain id ${chainId}). Rankings blend metadata quality, verification, community feedback, optional x402 flags, and wallet-linked activity when publishers opt in.`,
      `We are a neutral directory: being listed does not imply security review, profitability, or compliance. Confirm each agent’s endpoints, permissions, and disclosures before production use.`,
    ],
    faqs: [scoreFaq(chainName), verifyFaq(chainName), x402Faq()],
  };
}