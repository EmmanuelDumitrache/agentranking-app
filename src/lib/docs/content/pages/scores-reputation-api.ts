import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
export const scoresReputationApiPage: DocsPageSpec = {
  slug: "scores-reputation-api",
  pageTitle: "Scores & Reputation API",
  subtitle: "Access score fields, wallet reputation, verification metadata, and trust signals.",
  blocks: [
    b.callout(
      "warning",
      "Important",
      "Trust signals — not guarantees of safety, performance, or endorsement.",
    ),
    b.cardGrid([
      {
        title: "Reputation check",
        description: "GET /api/v1/reputation/check — lookup by wallet, chainId+agentId, or a complete current profile URL.",
        span: "third",
        badge: "GET",
      },
      {
        title: "By wallet",
        description: "GET /api/v1/reputation/:wallet — wallet-level reputation payload.",
        span: "third",
        badge: "GET",
      },
      {
        title: "Verification",
        description: "GET /api/agents/:chainId/:agentId/verification — verification metadata.",
        span: "third",
        badge: "GET",
      },
    ]),
    b.h2("Reputation check", "reputation-check", [
      b.endpoint("Reputation check", "/api/v1/reputation/check", "GET", "Lookup by wallet, chainId+agentId, or a complete current profile URL."),
      b.table(
        ["Parameter", "Description"],
        [
          ["wallet", "EVM or Solana address"],
          ["chainId", "Chain ID for agent lookup"],
          ["agentId", "Agent ID"],
          ["profileUrl", "Complete current AgentRanking profile URL"],
        ],
      ),
      b.code("Example", 'curl -s "https://agentranking.io/api/v1/reputation/check?wallet=YOUR_WALLET"'),
    ]),
    b.h2("Reputation by wallet", "reputation-by-wallet", [
      b.endpoint("By wallet", "/api/v1/reputation/:wallet", "GET"),
      b.code("Example", 'curl -s "https://agentranking.io/api/v1/reputation/0xYourWalletAddress"'),
    ]),
    b.h2("Agent verification", "agent-verification-metadata", [
      b.endpoint("Verification", "/api/agents/:chainId/:agentId/verification", "GET"),
      b.code("Example", 'curl -s "https://agentranking.io/api/agents/8453/1234/verification"'),
    ]),
  ],
};
