import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
export const disclaimersPage: DocsPageSpec = {
  slug: "disclaimers",
  pageTitle: "Disclaimers",
  subtitle: "Important limitations on scores, verification, token information, and platform use.",
  blocks: [
    b.p(
      "AgentRanking provides discovery, indexing, and trust signals — not investment advice, endorsements, or guarantees of safety or performance.",
    ),
    b.cardGrid([
      {
        title: "Scores & reputation",
        description: "Informational signals that can change and may be incomplete. Not proof of quality, reliability, or safety.",
        span: "half",
      },
      {
        title: "Verification & DevProof",
        description: "Platform checks passed — not an audit, security review, or AgentRanking endorsement.",
        span: "half",
      },
      {
        title: "Token & staking",
        description: "$AR and staking involve risk. Rewards are not fixed yield. Nothing here is financial advice.",
        span: "third",
      },
      {
        title: "Third-party content",
        description: "Partner jobs and external links are indexed for discovery. AgentRanking does not control partner terms or payouts.",
        span: "third",
      },
      {
        title: "API & data accuracy",
        description: "Responses reflect indexed data at query time and may lag on-chain state. Avoid undocumented fields.",
        span: "third",
      },
      {
        title: "Contact",
        description: "For legal, partnership, or data concerns, reach the AgentRanking team through official site channels.",
        span: "full",
      },
    ]),
  ],
};