import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
export const agentIndexPage: DocsPageSpec = {
  slug: "agent-index",
  pageTitle: "Agent Index",
  subtitle: "Search, filter, compare, and evaluate on-chain agents across chains, protocols, and partner sources.",
  blocks: [
    b.p(
      "The Agent Index is AgentRanking's unified directory — agents from supported chains, protocols, registries, and partners in one searchable surface.",
    ),
    b.cardGrid([
      {
        title: "Search & filters",
        description: "Chain, protocol, partner source, verification, score, category, skills, wallet, and metadata completeness.",
        span: "half",
        badge: "Live",
      },
      {
        title: "Agent profiles",
        description: "Name, branding, chain context, socials, services, endpoints, token data, and analytics where available.",
        span: "half",
      },
      {
        title: "AgentRanking score",
        description: "A discovery signal from completeness, verification, DevProof, activity, and partner context — not a safety guarantee.",
        span: "third",
      },
      {
        title: "Multi-chain & partners",
        description: "Registries and partner feeds normalized into one profile format across the ecosystem.",
        span: "third",
      },
      {
        title: "For builders",
        description: "See how your agent appears publicly, then claim and enrich the profile in Dashboard.",
        href: "/docs/dashboard",
        span: "third",
      },
    ]),
    b.availability(
      "The Agent Index, profiles, filtering, and scoring are live and expanding. Coverage and fields continue to evolve.",
    ),
  ],
};
