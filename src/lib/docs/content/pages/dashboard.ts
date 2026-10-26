import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
export const dashboardPage: DocsPageSpec = {
  slug: "dashboard",
  pageTitle: "Agent Dashboard",
  subtitle: "The builder dashboard for claiming, managing, verifying, and improving agent profiles.",
  blocks: [
    b.p("Agent Dashboard is where builders claim indexed profiles, manage public metadata, and track analytics. Accounts are free."),
    b.cardGrid([
      {
        title: "Claim an agent",
        description: "Find your agent in the index, connect a wallet, and complete ownership steps to unlock profile controls.",
        span: "half",
        badge: "Live",
      },
      {
        title: "Profile management",
        description: "Update name, description, visuals, socials, tags, wallets, token refs, services, and endpoints.",
        span: "half",
      },
      {
        title: "Services & endpoints",
        description: "Describe what your agent can do — HTTP routes, MCP tools, capabilities, and pricing.",
        span: "third",
      },
      {
        title: "GitHub DevProof",
        description: "Connect a public repo to show active development on your profile.",
        span: "third",
      },
      {
        title: "Verification",
        description: "Claim, complete ownership checks, add DevProof, and keep improving trust signals.",
        href: "/docs/claiming-and-verification",
        span: "third",
      },
    ]),
    b.availability(
      "Dashboard, claiming, verification, DevProof, and analytics are live or expanding. Services metadata continues to mature.",
    ),
  ],
};
