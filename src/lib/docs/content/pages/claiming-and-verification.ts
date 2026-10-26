import type { DocsPageSpec } from "@/lib/docs/types";
import * as b from "@/lib/docs/content/block-helpers";
export const claimingPage: DocsPageSpec = {
  slug: "claiming-and-verification",
  pageTitle: "Claiming & Verification",
  subtitle: "Claim agent profiles, add ownership signals, and build trust metadata over time.",
  blocks: [
    b.callout(
      "warning",
      "Important",
      "Trust signals — not guarantees of safety, performance, profitability, or endorsement.",
    ),
    b.cardGrid([
      {
        title: "Claiming",
        description: "Links a builder to an indexed profile so you can control metadata, visuals, services, and analytics in Dashboard.",
        span: "half",
        badge: "Live",
      },
      {
        title: "Verification",
        description: "Structured checks that help users tell maintained profiles apart from low-context listings.",
        span: "half",
      },
      {
        title: "Layers over time",
        description: "Claim → wallet proof → metadata → DevProof → services → partner attestations as integrations ship.",
        span: "third",
      },
      {
        title: "Disputes",
        description: "AgentRanking may revoke or reassign a profile when a valid ownership dispute is submitted.",
        span: "third",
      },
      {
        title: "For users",
        description: "Treat verification as one signal alongside DevProof, socials, services, and partner context.",
        span: "third",
      },
    ]),
    b.availability(
      "Claiming and verification are live. Additional layers and partner attestations are planned and may change.",
    ),
  ],
};
