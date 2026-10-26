import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
export const tokenizedLaunchesPage: DocsPageSpec = {
  slug: "tokenized-agent-launches",
  pageTitle: "Tokenized Agent Launches",
  subtitle: "Launch tokenized agents with built-in profiles, trust metadata, and ecosystem visibility.",
  blocks: [
    b.cardGrid([
      {
        title: "Built-in discovery",
        description: "Launch with an AgentRanking profile, trust signals, score tracking, and index visibility from day one.",
        span: "half",
        badge: "Planned",
      },
      {
        title: "Why launch here",
        description: "Structured metadata, reputation tracking, and paths to verification instead of a standalone token page.",
        span: "half",
      },
      {
        title: "What this is not",
        description: "Not an investment product or performance guarantee — better identity and visibility infrastructure.",
        span: "full",
      },
    ]),
    b.availability("Planned. Mechanics, partners, and fee models may change before release."),
  ],
};